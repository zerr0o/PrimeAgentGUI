const ENDPOINT = 'https://openrouter.ai/api/v1/models';
const MAX_BYTES = 12 * 1024 * 1024;

// This public catalogue checks identifiers, not a user's credit or endpoint capacity.
// In particular, never translate a retired :free identifier into its paid equivalent.
export function isModelAvailabilityError(error) {
  const text = String(error || '');
  return (
    /\bmodel\b/i.test(text) &&
    /unavailable|not (?:found|available)|does not exist|no endpoints|invalid model/i.test(text)
  );
}

function catalogueId(id) {
  if (id.startsWith('openrouter/')) id = id.slice('openrouter/'.length);
  // Provider routing modifiers are not separately listed models. :free is a real SKU.
  return id.replace(/(?::(?:online|nitro|floor))+$/, '');
}

export function createModelAvailability({
  fetchImpl = fetch,
  now = Date.now,
  ttl = 300000,
  retryDelay = 30000,
  timeout = 5000,
  maxStale = 86400000,
} = {}) {
  let ids,
    checkedAt = 0,
    attemptedAt = -Infinity,
    pending,
    controller,
    closed = false;

  async function refresh(force) {
    if (closed || pending) return pending;
    const age = now() - attemptedAt;
    if (age < retryDelay || (!force && age < ttl)) return;
    attemptedAt = now();
    controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(timeout)]);
    pending = (async () => {
      try {
        const response = await fetchImpl(ENDPOINT, {
          headers: { Accept: 'application/json' },
          signal,
          redirect: 'error',
        });
        if (!response.ok) throw new Error('Catalogue unavailable');
        if (Number(response.headers.get('content-length')) > MAX_BYTES)
          throw new Error('Catalogue too large');
        const reader = response.body.getReader();
        const chunks = [];
        let size = 0;
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > MAX_BYTES) throw new Error('Catalogue too large');
            chunks.push(value);
          }
        } catch (error) {
          await reader.cancel().catch(() => {});
          throw error;
        } finally {
          reader.releaseLock();
        }
        const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (
          !Array.isArray(payload?.data) ||
          !payload.data.length ||
          payload.data.length > 50000 ||
          payload.data.some((model) => typeof model?.id !== 'string' || !model.id || model.id.length > 500)
        )
          throw new Error('Invalid catalogue');
        // Reject partial/paginated replies rather than falsely retiring missing models.
        if (
          payload.has_more === true ||
          payload.next ||
          payload.next_page ||
          (Number.isFinite(payload.total_count) && payload.total_count > payload.data.length)
        )
          throw new Error('Incomplete catalogue');
        ids = new Set(payload.data.map((model) => model.id));
        checkedAt = now();
      } catch {
        // Offline/429/malformed responses never turn the entire picker unavailable.
      } finally {
        pending = undefined;
        controller = undefined;
      }
    })();
    return pending;
  }

  return {
    async apply(models, { refresh: force = false, customProviders = {}, skipIds = new Set() } = {}) {
      const provider = customProviders.openrouter;
      const definitions = new Map(
        (Array.isArray(provider?.models) ? provider.models : [])
          .filter((model) => model && typeof model.id === 'string')
          .map((model) => [model.id, model]),
      );
      const usesPublicCatalogue = (model) => {
        if (model.provider !== 'openrouter' || skipIds.has(model.id)) return false;
        const nativeId = model.id.slice('openrouter/'.length);
        const baseUrl = definitions.get(nativeId)?.baseUrl ?? provider?.baseUrl;
        return typeof baseUrl !== 'string' || baseUrl.replace(/\/+$/, '') === 'https://openrouter.ai/api/v1';
      };
      if (!models.some(usesPublicCatalogue)) return { models, refreshing: false };
      // Serve immediately; the client asks again while this bounded fetch runs.
      void refresh(force);
      const current = ids && now() - checkedAt <= maxStale ? ids : null;
      return {
        models: models.map((model) => {
          if (!usesPublicCatalogue(model)) return model;
          const id = catalogueId(model.id);
          // Aliases/presets are resolved by OpenRouter, not enumerated by /models.
          const dynamic =
            id.startsWith('@') || ['auto', 'free', 'openrouter/auto', 'openrouter/free'].includes(id);
          return {
            ...model,
            availability:
              model.availability === 'unavailable'
                ? 'unavailable'
                : !current || dynamic
                  ? 'unknown'
                  : current.has(id)
                    ? 'available'
                    : 'unavailable',
          };
        }),
        refreshing: !!pending,
      };
    },
    async close() {
      closed = true;
      controller?.abort();
      await pending;
    },
  };
}
