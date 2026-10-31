// 浪漫カメラ「ゲーム」モード：写真・動画の人を切り抜き、立体に膨らませて PS1 風の 3D の世界に立たせる。
// 背景は5つ（秋の公園・夜の街・雪山・海辺・和の路地）。世界はここで作る（低ポリ・64px の粗いテクスチャ・霧・頂点のガタつき・アフィンのゆがみ）。
// 人の切り抜きは MediaPipe（vendor/ に同梱・端末の中だけで動く）。人がいないときは写真を看板にして立てる。
import { rng } from './look.js';

const RW = 270, RH = 480;   // PS1 くらいの粗さで描く（表示は 4 倍に拡大）
export const SCENES = [['park', '秋の公園'], ['night', '夜の街'], ['snow', '雪山'], ['beach', '海辺'], ['wa', '和の路地']];
let segPromise = null;
export function loadSegmenter() {   // 初回だけ読み込む（約15MB。以後はオフラインでも使える）
  if (!segPromise) segPromise = (async () => {
    const { FilesetResolver, ImageSegmenter } = await import('./vendor/mediapipe/vision_bundle.mjs');
    const fs = await FilesetResolver.forVisionTasks(new URL('vendor/mediapipe/wasm', import.meta.url).href.replace(/\/$/, ''));
    return ImageSegmenter.createFromOptions(fs, { baseOptions: { modelAssetPath: new URL('vendor/mediapipe/selfie_segmenter.tflite', import.meta.url).href },
      runningMode: 'IMAGE', outputConfidenceMasks: true, outputCategoryMask: false });
  })();
  return segPromise;
}

const VS = `#version 300 es
in vec3 pos; in vec2 uv; in float shade;
uniform mat4 mvp; uniform vec2 snap; uniform vec2 fog;
out vec2 vuvw; out float vw; out float vsh; out float vfog;
void main() { vec4 c = mvp * vec4(pos, 1.0); vec2 n = c.xy / c.w; n = floor(n * snap + 0.5) / snap; c.xy = n * c.w;   // 頂点のガタつき
  gl_Position = c; vuvw = uv * c.w; vw = c.w; vsh = shade; vfog = clamp((c.w - fog.x) / (fog.y - fog.x), 0.0, 1.0); }`;
const FS = `#version 300 es
precision highp float;
in vec2 vuvw; in float vw; in float vsh; in float vfog; uniform sampler2D tex; uniform vec3 fogc; out vec4 o;
void main() { vec4 t = texture(tex, vuvw / vw); if (t.a < 0.5) discard;   // アフィン（PS1 のテクスチャのゆがみ）
  o = vec4(mix(t.rgb * vsh, fogc, vfog), 1.0); }`;
const SKY_FS = `#version 300 es
precision highp float; out vec4 o; uniform float h; uniform vec3 lo; uniform vec3 hi;
void main() { float y = 1.0 - gl_FragCoord.y / h; o = vec4(mix(lo, hi, smoothstep(0.45, 1.0, y)), 1.0); }`;

function mat4persp(fov, asp, n, f) { const t = 1 / Math.tan(fov / 2); return [t / asp, 0, 0, 0, 0, t, 0, 0, 0, 0, (f + n) / (n - f), -1, 0, 0, 2 * f * n / (n - f), 0]; }
function mat4look(e, c, u) {
  const z = norm([e[0] - c[0], e[1] - c[1], e[2] - c[2]]), x = norm(cross(u, z)), y = cross(z, x);
  return [x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x, e), -dot(y, e), -dot(z, e), 1];
}
function mul(a, b) { const o = new Array(16).fill(0); for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) for (let k = 0; k < 4; k++) o[j * 4 + i] += a[k * 4 + i] * b[j * 4 + k]; return o; }
const norm = v => { const l = Math.hypot(...v) || 1; return v.map(x => x / l); }, cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]], dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const LIGHT = norm([0.5, 0.8, 0.6]);

