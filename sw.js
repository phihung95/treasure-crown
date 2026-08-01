const CACHE = 'tcc-v14';
const SHELL = [
  './', './index.html', './css/styles.css', './manifest.webmanifest',
  './js/ui/app.js', './js/ui/format.js',
  './js/core/money.js', './js/core/ids.js', './js/core/schema.js', './js/core/costing.js',
  './js/core/allocation.js', './js/core/inventory.js', './js/core/sales.js', './js/core/trades.js', './js/core/dashboard.js', './js/core/shows.js',
  './js/data/store.js', './js/data/memstore.js', './js/data/api.js', './js/data/sync.js',
  './js/ui/screens/dashboard.js', './js/ui/screens/shows.js', './js/ui/screens/inventory.js', './js/ui/screens/buy.js',
  './js/ui/screens/sell.js', './js/ui/screens/trade.js', './js/ui/screens/prints.js', './js/ui/screens/settings.js'
];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))); });
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;
  e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request)));
});
