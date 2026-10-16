// Service Worker: App offline, Bilder dauerhaft im Cache, Wetter/APIs netzwerk-zuerst
const VERSION = 'madeira26-v1';
const SHELL = ['./', 'index.html', 'styles.css', 'app.js', 'data.js', 'manifest.webmanifest', 'icon-180.png', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION && k !== 'madeira26-img').map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request; if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Bilder von Wikimedia: Cache zuerst
  if (/(^|\.)wikimedia\.org$/.test(url.hostname) && !url.pathname.startsWith('/w/api.php')) {
    e.respondWith(caches.open('madeira26-img').then(async c => {
      const hit = await c.match(req.url); if (hit) return hit;
      try { const r = await fetch(req); if (r.ok || r.type === 'opaque') c.put(req.url, r.clone()); return r; } catch { return Response.error(); }
    }));
    return;
  }
  // Eigene Dateien: Cache sofort, im Hintergrund aktualisieren
  if (url.origin === location.origin) {
    e.respondWith(caches.open(VERSION).then(async c => {
      const hit = await c.match(req, { ignoreSearch: true });
      const net = fetch(req).then(r => { if (r.ok) c.put(req, r.clone()); return r; }).catch(() => hit);
      return hit || net;
    }));
    return;
  }
  // APIs (Open-Meteo, Commons-Suche): Netz zuerst, sonst Cache
  e.respondWith(fetch(req).then(r => { const cl = r.clone(); caches.open(VERSION).then(c => c.put(req, cl)); return r; })
    .catch(() => caches.match(req)));
});
