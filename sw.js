// 浪漫カメラ：ホーム画面から電波なしでも開けるように、アプリ本体をまるごと端末に置いておく。
// 中身を変えたら V を上げる（次に開いたとき新しい版に入れ替わる）。
const V = 'roman-camera-v10';
const FILES = ['./', 'index.html', 'app.js', 'look.js', 'mp4.js', 'video.js', 'exif.js', 'game3d.js', 'logo_white.png', 'logo_vhs.png', 'icon-180.png', 'icon-192.png', 'icon-512.png', 'manifest.webmanifest'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(V).then(c => c.addAll(FILES.map(f => new Request(f, { cache: 'reload' })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(r => r || fetch(e.request).then(res => {   // vendor/（人の切り抜き・約15MB）は初めて使ったときに保存
    if (res.ok && new URL(e.request.url).pathname.includes('/vendor/')) { const c = res.clone(); caches.open(V).then(k => k.put(e.request, c)); }
    return res; })));
});
