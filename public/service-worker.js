const CACHE = 'prime-studio-pwa-v2';
const PUBLIC_FILES = [
  '/public/offline.html',
  '/public/pwa.css',
  '/public/i18n.js',
  '/public/i18n-core.js',
  '/public/translations.js',
  '/manifest.webmanifest',
  '/assets/prime-agent-180.png',
  '/assets/prime-agent-192.png',
  '/assets/prime-agent-512.png',
  '/assets/prime-agent-maskable-512.png',
];
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PUBLIC_FILES))
      .then(() => self.skipWaiting()),
  );
});
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith('prime-studio-pwa-') && key !== CACHE)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});
self.addEventListener('fetch', (event) => {
  const request = event.request,
    url = new URL(request.url);
  // Never intercept submissions, API calls, SSE streams or user attachments.
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/'))
    return;
  if (request.mode === 'navigate' && (url.pathname === '/' || url.pathname === '/index.html')) {
    event.respondWith(
      (async () => {
        try {
          const response = await fetch(request);
          if (![502, 503, 504].includes(response.status)) return response;
        } catch {
          /* The PC or the network is unavailable. */
        }
        return (await caches.match('/public/offline.html', { cacheName: CACHE })) || Response.error();
      })(),
    );
  } else if (PUBLIC_FILES.includes(url.pathname) && !url.search) {
    event.respondWith(fetch(request).catch(() => caches.match(request, { cacheName: CACHE })));
  }
});
