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
