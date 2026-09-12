import { formatMessage as tr } from '../public/i18n-core.js';
// Only this fixed set may be fetched without the mobile access cookie.
export const PWA_PUBLIC_PATHS = new Set([
  '/manifest.webmanifest',
  '/service-worker.js',
  '/favicon.ico',
  '/assets/prime-agent.svg',
  '/assets/prime-agent.png',
  '/assets/prime-agent-180.png',
  '/assets/prime-agent-192.png',
  '/assets/prime-agent-512.png',
  '/assets/prime-agent-maskable-512.png',
  '/public/pwa.js',
  '/public/pwa.css',
  '/public/offline.html',
  '/public/i18n.js',
  '/public/i18n-core.js',
  '/public/translations.js',
  '/public/passkeys.js',
  '/vendor/passkeys.js',
]);

export function validatePwaOrigin(value) {
  if (
    typeof value !== 'string' ||
    !/^https:\/\/[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.[a-z0-9-]+\.ts\.net$/.test(value)
  )
    throw new Error(tr('server.une_origine_https_tailscale_exacte_est_requise_pour_la_pwa'));
  return value;
}

export const PWA_LOGIN_HEAD =
  '<meta name="theme-color" content="#1b1c1e"><meta name="apple-mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-title" content="Prime Agent"><link rel="manifest" href="/manifest.webmanifest"><link rel="icon" href="/assets/prime-agent.svg"><link rel="apple-touch-icon" href="/assets/prime-agent-180.png"><link rel="stylesheet" href="/public/pwa.css"><script type="module" src="/public/pwa.js"></script>';
