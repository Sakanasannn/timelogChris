
const CACHE_NAME = 'timelog-chris-v3';

const APP_FILES = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',

  // Chris 台词与收藏模块
  './chris-lines.js',
  './seasonal-lines.js',
  './collection.js'
];

// 安装：预缓存应用文件
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_FILES))
      .then(() => self.skipWaiting())
  );
});

// 激活：清理旧缓存，并接管页面
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(cacheNames => {
        return Promise.all(
          cacheNames
            .filter(name => name !== CACHE_NAME)
            .map(name => caches.delete(name))
        );
      })
      .then(() => self.clients.claim())
  );
});

// 请求：优先使用缓存，网络可用时更新缓存
self.addEventListener('fetch', event => {
  const request = event.request;

  // 只处理 GET 请求
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // 不拦截其他网站的请求
  if (url.origin !== self.location.origin) return;

  // 页面导航：网络优先，离线时返回缓存首页
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(response => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => {
            cache.put('./index.html', copy);
          });
          return response;
        })
        .catch(() => {
          return caches.match('./index.html');
        })
    );
    return;
  }

  // 静态文件：缓存优先，缓存没有时请求网络
  event.respondWith(
    caches.match(request).then(cachedResponse => {
      if (cachedResponse) return cachedResponse;

      return fetch(request).then(response => {
        if (response && response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => {
            cache.put(request, copy);
          });
        }
        return response;
      });
    })
  );
});
