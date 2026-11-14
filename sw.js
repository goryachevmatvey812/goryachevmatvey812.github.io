const C = 'orden-v1';
const BASE = ['./', 'index.html', 'manifest.json', 'icon-192.png', 'icon-512.png'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(C).then(c => c.addAll(BASE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => x !== C).map(x => caches.delete(x)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const r = e.request;
  if (r.method !== 'GET') return;
  const h = new URL(r.url).hostname;
  if (h.includes('firestore.googleapis.com') || h.includes('identitytoolkit') || h.includes('securetoken')) return;
  // Сначала сеть (чтобы обновления доходили сразу), без сети берём копию из кэша.
  e.respondWith(
    fetch(r).then(res => {
      const cp = res.clone();
      caches.open(C).then(c => c.put(r, cp)).catch(() => {});
      return res;
    }).catch(() => caches.match(r).then(m => m || caches.match('index.html')))
  );
});