// ── 世界のテクスチャ（64px のタイルを 4 列×5 行）
const TILE = 64, ROWS = 5;
function atlas() {
  const c = document.createElement('canvas'); c.width = TILE * 4; c.height = TILE * ROWS; const x = c.getContext('2d'), r = rng(7);
  const blot = (tx, ty, cols, n, s) => { for (let i = 0; i < n; i++) { x.fillStyle = cols[Math.floor(r() * cols.length)]; const w = 1 + Math.floor(r() * s); x.fillRect(tx * TILE + Math.floor(r() * TILE), ty * TILE + Math.floor(r() * TILE), w, w); } };
  const fill = (tx, ty, col) => { x.fillStyle = col; x.fillRect(tx * TILE, ty * TILE, TILE, TILE); };
  const rect = (tx, ty, col, X, Y, w, h) => { x.fillStyle = col; x.fillRect(tx * TILE + X, ty * TILE + Y, w, h); };
  fill(0, 0, '#7a3a1c'); blot(0, 0, ['#a4501f', '#c86a24', '#5e2c16', '#d98a2b', '#8f4a22', '#b23b1e'], 900, 4);              // 落ち葉
  fill(1, 0, '#4a3326'); for (let i = 0; i < 9; i++) rect(1, 0, i % 2 ? '#3a281d' : '#5b4031', i * 7, 0, 3 + (i % 3), TILE);   // 幹
  fill(2, 0, '#c4521c'); blot(2, 0, ['#e07a22', '#f2a33a', '#9e3418', '#d8641e', '#ffcf5a', '#7d2a14'], 700, 5);               // 紅葉
  fill(3, 0, '#8a7f74'); for (let y = 0; y < TILE; y += 8) rect(3, 0, '#6d645b', 0, y, TILE, 1);                                // 壁＋窓
  for (let wy = 6; wy < TILE - 8; wy += 16) for (let wx = 5; wx < TILE - 8; wx += 15) rect(3, 0, r() < 0.4 ? '#ffd27a' : '#2b3442', wx, wy, 8, 9);
  fill(0, 1, '#5d4632'); blot(0, 1, ['#6e5540', '#4d3a2a', '#7c6249'], 400, 3);                                                   // 土の道
  fill(1, 1, '#3f3f46'); blot(1, 1, ['#4f4f58', '#35353b'], 200, 3);                                                               // 屋根
  fill(2, 1, '#2f5a2b'); blot(2, 1, ['#3f7238', '#24461f', '#5b8a3a', '#7f6a2a'], 700, 5);                                         // 常緑樹
  fill(3, 1, '#26262b'); rect(3, 1, '#ffe9a8', 26, 2, 12, 10);                                                                     // 街灯
  fill(0, 2, '#e8eef6'); blot(0, 2, ['#ffffff', '#cfd9e8', '#dfe6f0'], 500, 3);                                                     // 雪
  fill(1, 2, '#24262e'); blot(1, 2, ['#2e3140', '#1c1d24', '#3a2d48'], 400, 3); rect(1, 2, '#d8d070', 30, 0, 4, TILE);              // 夜の道路（中央線）
  fill(2, 2, '#2c5a44'); blot(2, 2, ['#ffffff', '#e4eef6', '#3d6e55', '#1f4434'], 600, 4);                                         // 雪の針葉樹
  fill(3, 2, '#1a1030'); rect(3, 2, '#ff3ea5', 6, 10, 52, 16); rect(3, 2, '#3ef0ff', 10, 36, 44, 14); rect(3, 2, '#ffe14a', 22, 54, 20, 6);   // ネオン
  fill(0, 3, '#e3c98f'); blot(0, 3, ['#f0d9a4', '#cfb27a', '#f6e6bd'], 600, 3);                                                     // 砂
  fill(1, 3, '#1f7fb0'); blot(1, 3, ['#2b98c8', '#1a6a99', '#9fe2f5', '#3fb2d8'], 500, 5);                                         // 海
  fill(2, 3, '#3e8a2e'); blot(2, 3, ['#59a83a', '#2c6b22', '#8cc84e'], 600, 5);                                                     // ヤシの葉
  fill(3, 3, '#6b4a2e'); for (let i = 0; i < TILE; i += 8) rect(3, 3, '#4a311d', i, 0, 2, TILE); rect(3, 3, '#e9dcc0', 12, 14, 40, 26); for (let i = 12; i < 52; i += 8) rect(3, 3, '#6b4a2e', i, 14, 1, 26);   // 和の壁＋障子
  fill(0, 4, '#8a8a86'); for (let y = 0; y < TILE; y += 16) for (let xx = (y / 16) % 2 * 8; xx < TILE; xx += 16) rect(0, 4, '#6f6f6a', xx, y, 15, 15);   // 石畳
  fill(1, 4, '#c2271c'); rect(1, 4, '#ffcf66', 8, 16, 48, 32); rect(1, 4, '#2a1a12', 0, 0, TILE, 6); rect(1, 4, '#2a1a12', 0, TILE - 6, TILE, 6);   // 提灯
  fill(2, 4, '#3a3d48'); for (let y = 0; y < TILE; y += 8) rect(2, 4, '#2a2c34', 0, y, TILE, 2);                                  // 瓦
  fill(3, 4, '#151a2c'); for (let wy = 4; wy < TILE - 6; wy += 12) for (let wx = 4; wx < TILE - 6; wx += 12) rect(3, 4, r() < 0.55 ? (r() < 0.5 ? '#7fd8ff' : '#ffd27a') : '#232a40', wx, wy, 7, 8);   // 夜のビル
  return c;
}
const T = (tx, ty) => [tx / 4, ty / ROWS, (tx + 1) / 4, (ty + 1) / ROWS];

