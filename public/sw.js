const CACHE_NAME = 'wah-safety-pwa-v3';
const STATIC_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './logo.png'
];

self.addEventListener('install', (evt) => {
  evt.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS).catch((e) => console.warn('PWA Precache note:', e));
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (evt) => {
  evt.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (evt) => {
  if (evt.request.method !== 'GET') return;
  const url = evt.request.url;
  // Bypass caching for live Firestore sync and Google OAuth
  if (url.includes('firestore.googleapis.com') || url.includes('identitytoolkit') || url.includes('accounts.google.com')) {
    return;
  }

  evt.respondWith(
    fetch(evt.request)
      .then((networkRes) => {
        if (networkRes && networkRes.status === 200) {
          const clone = networkRes.clone();
          caches.open(CACHE_NAME).then(c => c.put(evt.request, clone));
        }
        return networkRes;
      })
      .catch(() => {
        return caches.match(evt.request).then(cached => {
          if (cached) return cached;
          if (evt.request.mode === 'navigate') {
            return caches.match('./index.html');
          }
        });
      })
  );
});
