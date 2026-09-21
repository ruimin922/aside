// Service Worker — 网络优先（app 代码走最新），离线才回退到缓存
const CACHE = "mn-pwa-v21";
const SHELL = ["/", "/index.html", "/app.js", "/style.css", "/theme.css", "/manifest.json", "/icons/icon-192.png", "/icons/icon-512.png"];

self.addEventListener("install", (e) => {
  // skipWaiting 立刻生效，不等旧 SW 的页面全部关掉
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {})
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    // 清掉所有旧缓存（含未知前缀），避免残留 stale 文件
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith("mn-pwa-") && k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener("message", (e) => {
  if (e.data && e.data.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);

  // Supabase API：直接走网络，绝不缓存
  if (url.hostname.includes("supabase.co")) return;

  // 同源资源（HTML / JS / CSS / 图标）：网络优先，失败再回缓存
  if (url.origin === self.location.origin) {
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          if (res && res.ok) {
            const clone = res.clone();
            caches.open(CACHE).then((c) => c.put(e.request, clone)).catch(() => {});
          }
          return res;
        })
        .catch(() => caches.match(e.request))
    );
    return;
  }

  // 外部 CDN（Supabase JS 等）：网络优先，失败回缓存
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res && res.ok) {
          const clone = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, clone)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
