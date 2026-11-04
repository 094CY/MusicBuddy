// MusicBuddy Service Worker
// 构建时由 vite.config.ts 把 __MUSICBUDDY_BUILD_ID__ 替换为本次构建 ID，
// 脚本内容变化 → 浏览器触发 install/update → activate 清理旧版本缓存。
const BUILD_ID = '__MUSICBUDDY_BUILD_ID__';
const CACHE_PREFIX = 'musicbuddy-';
const CACHE_NAME = `${CACHE_PREFIX}${BUILD_ID}`;

// App Shell 离线兜底（相对路径，兼容子路径部署）
const SHELL_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './favicon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(SHELL_ASSETS))
      .catch(() => { /* 单个资源失败不阻断安装 */ })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys
        .filter((k) => k.startsWith(CACHE_PREFIX) && k !== CACHE_NAME)
        .map((k) => caches.delete(k))
    )).then(() => self.clients.claim())
  );
});

// 允许页面主动触发 skipWaiting（用于「发现新版本 → 立即刷新」）
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  // 同源之外的请求（音源、字体、封面）一律不缓存
  if (url.origin !== self.location.origin) return;
  // API 与音频流不走缓存
  if (url.pathname.includes('/api/') || /\.(mp3|m4a|flac|ogg|wav)(\?|$)/i.test(url.pathname)) return;

  // 1) 页面导航 + index.html：network-first，保证发版后一定拿到最新 HTML
  if (req.mode === 'navigate' || url.pathname.endsWith('/index.html') || url.pathname.endsWith('/')) {
    event.respondWith(
      fetch(req)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put('./index.html', clone));
          }
          return response;
        })
        .catch(() => caches.match('./index.html').then((cached) => cached || new Response('Offline', { status: 503 })))
    );
    return;
  }

  // 2) 带内容 hash 的构建产物：cache-first（文件名变了自然取新版）
  const isHashedAsset = /\/assets\/[^/]*[-_][A-Za-z0-9_-]{6,}\.(js|css|woff2?|png|svg)$/.test(url.pathname);
  if (isHashedAsset) {
    event.respondWith(
      caches.match(req).then((cached) => cached || fetch(req).then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
        }
        return response;
      }))
    );
    return;
  }

  // 3) 其余同源静态资源：stale-while-revalidate
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req).then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
        }
        return response;
      }).catch(() => cached || new Response('Offline', { status: 503 }));
      return cached || network;
    })
  );
});
