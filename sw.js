/**
 * EWS TITEN - Service Worker
 * Versi Cache: v3.3.3 (Pembaruan Tata Letak PC & Penyesuaian Ukuran Panel)
 */

const CACHE_NAME = "ews-titen-v3.3.3";
const ASSETS_TO_CACHE = [
  "./",
  "./index.html",
  "./qr.html",
  "./css/style.css?v=3.3.3",
  "./js/config.js?v=3.3.3",
  "./js/app.js?v=3.3.3",
  "./manifest.json",
  "./assets/vendor/leaflet.min.css",
  "./assets/vendor/leaflet.min.js",
  "./assets/vendor/chart.umd.min.js",
  "./assets/vendor/lucide.min.js",
  "./assets/vendor/firebase-app.js",
  "./assets/vendor/firebase-database.js",
  "./assets/logo-square.png",
  "./assets/logo-cropped.png",
  "./assets/logo-white-transparent.png",
  "./assets/logo-blue-transparent.png",
  "./assets/logo-mark-white.png",
  "./assets/logo-mark-blue.png",
  "./assets/favicon.svg",
  "./assets/favicon.png",
  "./assets/apple-touch-icon.png",
  "./assets/icon-192.png",
  "./assets/icon-512.png",
  "./assets/icon-maskable-512.png",
  "./assets/og-image.png"
];

// Install: Cache App Shell
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE);
    }).then(() => self.skipWaiting())
  );
});

// Activate: Hapus cache lama bila versi berubah
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch: Network First, fallback to Cache jika offline
self.addEventListener("fetch", (event) => {
  // Abaikan request bukan GET atau request ke Firebase Realtime Database (WebSocket / REST live)
  if (event.request.method !== "GET" || event.request.url.includes("firebasedatabase.app")) {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        // Simpan salinan di cache
        if (networkResponse && networkResponse.status === 200) {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return networkResponse;
      })
      .catch(() => {
        // Fallback ke cache jika offline
        return caches.match(event.request).then((cachedResponse) => {
          if (cachedResponse) {
            return cachedResponse;
          }
          // Jika request halaman HTML gagal dan tidak ada di cache, arahkan ke index
          if (event.request.headers.get("accept") && event.request.headers.get("accept").includes("text/html")) {
            return caches.match("./index.html");
          }
        });
      })
  );
});
