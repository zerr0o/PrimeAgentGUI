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
]);

export function validatePwaOrigin(value) {
  if (
    typeof value !== 'string' ||
    !/^https:\/\/[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.[a-z0-9-]+\.ts\.net$/.test(value)
  )
    throw new Error('Une origine HTTPS Tailscale exacte est requise pour la PWA.');
  return value;
}

export const PWA_LOGIN_HEAD =
  '<meta name="theme-color" content="#1b1c1e"><meta name="apple-mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-title" content="Prime Agent"><link rel="manifest" href="/manifest.webmanifest"><link rel="icon" href="/assets/prime-agent.svg"><link rel="apple-touch-icon" href="/assets/prime-agent-180.png"><link rel="stylesheet" href="/public/pwa.css"><script type="module" src="/public/pwa.js"></script>';
