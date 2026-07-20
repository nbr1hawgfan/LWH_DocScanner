// LWH Driver Scan - Service Worker
const CACHE_NAME = "lwh-driver-scan-v1.5.0";

const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.json",
  "./css/style.css",
  "./js/app.js",
  "./js/scanner.js",
  "./js/pdf-export.js",
  "./js/drive.js",
  "./js/share.js",
  "./js/config.js",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-512-maskable.png"
];

// Heavy third-party libs — cached on first successful fetch (opencv.js is ~8MB,
// so we don't pre-cache it in install; we cache it the first time it loads).
const RUNTIME_CACHE_HOSTS = [
  "docs.opencv.org",
  "cdnjs.cloudflare.com",
  "unpkg.com",
  "cdn.jsdelivr.net"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Never intercept Google/Drive API calls — always go live.
  if (url.hostname.includes("googleapis.com") || url.hostname.includes("google.com")) {
    return;
  }

  const isRuntimeLib = RUNTIME_CACHE_HOSTS.includes(url.hostname);
  const isAppShell = url.origin === self.location.origin;

  if (isRuntimeLib) {
    // Cache-first, so opencv.js only ever downloads once per device.
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) return cached;
        return fetch(event.request).then((response) => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        });
      })
    );
    return;
  }

  if (isAppShell) {
    // Network-first for app shell so drivers get updates when signal allows,
    // falling back to cache when offline in the truck.
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          return response;
        })
        .catch(() => caches.match(event.request))
    );
  }
});
