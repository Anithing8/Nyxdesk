/* Nyxdesk service worker
   - keeps the app working offline
   - receives files shared to Nyxdesk from a phone's share sheet (Android/Chrome "share_target")
   Nothing here talks to any other origin. */
const CACHE = "nyxdesk-v2";
const SHELL = [
  "./", "./index.html", "./inkwell.html", "./abacus.html", "./marquee.html", "./parchment.html",
  "./css/base.css", "./css/home.css", "./css/inkwell.css", "./css/abacus.css", "./css/marquee.css", "./css/parchment.css",
  "./js/core.js", "./js/icons.js", "./js/backdrop.js", "./js/inkwell.js", "./js/abacus.js", "./js/marquee.js", "./js/parchment.js",
  "./vendor/pdf-lib.min.js", "./vendor/jszip.min.js", "./vendor/docx.min.js", "./vendor/pptxgen.min.js",
  "./vendor/pdfjs/pdf.min.mjs", "./vendor/pdfjs/pdf.worker.min.mjs",
  "./manifest.webmanifest", "./favicon.svg", "./icons/icon-192.png", "./icons/icon-512.png", "./icons/apple-touch-icon.png"
];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => Promise.all(SHELL.map(u => c.add(u).catch(() => {})))));
  self.skipWaiting();
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});

function putHandoff(file){
  return file.arrayBuffer().then(buf => new Promise((res, rej) => {
    const r = indexedDB.open("nyxdesk", 1);
    r.onupgradeneeded = () => { const d = r.result; if(!d.objectStoreNames.contains("meta")) d.createObjectStore("meta", { keyPath: "id" }); if(!d.objectStoreNames.contains("data")) d.createObjectStore("data"); if(!d.objectStoreNames.contains("handoff")) d.createObjectStore("handoff"); };
    r.onerror = () => rej(r.error);
    r.onsuccess = () => {
      const tx = r.result.transaction("handoff", "readwrite");
      tx.objectStore("handoff").put({ name: file.name, type: file.type, buf }, "f");
      tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error);
    };
  }));
}

self.addEventListener("fetch", e => {
  const req = e.request, url = new URL(req.url);
  if(req.method === "POST" && url.pathname.endsWith("/share-target")){
    e.respondWith((async () => {
      let ok = false;
      try{
        const fd = await req.formData();
        const f = fd.getAll("file").find(x => x && x.name);
        if(f){ await putHandoff(f); ok = true; }
      }catch(_){}
      return Response.redirect(new URL(ok ? "./?shared=1" : "./?shared=0", self.registration.scope).href, 303);
    })());
    return;
  }
  if(req.method !== "GET" || url.origin !== location.origin) return;
  const heavy = url.pathname.includes("/vendor/");
  if(heavy){
    /* big, never-changing libraries: cache first */
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => { if(res && res.ok) caches.open(CACHE).then(c => c.put(req, res.clone())); return res; })));
    return;
  }
  /* our own pages, scripts and styles: network first so fixes arrive immediately, cache when offline */
  e.respondWith(fetch(req).then(res => { if(res && res.ok) caches.open(CACHE).then(c => c.put(req, res.clone())); return res; })
    .catch(() => caches.match(req, { ignoreSearch: true }).then(hit => hit || caches.match("./index.html"))));
});
