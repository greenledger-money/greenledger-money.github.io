// Service Worker：快取 app 本身，讓它可以加入主畫面、沒網路時也能打開（看最後一次的資料）。
// 記帳資料不經過這裡快取（由 app 自己存最後一次的快照）。
const VERSION = '__VERSION__';
const PRECACHE = __PRECACHE__;
const CACHE = `ledger-${VERSION}`;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith('ledger-') && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch {
    return (await cache.match(req, { ignoreSearch: true })) || (await cache.match('./index.html')) || Response.error();
  }
}

async function cacheFirst(req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok || res.type === 'opaque') cache.put(req, res.clone());
  return res;
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.hostname.endsWith('.supabase.co')) return; // API 不快取
  if (req.mode === 'navigate' || url.pathname.endsWith('/config.js')) { e.respondWith(networkFirst(req)); return; }
  if (url.origin === self.location.origin || url.hostname === 'cdn.jsdelivr.net') e.respondWith(cacheFirst(req));
});
