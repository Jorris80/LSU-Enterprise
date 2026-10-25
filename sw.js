/* LSU Enterprise Platform — Service Worker (mode offline PWA)
 * - App shell & pustaka CDN: cache-first (tersedia offline setelah kunjungan pertama)
 * - Tile peta yang PERNAH dilihat: cache-first, dibatasi 3.000 tile (tanpa prefetch massal — patuh kebijakan tile OSM)
 * - Panggilan API (POST ke script.google.com) TIDAK di-cache; antrean offline ditangani aplikasi (IndexedDB)
 */
var VERSION = 'lsu-v2.0.0';
var STATIC = VERSION + '-static';
var TILES = 'lsu-tiles';
var MAX_TILES = 3000;
var PRECACHE = [
  './', 'index.html', 'manifest.json', 'icon-192.png', 'icon-512.png',
  'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.css',
  'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js',
  'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/images/layers.png',
  'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/images/layers-2x.png',
  'https://cdn.jsdelivr.net/npm/pmtiles@4.3.0/dist/pmtiles.js',
  'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js',
  'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js'
];
var TILE_HOSTS = /(^|\.)tile\.openstreetmap\.org$|(^|\.)server\.arcgisonline\.com$|(^|\.)tile\.opentopomap\.org$/;

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(STATIC).then(function (c) {
    return Promise.all(PRECACHE.map(function (u) { return c.add(new Request(u, { cache: 'reload' })).catch(function () { /* lanjut walau satu gagal */ }); }));
  }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== STATIC && k !== TILES; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

function trimTiles() {
  return caches.open(TILES).then(function (c) { return c.keys().then(function (keys) { if (keys.length <= MAX_TILES) return; return Promise.all(keys.slice(0, keys.length - MAX_TILES).map(function (k) { return c.delete(k); })); }); });
}

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;                       // API POST → langsung ke jaringan
  if (req.headers.get('range')) return;                    // PMTiles remote (HTTP Range) → jangan di-cache
  var url = new URL(req.url);
  if (/script\.google(usercontent)?\.com$/.test(url.hostname)) return;

  if (TILE_HOSTS.test(url.hostname)) {
    e.respondWith(caches.open(TILES).then(function (c) {
      return c.match(req).then(function (hit) {
        if (hit) return hit;
        return fetch(req).then(function (res) { if (res && (res.ok || res.type === 'opaque')) { c.put(req, res.clone()); trimTiles(); } return res; })
          .catch(function () { return new Response('', { status: 504, statusText: 'offline' }); });
      });
    }));
    return;
  }

  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then(function (res) { var cp = res.clone(); caches.open(STATIC).then(function (c) { c.put('index.html', cp); }); return res; })
      .catch(function () { return caches.match('index.html').then(function (r) { return r || caches.match('./'); }); }));
    return;
  }

  if (url.hostname === 'cdn.jsdelivr.net' || url.origin === self.location.origin) {
    e.respondWith(caches.match(req).then(function (hit) {
      var net = fetch(req).then(function (res) { if (res && res.ok) { var cp = res.clone(); caches.open(STATIC).then(function (c) { c.put(req, cp); }); } return res; }).catch(function () { return hit; });
      return hit || net;
    }));
  }
});

self.addEventListener('message', function (e) { if (e.data === 'skipWaiting') self.skipWaiting(); });
