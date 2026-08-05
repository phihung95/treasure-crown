const CACHE = 'tcc-v57';
const SHELL = [
  './', './index.html', './css/styles.css', './manifest.webmanifest',
  './js/ui/app.js', './js/ui/format.js', './js/config.js',
  './js/core/money.js', './js/core/ids.js', './js/core/schema.js', './js/core/costing.js',
  './js/core/allocation.js', './js/core/inventory.js', './js/core/sales.js', './js/core/trades.js', './js/core/dashboard.js', './js/core/shows.js', './js/core/csv.js', './js/core/cash.js', './js/core/collectr.js',
  './js/data/store.js', './js/data/memstore.js', './js/data/api.js', './js/data/sync.js', './js/data/auth.js', './js/data/drafts.js', './js/data/shownames.js', './js/data/sources.js',
  './js/ui/screens/dashboard.js', './js/ui/screens/shows.js', './js/ui/screens/inventory.js', './js/ui/screens/buy.js',
  './js/ui/screens/sell.js', './js/ui/screens/trade.js', './js/ui/screens/prints.js', './js/ui/screens/cash.js', './js/ui/screens/expenses.js', './js/ui/screens/import.js', './js/ui/screens/settings.js'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim(); // take control of open tabs immediately
  })());
});

// Network-first for same-origin GETs: always serve the latest deploy when
// online (and refresh the cache), fall back to cache only when offline. This
// keeps the app fully usable offline at shows without ever serving stale code.
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin || e.request.method !== 'GET') return;
  // Never cache the Supabase proxy — always go to the network for live data.
  if (url.pathname.startsWith('/api/')) return;
  e.respondWith((async () => {
    try {
      const fresh = await fetch(e.request);
      const cache = await caches.open(CACHE);
      cache.put(e.request, fresh.clone());
      return fresh;
    } catch {
      const cached = await caches.match(e.request);
      return cached || Response.error();
    }
  })());
});
