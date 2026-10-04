const CACHE_VERSION = 'appraisalsuite-v1';
const SHELL_CACHE = `${CACHE_VERSION}-shell`;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;

const CORE_ASSETS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/favicon/favicon.svg',
  '/favicon/favicon-32x32.png',
  '/favicon/android-chrome-192x192.png',
  '/favicon/android-chrome-512x512.png'
];

const CACHEABLE_DESTINATIONS = new Set([
  'style',
  'script',
  'image',
  'font',
  'manifest'
]);

const isApiRequest = (url) => (
  /\/(?:api|appraisal-server|appraisal-api)(?:\/|$)/i.test(url.pathname)
);

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);

    // Cache each shell asset independently so one missing optional icon cannot
    // prevent the service worker itself from installing.
    await Promise.allSettled(
      CORE_ASSETS.map((asset) => cache.add(new Request(asset, { cache: 'reload' })))
    );

    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keep = new Set([SHELL_CACHE, RUNTIME_CACHE]);
    const cacheNames = await caches.keys();

    await Promise.all(
      cacheNames
        .filter((cacheName) => cacheName.startsWith('appraisalsuite-') && !keep.has(cacheName))
        .map((cacheName) => caches.delete(cacheName))
    );

    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin || isApiRequest(url)) return;
  if (url.pathname.endsWith('/service-worker.js')) return;

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        // Pages remain network-first so authenticated routes and fresh bundles
        // are always preferred whenever the device is online.
        const response = await fetch(request);
        if (response && response.ok) {
          const cache = await caches.open(SHELL_CACHE);
          await cache.put('/index.html', response.clone());
        }
        return response;
      } catch {
        return (
          await caches.match('/index.html')
          || await caches.match('/')
          || Response.error()
        );
      }
    })());
    return;
  }

  if (!CACHEABLE_DESTINATIONS.has(request.destination)) return;

  // Static assets are stale-while-revalidate: fast from cache, refreshed in
  // the background. Fetch/XHR API data is intentionally never handled here.
  const networkPromise = fetch(request)
    .then(async (response) => {
      if (response && response.ok) {
        const cache = await caches.open(RUNTIME_CACHE);
        await cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => null);

  event.waitUntil(networkPromise.then(() => undefined));
  event.respondWith((async () => {
    const cached = await caches.match(request);
    if (cached) return cached;
    return await networkPromise || Response.error();
  })());
});
