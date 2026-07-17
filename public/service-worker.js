'use strict';

// 최소한의 서비스 워커: PWA "홈 화면에 추가" 설치 조건을 만족시키기 위한 용도.
// 시세 데이터(/api/*)는 실시간이어야 하므로 캐싱하지 않고, 앱 껍데기(HTML/CSS/JS/아이콘)만
// 가볍게 캐시해 오프라인에서도 화면 자체는 뜨도록 한다.

const CACHE_NAME = 'market-dashboard-shell-v1';
const SHELL_FILES = [
  '/',
  '/index.html',
  '/styles.css',
  '/app.js',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES).catch(() => {}))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // API 호출(/api/*)은 항상 최신 데이터가 필요하므로 캐시를 거치지 않고 그대로 네트워크로.
  if (url.pathname.startsWith('/api/')) return;

  // 그 외 정적 파일은 네트워크 우선, 실패하면 캐시로 폴백(오프라인 대비).
  event.respondWith(
    fetch(event.request)
      .then((res) => {
        const resClone = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, resClone));
        return res;
      })
      .catch(() => caches.match(event.request))
  );
});
