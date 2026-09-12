// Read-only OpenAI/Codex subscription quota via ChatGPT backend.
// Fixed endpoint only. No redemption, purchase or account mutation here.
// Upstream schema is snake_case (wham/usage), never app-server camelCase.
export const CODEX_USAGE_URL = 'https://chatgpt.com/backend-api/wham/usage';
export const CODEX_USAGE_TIMEOUT_MS = 10000;
export const CODEX_USAGE_MAX_BYTES = 256 * 1024;
const WEEKLY_THRESHOLD_SECONDS = 3 * 24 * 60 * 60;

const record = (value) => (value && typeof value === 'object' && !Array.isArray(value) ? value : {});
const finiteNumber = (value) => {
  const number = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
  return Number.isFinite(number) ? number : undefined;
};
const percent = (value) => {
  const number = finiteNumber(value);
  if (number === undefined) return undefined;
  return Math.min(100, Math.max(0, number));
};
const epochMs = (value) => {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    if (!Number.isFinite(Number(trimmed))) {
      const parsed = Date.parse(trimmed);
      return Number.isFinite(parsed) ? parsed : undefined;
    }
  }
  const number = finiteNumber(value);
  if (number === undefined || number <= 0) return undefined;
  return number < 10_000_000_000 ? number * 1000 : number;
};
const cleanPlan = (value, limit = 80) =>
  typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, limit) || undefined : undefined;

function resetMs(source, now) {
  const direct = epochMs(source.reset_at ?? source.resets_at);
  if (direct !== undefined) return direct;
  const after = finiteNumber(source.reset_after_seconds ?? source.reset_in_seconds);
  if (after !== undefined && after >= 0 && after <= 366 * 24 * 60 * 60) return now + Math.round(after * 1000);
  return undefined;
}

function usageWindow(value, fallbackWindowSeconds, now = Date.now()) {
  const source = record(value);
  const used = percent(source.used_percent ?? source.utilization);
  const resetAt = resetMs(source, now);
  if (used === undefined || resetAt === undefined) return undefined;
  const windowSeconds = finiteNumber(source.limit_window_seconds) ?? fallbackWindowSeconds;
  const safeWindow =
    windowSeconds !== undefined && Number.isFinite(windowSeconds) && windowSeconds > 0 && windowSeconds <= 366 * 24 * 60 * 60
      ? Math.round(windowSeconds)
      : undefined;
  return { usedPercent: used, resetAt, ...(safeWindow !== undefined ? { windowSeconds: safeWindow } : {}) };
}

export function parseCodexUsageBody(body, now = Date.now()) {
  const source = record(body);
  const rateLimit = record(source.rate_limit);
  const primary = usageWindow(rateLimit.primary_window, 5 * 60 * 60, now);
  const secondary = usageWindow(rateLimit.secondary_window, 7 * 24 * 60 * 60, now);
  if (!primary && !secondary) return null;
  let shortWindow = primary || undefined;
  let weeklyWindow = secondary || undefined;
  if (primary && secondary) {
    const p = primary.windowSeconds;
    const s = secondary.windowSeconds;
    if (p !== undefined && s !== undefined && p > s) {
      shortWindow = secondary;
      weeklyWindow = primary;
    } else {
      shortWindow = primary;
      weeklyWindow = secondary;
    }
  } else if (primary && !secondary) {
    if ((primary.windowSeconds ?? 0) >= WEEKLY_THRESHOLD_SECONDS) {
      shortWindow = undefined;
      weeklyWindow = primary;
    } else {
      shortWindow = primary;
      weeklyWindow = undefined;
    }
  } else if (!primary && secondary) {
    if ((secondary.windowSeconds ?? 0) >= WEEKLY_THRESHOLD_SECONDS) {
      shortWindow = undefined;
      weeklyWindow = secondary;
    } else {
      shortWindow = secondary;
      weeklyWindow = undefined;
    }
  }
  const creditsSource = record(source.credits);
  const balanceRaw = creditsSource.balance;
  const balance =
    typeof balanceRaw === 'string' || typeof balanceRaw === 'number'
      ? String(balanceRaw).replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 40) || undefined
      : undefined;
  return {
    plan: cleanPlan(source.plan_type),
    limitReached: typeof rateLimit.limit_reached === 'boolean' ? rateLimit.limit_reached : undefined,
    short: shortWindow,
    weekly: weeklyWindow,
    credits: {
      ...(typeof creditsSource.has_credits === 'boolean' ? { hasCredits: creditsSource.has_credits } : {}),
      ...(typeof creditsSource.unlimited === 'boolean' ? { unlimited: creditsSource.unlimited } : {}),
      ...(balance !== undefined ? { balance } : {}),
    },
  };
}

export function toPublicSnapshot(parsed, { fetchedAt = Date.now(), cached = false } = {}) {
  if (!parsed) return { available: false, reason: 'unavailable', fetchedAt, cached };
  const shape = (window) =>
    window
      ? {
          usedPercent: Math.round(window.usedPercent * 10) / 10,
          remainingPercent: Math.max(0, Math.round(100 - window.usedPercent)),
          resetAt: window.resetAt,
          ...(window.windowSeconds !== undefined ? { windowSeconds: window.windowSeconds } : {}),
        }
      : null;
  return {
    available: true,
    provider: 'openai-codex',
    plan: parsed.plan,
    limitReached: parsed.limitReached,
    short: shape(parsed.short),
    weekly: shape(parsed.weekly),
    credits: parsed.credits && Object.keys(parsed.credits).length ? parsed.credits : undefined,
    fetchedAt,
    cached: cached === true,
  };
}

export async function fetchCodexUsage({ accessToken, accountId, fetchImpl = fetch, timeoutMs = CODEX_USAGE_TIMEOUT_MS } = {}) {
  if (typeof accessToken !== 'string' || !accessToken || accessToken.length > 16384) throw new Error('Missing access token.');
  if (CODEX_USAGE_URL !== 'https://chatgpt.com/backend-api/wham/usage') throw new Error('Fixed usage endpoint mismatch.');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers = { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' };
    if (typeof accountId === 'string' && accountId && accountId.length <= 256 && !/[\u0000-\u001f\u007f]/.test(accountId))
      headers['chatgpt-account-id'] = accountId;
    const response = await fetchImpl(CODEX_USAGE_URL, { method: 'GET', headers, signal: controller.signal });
    if (!response.ok) {
      const error = new Error(`Usage endpoint returned HTTP ${response.status}`);
      error.status = response.status;
      throw error;
    }
    const text = await response.text();
    if (text.length > CODEX_USAGE_MAX_BYTES) throw new Error('Usage response too large.');
    return JSON.parse(text);
  } finally {
    clearTimeout(timer);
  }
}