// ── 低ポリの形（面ごとに光の当たり方で明るさを変える＝角ばった陰影）
const faceShade = (a, b, c) => { const n = norm(cross([b[0] - a[0], b[1] - a[1], b[2] - a[2]], [c[0] - a[0], c[1] - a[1], c[2] - a[2]])); return 0.55 + 0.45 * Math.abs(dot(n, LIGHT)); };
function tri(V, a, b, c, ua, ub, uc, sh) { V.push(a[0], a[1], a[2], ua[0], ua[1], sh, b[0], b[1], b[2], ub[0], ub[1], sh, c[0], c[1], c[2], uc[0], uc[1], sh); }
function quad(V, a, b, c, d, t, sh) {   // a b c d は反時計回り
  const [u0, v0, u1, v1] = t, s = sh ?? faceShade(a, b, c);
  tri(V, a, b, c, [u0, v1], [u1, v1], [u1, v0], s); tri(V, a, c, d, [u0, v1], [u1, v0], [u0, v0], s);
}
function prism(V, cx, cz, r, y0, y1, sides, t, rot) {
  for (let i = 0; i < sides; i++) {
    const a0 = rot + i / sides * Math.PI * 2, a1 = rot + (i + 1) / sides * Math.PI * 2, p = a => [cx + Math.cos(a) * r, cz + Math.sin(a) * r];
    const [x0, z0] = p(a0), [x1, z1] = p(a1); quad(V, [x0, y0, z0], [x1, y0, z1], [x1, y1, z1], [x0, y1, z0], t);
  }
}
function cone(V, cx, cz, r, y0, y1, sides, t, rot, flat = 1) {
  const [u0, v0, u1, v1] = t;
  for (let i = 0; i < sides; i++) {
    const a0 = rot + i / sides * Math.PI * 2, a1 = rot + (i + 1) / sides * Math.PI * 2;
    const A = [cx + Math.cos(a0) * r, y0, cz + Math.sin(a0) * r * flat], B = [cx + Math.cos(a1) * r, y0, cz + Math.sin(a1) * r * flat], C = [cx, y1, cz], D = [cx, y0 - r * 0.5 * flat, cz];
    tri(V, A, B, C, [u0, v1], [u1, v1], [(u0 + u1) / 2, v0], faceShade(A, B, C) * 1.05); tri(V, B, A, D, [u1, v1], [u0, v1], [(u0 + u1) / 2, v0], 0.5);
  }
}
function box(V, cx, cz, w, d, h, t, tr, y0 = 0) {
  const x0 = cx - w / 2, x1 = cx + w / 2, z0 = cz - d / 2, z1 = cz + d / 2, y1 = y0 + h;
  quad(V, [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], t); quad(V, [x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], t);
  quad(V, [x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], t); quad(V, [x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], t);
  quad(V, [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], tr);
}
function roof(V, cx, cz, w, d, y, h, t) {   // 切妻屋根
  const x0 = cx - w / 2 - 0.3, x1 = cx + w / 2 + 0.3, z0 = cz - d / 2 - 0.3, z1 = cz + d / 2 + 0.3;
  quad(V, [x0, y, z1], [x1, y, z1], [x1, y + h, cz], [x0, y + h, cz], t); quad(V, [x1, y, z0], [x0, y, z0], [x0, y + h, cz], [x1, y + h, cz], t);
}
function ground(V, pick, r) { for (let gz = -14; gz < 14; gz++) for (let gx = -14; gx < 14; gx++) quad(V, [gx * 1.6, 0, (gz + 1) * 1.6], [(gx + 1) * 1.6, 0, (gz + 1) * 1.6], [(gx + 1) * 1.6, 0, gz * 1.6], [gx * 1.6, 0, gz * 1.6], pick(gx, gz), 0.85 + 0.15 * r()); }
const around = (r, f) => { for (let i = 0; i < 60; i++) { const a = r() * Math.PI * 2, d = 4 + r() * 17, x = Math.cos(a) * d, z = Math.sin(a) * d; if (Math.abs(x) < 1.8 && z > -2) continue; f(x, z); } };

