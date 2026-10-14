/* Nyxdesk service worker — caches the app shell so it keeps working offline.
   No analytics, no remote fetches: everything it caches comes from this same origin. */
const CACHE = "nyxdesk-v1";
const SHELL = [
  "./", "./index.html", "./inkwell.html", "./abacus.html", "./marquee.html", "./parchment.html",
  "./css/base.css", "./css/home.css", "./css/inkwell.css", "./css/abacus.css", "./css/marquee.css", "./css/parchment.css",
  "./js/core.js", "./js/icons.js", "./js/inkwell.js", "./js/abacus.js", "./js/marquee.js", "./js/parchment.js",
  "./vendor/pdf-lib.min.js", "./vendor/jszip.min.js", "./vendor/docx.min.js", "./vendor/pptxgen.min.js",
  "./vendor/pdfjs/pdf.min.mjs", "./vendor/pdfjs/pdf.worker.min.mjs",
  "./manifest.webmanifest", "./favicon.svg"
];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => Promise.all(SHELL.map(u => c.add(u).catch(() => {})))));
  self.skipWaiting();
});

self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener("fetch", e => {
  if(e.request.method !== "GET") return;
  const url = new URL(e.request.url);
  if(url.origin !== location.origin) return;
  e.respondWith(
    caches.match(e.request).then(cached => {
      const fetchPromise = fetch(e.request).then(res => {
        if(res && res.ok) caches.open(CACHE).then(c => c.put(e.request, res.clone()));
        return res;
      }).catch(() => cached);
      return cached || fetchPromise;
    })
  );
});
