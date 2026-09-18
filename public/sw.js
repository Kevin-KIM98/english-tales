// 앱 셸은 캐시 우선, 레슨 데이터는 네트워크 우선(오프라인이면 캐시)으로 제공
const SHELL = 'et-shell-v3';
const DATA = 'et-data-v1';
const AUDIO = 'et-audio-v1';
const ASSETS = ['/', '/index.html', '/app.css', '/app.js', '/merge.js', '/icon.svg', '/manifest.webmanifest'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => ![SHELL, DATA, AUDIO].includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  // 원어민 발음 MP3: 한 번 들은 문장은 오프라인에서도 반복 재생 (캐시 우선)
  if (url.pathname === '/api/tts') {
    e.respondWith(
      caches.open(AUDIO).then(async (c) => {
        const hit = await c.match(e.request.url);
        if (hit) return hit;
        const res = await fetch(e.request);
        if (res.ok) c.put(e.request.url, res.clone());
        return res;
      }),
    );
    return;
  }
  if (url.pathname.startsWith('/api/lesson/') || url.pathname.startsWith('/api/channel')) {
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          if (res.status === 200) {
            const copy = res.clone();
            const key = url.pathname.startsWith('/api/lesson/') ? url.pathname : e.request.url;
            caches.open(DATA).then((c) => c.put(key, copy));
          }
          return res;
        })
        .catch(() =>
          caches.match(url.pathname.startsWith('/api/lesson/') ? url.pathname : e.request.url, { cacheName: DATA })
            .then((r) => r || new Response(JSON.stringify({ error: '오프라인 상태입니다' }), { status: 503, headers: { 'Content-Type': 'application/json' } })),
        ),
    );
    return;
  }
  if (url.pathname.startsWith('/api/')) return;
  // 앱 셸: 네트워크 먼저 시도해 최신 버전을 받고, 실패하면 캐시
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(SHELL).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request).then((r) => r || caches.match('/index.html'))),
  );
});