// ── 背景（空の色・霧・形）
const SCENE = {
  park: { sky: [[0.98, 0.62, 0.42], [0.42, 0.36, 0.58]], fog: [0.93, 0.6, 0.45], build(V, r) {
    ground(V, (gx, gz) => Math.abs(gx) < 1 ? T(0, 1) : T(0, 0), r);
    around(r, (x, z) => { const h = 2.2 + r() * 1.8, ev = r() < 0.2; prism(V, x, z, 0.16, 0, h * 0.55, 5, T(1, 0), r());
      cone(V, x, z, 1 + r() * 0.5, h * 0.45, h * 1.05, 6, ev ? T(2, 1) : T(2, 0), r()); cone(V, x, z, 0.8, h * 0.85, h * 1.4, 5, ev ? T(2, 1) : T(2, 0), r()); });
    for (let i = 0; i < 9; i++) { const a = -Math.PI / 2 + (i - 4) * 0.33; box(V, Math.cos(a) * 24, Math.sin(a) * 24, 4 + r() * 3, 4, 5 + r() * 8, T(3, 0), T(1, 1)); }
    for (const [x, z] of [[-2.2, -3], [2.4, -6], [-2.6, -10]]) { prism(V, x, z, 0.07, 0, 2.6, 4, T(3, 1), 0); box(V, x, z, 0.35, 0.35, 0.3, T(3, 1), T(3, 1), 2.6); } } },
  night: { sky: [[0.32, 0.16, 0.42], [0.04, 0.05, 0.14]], fog: [0.14, 0.1, 0.26], build(V, r) {
    ground(V, (gx) => Math.abs(gx) < 2 ? T(1, 2) : T(1, 1), r);
    for (const side of [-1, 1]) for (let z = 4; z > -30; z -= 5 + r() * 2) { const w = 4 + r() * 2, h = 6 + r() * 14, x = side * (5 + w / 2);
      box(V, x, z, w, 4.5, h, T(3, 4), T(1, 1)); if (r() < 0.7) box(V, side * 4.9, z, 0.2, 2.2, 1.3, T(3, 2), T(3, 2), 2.5 + r() * 3); }
    for (let z = 2; z > -26; z -= 7) for (const side of [-1, 1]) { prism(V, side * 3.6, z, 0.06, 0, 3.2, 4, T(3, 1), 0); box(V, side * 3.6, z, 0.4, 0.4, 0.25, T(3, 1), T(3, 1), 3.2); } } },
  snow: { sky: [[0.86, 0.92, 0.98], [0.42, 0.6, 0.86]], fog: [0.86, 0.9, 0.96], build(V, r) {
    ground(V, () => T(0, 2), r);
    around(r, (x, z) => { const h = 2.4 + r() * 2.2; prism(V, x, z, 0.14, 0, h * 0.3, 5, T(1, 0), r());
      cone(V, x, z, 1.1, h * 0.25, h * 0.75, 6, T(2, 2), r()); cone(V, x, z, 0.8, h * 0.6, h * 1.05, 6, T(2, 2), r()); cone(V, x, z, 0.5, h * 0.9, h * 1.35, 5, T(2, 2), r()); });
    for (let i = 0; i < 7; i++) { const a = -Math.PI / 2 + (i - 3) * 0.45, d = 32 + r() * 6; cone(V, Math.cos(a) * d, Math.sin(a) * d, 9 + r() * 5, 0, 12 + r() * 8, 6, T(0, 2), r()); } } },
  beach: { sky: [[0.98, 0.9, 0.72], [0.3, 0.68, 0.95]], fog: [0.9, 0.92, 0.95], build(V, r) {
    ground(V, (gx, gz) => gz < -4 ? T(1, 3) : T(0, 3), r);
    for (let i = 0; i < 22; i++) { const x = (r() - 0.5) * 30, z = 2 + r() * 14; if (Math.abs(x) < 2) continue;   // ヤシの木（手前側）
      const h = 3 + r() * 1.5, lean = (r() - 0.5) * 0.8; for (let s = 0; s < 4; s++) prism(V, x + lean * s / 4 * h * 0.2, z, 0.14 - s * 0.02, h * s / 4, h * (s + 1) / 4, 5, T(1, 0), 0);
      for (let k = 0; k < 6; k++) cone(V, x + lean * h * 0.2 + Math.cos(k) * 0.9, z + Math.sin(k) * 0.9, 1.0, h - 0.2, h + 0.25, 4, T(2, 3), k, 0.35); }
    for (let i = 0; i < 4; i++) box(V, -12 + i * 8, -40, 5, 2, 1.5 + r() * 3, T(0, 3), T(2, 3)); } },
  wa: { sky: [[0.98, 0.7, 0.45], [0.5, 0.4, 0.6]], fog: [0.9, 0.7, 0.55], build(V, r) {
    ground(V, (gx) => Math.abs(gx) < 2 ? T(0, 4) : T(0, 1), r);
    for (const side of [-1, 1]) for (let z = 3; z > -28; z -= 5) { const w = 3.6, h = 2.6 + r() * 0.8, x = side * (3.6 + w / 2);
      box(V, x, z, w, 4.4, h, T(3, 3), T(2, 4)); roof(V, x, z, w, 4.4, h, 1.2, T(2, 4));
      box(V, side * 3.3, z - 1.2, 0.35, 0.35, 0.5, T(1, 4), T(1, 4), 2.0); }   // 提灯
    for (let i = 0; i < 6; i++) box(V, -14 + i * 6, -34, 4, 3, 3 + r() * 2, T(3, 3), T(2, 4)); } },
};

