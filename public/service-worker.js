/* Orbit Tasks PWA: cache only public shell assets, never Supabase API or user data. */
const CACHE_NAME = 'orbit-tasks-static-v1';
const SCOPE = '/orbit-tasks/';
const APP_SHELL = SCOPE;
const STATIC_ASSET = /\.(?:js|css|png|svg|ico|webmanifest)$/i;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.add(APP_SHELL)),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    Promise.all([
      caches.keys().then((names) =>
        Promise.all(names.filter((name) => name.startsWith('orbit-tasks-static-') && name !== CACHE_NAME)
          .map((name) => caches.delete(name))),
      ),
      self.clients.claim(),
    ]),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith(SCOPE)) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).then((response) => {
        if (response.ok) {
          const copy = response.clone();
          void caches.open(CACHE_NAME).then((cache) => cache.put(APP_SHELL, copy));
        }
        return response;
      }).catch(async () => (await caches.match(APP_SHELL)) || Response.error()),
    );
    return;
  }

  if (!STATIC_ASSET.test(url.pathname)) return;

  event.respondWith(
    caches.match(request).then(async (cached) => {
      if (cached) return cached;
      const response = await fetch(request);
      if (response.ok && response.type === 'basic') {
        const copy = response.clone();
        void caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
      }
      return response;
    }),
  );
});

/* Incoming Web Push notifications (activated after VAPID is configured). */
self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = {};
  }
  const title = typeof payload.title === 'string' ? payload.title.slice(0, 100) : 'Orbit Tasks';
  const body = typeof payload.body === 'string' ? payload.body.slice(0, 240) : 'Tienes un recordatorio pendiente.';
  const tag = typeof payload.tag === 'string' ? payload.tag.slice(0, 100) : 'orbit-task-alert';
  event.waitUntil(self.registration.showNotification(title, {
    body,
    tag,
    icon: '/orbit-tasks/icons/icon-192.png',
    badge: '/orbit-tasks/icons/icon-192.png',
    vibrate: [160, 80, 160], // Applied only when supported; iOS ignores this option.
    data: { url: '/orbit-tasks/' },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const target = new URL('/orbit-tasks/', self.location.origin);
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const current = windows.find((client) => {
      const location = new URL(client.url);
      return location.origin === target.origin && location.pathname.startsWith('/orbit-tasks/');
    });
    if (current) await current.focus();
    else await self.clients.openWindow(target.href);
  })());
});
