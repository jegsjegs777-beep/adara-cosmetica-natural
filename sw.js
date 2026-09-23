// Service worker básico — cachea el shell de la app para que cargue rápido
// y funcione parcialmente sin conexión. Se puede ampliar más adelante.
const CACHE_NAME = "adara-shell-v1";
const SHELL_FILES = [
  "./index.html",
  "./css/styles.css",
  "./js/app.js",
  "./js/data.js",
  "./js/icons.js",
  "./manifest.json",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});