// ── 人を立体に膨らませる（ふちは薄く・真ん中は厚く）。alpha＝tw×th、w/h＝世界での大きさ
function inflate(alpha, tw, th, wid, hgt, depth) {
  const D = new Float32Array(tw * th).fill(1e9), Q = [];   // ふちからの距離
  for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) { const i = y * tw + x; if (!alpha[i]) { D[i] = 0; Q.push(i); } else if (x === 0 || y === 0 || x === tw - 1 || y === th - 1) { D[i] = 1; Q.push(i); } }
  for (let q = 0; q < Q.length; q++) { const i = Q[q], x = i % tw; for (const k of [i - 1, i + 1, i - tw, i + tw]) { if (k < 0 || k >= tw * th || (k === i - 1 && x === 0) || (k === i + 1 && x === tw - 1)) continue; if (D[k] > D[i] + 1) { D[k] = D[i] + 1; Q.push(k); } } }
  let mx = 1; for (let i = 0; i < D.length; i++) if (D[i] < 1e8 && D[i] > mx) mx = D[i];
  const NX = 18, NY = 34, V = [], P = [];
  for (let j = 0; j <= NY; j++) for (let i = 0; i <= NX; i++) {
    const u = i / NX, v = j / NY, px = Math.min(tw - 1, Math.floor(u * tw)), py = Math.min(th - 1, Math.floor(v * th)), d = D[py * tw + px];
    P.push([(u - 0.5) * wid, (1 - v) * hgt, Math.sqrt(Math.min(1, d / mx)) * depth, u, v]);
  }
  const at = (i, j) => P[j * (NX + 1) + i];
  for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
    const a = at(i, j + 1), b = at(i + 1, j + 1), c = at(i + 1, j), d = at(i, j);
    for (const [p, q, s] of [[a, b, c], [a, c, d]]) {
      tri(V, p, q, s, [p[3], p[4]], [q[3], q[4]], [s[3], s[4]], faceShade(p, q, s) * 1.08);                                                     // 表
      const m = x => [x[0], x[1], -x[2]]; tri(V, m(p), m(s), m(q), [p[3], p[4]], [s[3], s[4]], [q[3], q[4]], faceShade(m(p), m(s), m(q)) * 0.75);   // 裏
    }
  }
  return V;
}

