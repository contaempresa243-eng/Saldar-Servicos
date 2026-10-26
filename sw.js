// Saldar Serviços — service worker (v51)
// Estratégia: REDE PRIMEIRO para a app (HTML/JS/CSS) → as atualizações chegam logo ao publicar;
// se não houver internet, usa a cópia guardada. Caches antigas são apagadas.
const CACHE_NAME = 'saldar-servicos-cache-v51';
const ASSETS = ['./', './index.html', './styles.css', './app.js', './manifest.json'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(ASSETS.map((u) => new Request(u, { cache: 'reload' }))))
      .catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // só trata ficheiros do próprio site; Firebase, CDNs, etc. vão direto à rede
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(req, { cacheName: CACHE_NAME }).then((hit) => hit || caches.match('./index.html', { cacheName: CACHE_NAME })))
  );
});
