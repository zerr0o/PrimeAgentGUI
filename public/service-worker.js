const CACHE = 'prime-studio-pwa-v4';
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

// Web Push: always show an incoming push (userVisibleOnly). No silent suppression
// in the service worker. Foreground skipping happens server-side via focus lease.
// Payload is generic only: {v:1, kind, sessionId?, runId?}. No project/prompt text.
const PUSH_TEXT = {
  question: {
    fr: { title: 'Une question attend votre réponse', body: 'Ouvrez le Studio pour répondre.' },
    en: { title: 'A question needs your answer', body: 'Open Studio to answer.' },
  },
  turnComplete: {
    fr: { title: 'Le tour de l’agent est terminé', body: 'Ouvrez le Studio pour voir le résultat.' },
    en: { title: 'The agent turn finished', body: 'Open Studio to see the result.' },
  },
};
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$/;
function pushTarget(data) {
  const sessionId = typeof data?.sessionId === 'string' && SAFE_ID.test(data.sessionId) ? data.sessionId : '';
  const runId = typeof data?.runId === 'string' && SAFE_ID.test(data.runId) ? data.runId : '';
  const params = new URLSearchParams();
  if (sessionId) params.set('push-session', sessionId);
  if (runId) params.set('push-run', runId);
  return { sessionId, runId, url: params.size ? `/?${params}` : '/' };
}
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }
  const kind = data.kind === 'question' ? 'question' : 'turnComplete';
  const lang = (navigator.language || 'fr').toLowerCase().startsWith('en') ? 'en' : 'fr';
  const text = (PUSH_TEXT[kind] || PUSH_TEXT.turnComplete)[lang];
  const target = pushTarget(data);
  event.waitUntil(
    self.registration.showNotification(text.title, {
      body: text.body,
      tag: kind === 'question' ? `prime-question-${target.sessionId || 'studio'}` : `prime-turn-${target.runId || target.sessionId || 'studio'}`,
      renotify: kind === 'question',
      silent: false,
      data: target,
    }),
  );
});
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = event.notification.data || { url: '/' };
  const url = typeof target.url === 'string' && target.url.startsWith('/') ? target.url : '/';
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of windows) {
        try {
          const clientUrl = new URL(client.url);
          if (clientUrl.origin !== self.location.origin) continue;
          await client.focus();
          // Let the open PWA navigate to the relevant session safely.
          client.postMessage({ type: 'prime-push-open', sessionId: target.sessionId || '', runId: target.runId || '' });
          if ('navigate' in client && url !== '/') await client.navigate(url);
          return;
        } catch {}
      }
      await self.clients.openWindow(url);
    })(),
  );
});
