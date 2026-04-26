// AKR記帳本 Service Worker
// ⚠️ 每次部署新版本，請遞增 CACHE 版本號，舊快取會在 activate 時自動清除
const CACHE = "akr-ledger-v58";

const STATIC_ASSETS = [
  "./manifest.json",
  "./icon.svg",
  "./icon-192.png",
  "./icon-512.png",
];

// ── Install：預快取靜態資源（不含 index.html，讓它走 network-first）
self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(STATIC_ASSETS)).catch(() => {})
  );
  self.skipWaiting();
});

// ── Activate：清除所有舊版本快取
self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// ── Fetch 策略
self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  const isSameOrigin = url.origin === location.origin;
  const isHTML = req.destination === "document" || url.pathname.endsWith(".html") || url.pathname === "/" || url.pathname.endsWith("/");

  // ── 同源 HTML：Network-first（確保新版本即時生效）
  if (isSameOrigin && isHTML) {
    e.respondWith(
      fetch(req)
        .then(res => {
          // 成功從網路取得，更新快取
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(req).then(hit => hit || caches.match("./index.html")))
    );
    return;
  }

  // ── 同源靜態資源（icon, manifest 等）：Cache-first
  if (isSameOrigin) {
    e.respondWith(
      caches.match(req).then(hit => {
        if (hit) return hit;
        return fetch(req).then(res => {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
          return res;
        }).catch(() => new Response("", { status: 404 }));
      })
    );
    return;
  }

  // ── CDN 資源（React, Tailwind, Babel 等）：Stale-while-revalidate
  e.respondWith(
    caches.match(req).then(hit => {
      const fetcher = fetch(req).then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
        return res;
      }).catch(() => hit);
      return hit || fetcher;
    })
  );
});