export class Game3D {
  constructor(look) {
    const gl = look.gl; this.look = look; this.gl = gl;
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('shader: ' + gl.getShaderInfoLog(s)); return s; };
    const prog = (vs, fs, attrs) => { const p = gl.createProgram(); gl.attachShader(p, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
      attrs.forEach((a, i) => gl.bindAttribLocation(p, i + 3, a)); gl.linkProgram(p); if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('link: ' + gl.getProgramInfoLog(p)); return p; };
    this.p = prog(VS, FS, ['pos', 'uv', 'shade']);
    this.sky = prog(`#version 300 es\nin vec2 pos; void main() { gl_Position = vec4(pos, 0.999, 1.0); }`, SKY_FS, ['pos']);
    this.u = n => gl.getUniformLocation(this.p, n); this.su = n => gl.getUniformLocation(this.sky, n);
    this.fbo = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, look.t.gms, 0);
    const db = gl.createRenderbuffer(); gl.bindRenderbuffer(gl.RENDERBUFFER, db); gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, RW, RH);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, db);
    const tex = src => { const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
      for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.NEAREST], [gl.TEXTURE_MAG_FILTER, gl.NEAREST], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
      if (src) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src); return t; };
    this.atlas = tex(atlas()); this.ptex = tex(null);
    const vb = () => { const vao = gl.createVertexArray(); gl.bindVertexArray(vao); const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 3, gl.FLOAT, false, 24, 0); gl.enableVertexAttribArray(4); gl.vertexAttribPointer(4, 2, gl.FLOAT, false, 24, 12);
      gl.enableVertexAttribArray(5); gl.vertexAttribPointer(5, 1, gl.FLOAT, false, 24, 20); return { vao, b, n: 0 }; };
    this.world = vb(); this.person = vb(); this.props = vb(); this.scene = null;
    this.skyv = gl.createVertexArray(); gl.bindVertexArray(this.skyv); gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW); gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(look.vao);
    this.cut = document.createElement('canvas'); this.cx = this.cut.getContext('2d', { willReadFrequently: true }); this.box = null;
  }

  _setScene(id) {
    if (this.scene === id) return; const gl = this.gl, s = SCENE[id] || SCENE.park, V = []; s.build(V, rng(31));
    gl.bindBuffer(gl.ARRAY_BUFFER, this.world.b); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(V), gl.STATIC_DRAW); this.world.n = V.length / 6; this.scene = id;
  }

  /** pre＝480×852 の切り出し済み canvas、seg＝MediaPipe（null なら看板）、t＝秒（動画はカメラがゆっくり回り込む）、scene＝背景 */
  render(pre, seg, t, scene = 'park') {
    const gl = this.gl, s = SCENE[scene] || SCENE.park; this._setScene(scene in SCENE ? scene : 'park');
    const P = this._person(pre, seg), ang = P.sign ? 0.3 + t * 0.1 : 0.32 + 0.45 * Math.sin(t * 0.5);   // 人は横から厚みが見える程度まで回り込む
    const cam = [Math.sin(ang) * 4.4, 1.5, Math.cos(ang) * 4.4];
    const pv = [], wv = [];
    if (P.sign) { const hgt = 2.2, wid = hgt * P.aspect, y0 = 0.6; quad(pv, [-wid / 2, y0, 0], [wid / 2, y0, 0], [wid / 2, y0 + hgt, 0], [-wid / 2, y0 + hgt, 0], [0, 0, 1, 1], 1);
      prism(wv, -wid * 0.35, -0.05, 0.06, 0, y0, 4, T(3, 1), 0); prism(wv, wid * 0.35, -0.05, 0.06, 0, y0, 4, T(3, 1), 0); }
    else { const hgt = 1.85, wid = hgt * P.aspect; pv.push(...inflate(P.alpha, P.tw, P.th, wid, hgt, Math.min(0.45, wid * 0.32))); }
    gl.bindBuffer(gl.ARRAY_BUFFER, this.person.b); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(pv), gl.DYNAMIC_DRAW); this.person.n = pv.length / 6;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.props.b); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(wv.length ? wv : [0, 0, 0, 0, 0, 0]), gl.DYNAMIC_DRAW); this.props.n = wv.length / 6;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo); gl.viewport(0, 0, RW, RH); gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(this.sky); gl.uniform1f(this.su('h'), RH); gl.uniform3f(this.su('lo'), ...s.sky[0]); gl.uniform3f(this.su('hi'), ...s.sky[1]); gl.bindVertexArray(this.skyv); gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.enable(gl.DEPTH_TEST); gl.useProgram(this.p);
    const mvp = mul([1, 0, 0, 0, 0, -1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], mul(mat4persp(1.0, RW / RH, 0.1, 70), mat4look(cam, [0, 1.0, 0], [0, 1, 0])));   // 描く先は上が0行目なので上下を返す
    gl.uniformMatrix4fv(this.u('mvp'), false, new Float32Array(mvp)); gl.uniform2f(this.u('snap'), RW / 2, RH / 2); gl.uniform2f(this.u('fog'), 7, 34); gl.uniform3f(this.u('fogc'), ...s.fog);
    gl.activeTexture(gl.TEXTURE0); gl.uniform1i(this.u('tex'), 0);
    gl.bindTexture(gl.TEXTURE_2D, this.atlas); gl.bindVertexArray(this.world.vao); gl.drawArrays(gl.TRIANGLES, 0, this.world.n);
    if (this.props.n) { gl.bindVertexArray(this.props.vao); gl.drawArrays(gl.TRIANGLES, 0, this.props.n); }
    gl.bindTexture(gl.TEXTURE_2D, this.ptex); gl.bindVertexArray(this.person.vao); gl.drawArrays(gl.TRIANGLES, 0, this.person.n);
    gl.disable(gl.DEPTH_TEST); gl.bindVertexArray(this.look.vao);
  }

  _person(pre, seg) {   // 人を切り抜いて、粗いテクスチャと形（alpha）にする。いなければ写真そのものを看板に
    const gl = this.gl, w = 240, h = 426, x = this.cx; let mask = null;
    if (seg) seg.segment(pre, r => { if (r.confidenceMasks && r.confidenceMasks[0]) { const m = r.confidenceMasks[0]; mask = { d: m.getAsFloat32Array().slice(), w: m.width, h: m.height }; } });
    this.cut.width = w; this.cut.height = h; x.imageSmoothingQuality = 'high'; x.drawImage(pre, 0, 0, w, h);
    const id = x.getImageData(0, 0, w, h), d = id.data; let x0 = w, y0 = h, x1 = -1, y1 = -1, cnt = 0;
    if (mask) {
      const on = new Uint8Array(w * h);
      for (let y = 0; y < h; y++) for (let xx = 0; xx < w; xx++) on[y * w + xx] = mask.d[Math.min(mask.h - 1, Math.floor(y / h * mask.h)) * mask.w + Math.min(mask.w - 1, Math.floor(xx / w * mask.w))] > 0.5 ? 1 : 0;
      // いちばん大きいかたまりだけ残す（まわりに飛ぶかけらを消す）
      const lab = new Int32Array(w * h), st = new Int32Array(w * h); let best = 0, bestN = 0, L = 0;
      for (let i = 0; i < w * h; i++) { if (!on[i] || lab[i]) continue; L++; let sp = 0, n = 0; st[sp++] = i; lab[i] = L;
        while (sp) { const j = st[--sp]; n++; const jx = j % w; for (const k of [j - 1, j + 1, j - w, j + w]) { if (k < 0 || k >= w * h || (k === j - 1 && jx === 0) || (k === j + 1 && jx === w - 1)) continue; if (on[k] && !lab[k]) { lab[k] = L; st[sp++] = k; } } }
        if (n > bestN) { bestN = n; best = L; } }
      for (let y = 0; y < h; y++) for (let xx = 0; xx < w; xx++) { const i = y * w + xx, a = best && lab[i] === best ? 255 : 0;
        d[i * 4 + 3] = a; if (a) { cnt++; if (xx < x0) x0 = xx; if (xx > x1) x1 = xx; if (y < y0) y0 = y; if (y > y1) y1 = y; } }
    }
    const sign = !mask || cnt < w * h * 0.02; let bx;
    if (sign) { bx = [0, 0, w, h]; for (let i = 0; i < w; i++) for (const yy of [0, 1, h - 2, h - 1]) x.fillRect(i, yy, 1, 1); }
    else {
      const nb = [Math.max(0, x0 - 2), Math.max(0, y0 - 2), Math.min(w, x1 + 3), Math.min(h, y1 + 3)];
      this.box = this.box ? this.box.map((v, i) => v * 0.6 + nb[i] * 0.4) : nb; bx = this.box.map(Math.round);   // 動画でガタつかないよう少しならす
      x.putImageData(id, 0, 0);
    }
    // PS1 らしく粗いテクスチャに（高さ 128px まで）
    const cw = Math.max(1, bx[2] - bx[0]), ch = Math.max(1, bx[3] - bx[1]), s = Math.min(1, 128 / ch), tw = Math.max(2, Math.round(cw * s)), th = Math.max(2, Math.round(ch * s));
    const small = document.createElement('canvas'); small.width = tw; small.height = th; const sx = small.getContext('2d', { willReadFrequently: true }); sx.imageSmoothingQuality = 'high';
    sx.drawImage(this.cut, bx[0], bx[1], cw, ch, 0, 0, tw, th);
    const sd = sx.getImageData(0, 0, tw, th).data, alpha = new Uint8Array(tw * th); for (let i = 0; i < tw * th; i++) alpha[i] = sd[i * 4 + 3] > 127 ? 1 : 0;
    gl.bindTexture(gl.TEXTURE_2D, this.ptex); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, small);
    return { sign, aspect: cw / ch, alpha, tw, th };
  }
}
