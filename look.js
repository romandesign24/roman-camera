import { Game3D } from './game3d.js';
// 浪漫カメラ：見た目を作る（GPU＝WebGL2）。モードは3つ（代表の参考に合わせた）。数字の正は 見本/ の PIL 版。
// ・vhs  … VHS風（look_reference.py v8）：中央の4:3の窓（四隅を丸く・上下は黒）。4:3 を縦に引き伸ばした 1080×1920 で 若干の魚眼 → 画質を落とす → にじみ・ノイズ → 最後に窓へ縮める。窓の左上ロゴ＋右上日時（グリッチ）
// ・dot  … ドット絵（look_pixel_reference.py）：180×320ドット・写真ごとの24色・格子のディザ・ポストカード風ラベル
// ・game … PS1 のゲーム風（参考：jongmin.design・maddenmedia）：人を切り抜いて PS1 風の 3D の秋の公園に立たせる（game3d.js）

export const W = 1080, H = 1920, FW = 1080, FR = 64, BAND_H = 260;   // v12：角丸を大きく（v9＝44）
// v8：VHS は中央の窓。横の写真・動画＝横長 4:3（1080×810・y555〜）、縦＝縦長 3:4（1080×1440・y240〜）。sd＝窓の中で落とす大きさ。ロゴと日時は窓の上の帯（高さ260）
export const OUT720 = [720, 1280];   // v14：仕上げに 720p まで落として戻す（ロゴと日時も含めて）
export const WIN = { land: { fh: 810, fy: 555, sd: [240, 180] }, port: { fh: 1440, fy: 240, sd: [240, 320] } };   // v11：映像を少しだけ上げた（v9＝200×150・200×267）
export const P = {
  hsoft: 0.40, sharp: [5, 2.0], chromaDiv: 16, cbDx: 14, crDx: 18, sat: 0.86,   // v8：彩度 0.86（v7＝0.92）。落とす大きさは WIN の sd（v7＝9:16 全面で 200×356）
  lift: [[16, 0.92], [11, 0.92], [6, 0.86]], glow: [24, 140, 1.8], glowTint: [150, 120, 110],     // v8：暖かく褪せた色（赤を浮かせ青を抑える。v7＝8/9/14・150・1.6）
  knee: [165, 226],                                                                             // ハイライトを寝かせる（v7＝170・228）
  noise: 18, grain: 8,   // v11：粒子を少し足した（v9＝5）
  head: [0, 0, 0],   // v12：下部のザラザラ（ヘッド切替ノイズ）を無くした（v9＝90・40・36）
     // v8：粒子とノイズを弱め、窓の大きさで付ける（v7＝30・10）。head は引き伸ばした 1920 の中の値
  lens: [0.38, 0.008, 0.32],                  // v11：魚眼を強めた（v9＝0.22・0.006・0.30）。v6：若干の魚眼（樽型）・周辺の色ずれ・周辺減光（インスタの参考＝VX1000系）
};
// ドット絵（look_pixel_reference.py と同じ）
export const DOT = { size: [180, 320], colors: 24, sat: 1.15, spread: 0.05, dusk: 0.22 };
const DK = W / DOT.size[0];   // 6：1ドット＝6px
// 文字（ロゴ・日時）のグリッチ。v6 で弱めた（look_reference.py の G と同じ）
// v8：ロゴと日時のグリッチは無し（帯のずれ・走査線・色ずれを0に）。画質を落とす（osdLowres）だけ残す
export const G = { logoBands: [0, 0], logoShift: [0, 0], logoScan: 255, logoRgb: 0,
                   osdBands: [0, 0], osdShift: [0, 0], osdScan: 255, osdRgb: 0, osdLowres: [0.42, 1.3, 2.0], logoLowres: [0.42, 1.3], burst: 1.6 };   // v11：ロゴと日時の画質を落とした（v9＝日時だけ 0.6・0.8・1.6）
const PRE = [480, 852];   // まず 480×852 へ（2D canvas で回転・切り出し）→ 面積の平均で各モードの大きさへ
const GMS = [270, 480];                                  // ゲーム：PS1 くらいの粗さで三角形を描く（1ドット＝4px）
const GAN = [135, 240];                                  // ゲーム：輪郭を探す大きさ
const HS = Math.max(2, Math.floor(WIN.land.sd[0] * P.hsoft));  // 横だけさらに縮める幅
const CW = Math.floor(W / P.chromaDiv);                 // 色のにじみ（横1/16）
const GW = W / 4, GH = H / 4;                           // 明部のにじみは1/4で計算

// ── 乱数（シード固定で毎回同じ崩れ方）
export function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const randint = (r, a, b) => a + Math.floor(r() * (b - a + 1));
const sign = r => (r() < 0.5 ? -1 : 1);

// ── 右上の日時：OCT 30 '26 ／ PM  1:24
const MON = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const DAYS = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'];
const MONTHS = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'];
export function osdLines(d) {
  const h = d.getHours(), h12 = h % 12 || 12;
  return [`${MON[d.getMonth()]} ${String(d.getDate()).padStart(2, ' ')} '${String(d.getFullYear() % 100).padStart(2, '0')}`,
          `${h < 12 ? 'AM' : 'PM'} ${String(h12).padStart(2, ' ')}:${String(d.getMinutes()).padStart(2, '0')}`];
}

// ── GPU の処理（シェーダー）
const VS = `#version 300 es
in vec2 p; void main() { gl_Position = vec4(p, 0.0, 1.0); }`;
const HEAD = `#version 300 es
precision highp float; precision highp int; precision highp sampler2D;
out vec4 o;
`;
const FS = {
  // 拡大・縮小（線形）。size＝出力の大きさ
  copy: HEAD + `uniform sampler2D t; uniform vec2 size;
void main() { o = texture(t, gl_FragCoord.xy / size); }`,
  // HDR（HLG/PQ）を普通の明るさ・色に直す。ブラウザが HDR の信号値をそのまま描いたとき用（iPhone の Safari/Chrome）。
  // HLG → 光（OOTF γ1.2）→ 白を合わせる → BT.2020→709 → 明部をなだらかに → sRGB。Apple の HDR→SDR 変換に合わせた（平均の差 約7/255）
  hdr: HEAD + `uniform sampler2D t; uniform int mode; uniform float white;
float hlgInv(float v) { return v <= 0.5 ? v * v / 3.0 : (exp((v - 0.55991073) / 0.17883277) + 0.28466892) / 12.0; }
float pqEotf(float v) { float p = pow(max(v, 0.0), 1.0 / 78.84375); return pow(max(p - 0.8359375, 0.0) / (18.8515625 - 18.6875 * p), 1.0 / 0.1593017578125); }
float enc(float x) { return x <= 0.0031308 ? 12.92 * x : 1.055 * pow(x, 1.0 / 2.4) - 0.055; }
void main() { vec3 e = texelFetch(t, ivec2(gl_FragCoord.xy), 0).rgb; vec3 L;
  if (mode == 1) { vec3 E = vec3(hlgInv(e.r), hlgInv(e.g), hlgInv(e.b)); L = E * pow(max(dot(E, vec3(0.2627, 0.6780, 0.0593)), 1e-6), 0.2) / white; }
  else L = vec3(pqEotf(e.r), pqEotf(e.g), pqEotf(e.b)) * 10000.0 / white;
  L = max(mat3(1.6605, -0.1246, -0.0182, -0.5876, 1.1329, -0.1006, -0.0728, -0.0083, 1.1187) * L, 0.0);
  float Y = dot(L, vec3(0.2126, 0.7152, 0.0722)); if (Y > 0.8) L *= (0.8 + 0.2 * (1.0 - exp(-(Y - 0.8) / 0.2))) / Y;
  L = min(L, 1.0); o = vec4(enc(L.r), enc(L.g), enc(L.b), 1.0); }`,
  // 若干の魚眼：樽型にゆがめて四隅まで埋める＋周辺の色ずれ（赤と青）＋周辺減光（look_reference.py の lens と同じ式）
  lens: HEAD + `uniform sampler2D t; uniform vec2 size; uniform float k; uniform float ca; uniform float vig;
void main() { vec2 c = size * 0.5, d = gl_FragCoord.xy - c; float r2 = dot(d, d) / dot(c, c), s = (1.0 + k * r2) / (1.0 + k);
  vec3 col = vec3(texture(t, (c + d * s * (1.0 + ca)) / size).r, texture(t, (c + d * s) / size).g, texture(t, (c + d * s * (1.0 - ca)) / size).b);
  o = vec4(col * (1.0 - vig * r2 * r2), 1.0); }`,
  // 面積で平均して縮める（4×4 点）
  boxdown: HEAD + `uniform sampler2D t; uniform vec2 src; uniform vec2 dst;
void main() { vec2 sc = src / dst, base = floor(gl_FragCoord.xy) * sc; vec4 acc = vec4(0.0);
  for (int j = 0; j < 4; j++) for (int i = 0; i < 4; i++) acc += texture(t, (base + (vec2(float(i), float(j)) + 0.5) * sc / 4.0) / src);
  o = acc / 16.0; }`,
  // ドット絵①：明るさを整える（1%で切る）→ 彩度 → 夕暮れの色味（暗部を紫・明部をクリーム）→ 3×3 の中央値でざらつきをならす
  dotg: HEAD + `uniform sampler2D t; uniform vec3 lo; uniform vec3 hi; uniform float sat; uniform float dusk;
const vec3 SH = vec3(52.0, 34.0, 92.0) / 255.0, LI = vec3(255.0, 238.0, 214.0) / 255.0, Y = vec3(0.299, 0.587, 0.114);
vec3 grade(vec3 c) { c = clamp((c - lo) / max(hi - lo, vec3(1.0 / 255.0)), 0.0, 1.0); float l = dot(c, Y); c = clamp(l + sat * (c - l), 0.0, 1.0);
  l = dot(c, Y); return c + (SH - c) * (dusk * (1.0 - l) * (1.0 - l)) + (LI - c) * (dusk * 0.6 * l * l); }
void main() { ivec2 q = ivec2(gl_FragCoord.xy), m = textureSize(t, 0) - 1; vec3 v[9]; int k = 0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) { v[k] = grade(texelFetch(t, clamp(q + ivec2(i, j), ivec2(0), m), 0).rgb); k++; }
  vec3 a;
#define S(i, j) a = min(v[i], v[j]); v[j] = max(v[i], v[j]); v[i] = a;
  S(1, 2) S(4, 5) S(7, 8) S(0, 1) S(3, 4) S(6, 7) S(1, 2) S(4, 5) S(7, 8) S(0, 3) S(5, 8) S(4, 7) S(3, 6) S(1, 4) S(2, 5) S(4, 7) S(4, 2) S(6, 4) S(4, 2)
  o = vec4(v[4], 1.0); }`,
  // ドット絵②：4×4 の格子ディザ → いちばん近い色（OKLab）→ ポストカード風ラベルを重ねる
  dotq: HEAD + `uniform sampler2D t; uniform sampler2D card; uniform vec3 pal[24]; uniform vec3 lab[24]; uniform int np; uniform float spread;
const float B4[16] = float[16](0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);
float lin(float c) { return c <= 0.04045 ? c / 12.92 : pow((c + 0.055) / 1.055, 2.4); }
vec3 oklab(vec3 c) { c = vec3(lin(c.r), lin(c.g), lin(c.b));
  float l = pow(0.4122214708 * c.r + 0.5363325363 * c.g + 0.0514459929 * c.b, 1.0 / 3.0), m = pow(0.2119034982 * c.r + 0.6806995451 * c.g + 0.1073969566 * c.b, 1.0 / 3.0),
        s = pow(0.0883024619 * c.r + 0.2817188376 * c.g + 0.6299787005 * c.b, 1.0 / 3.0);
  return vec3(0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s, 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s); }
void main() { ivec2 q = ivec2(gl_FragCoord.xy); float d = (B4[(q.y & 3) * 4 + (q.x & 3)] + 0.5) / 16.0 - 0.5;
  vec3 L = oklab(clamp(texelFetch(t, q, 0).rgb + d * spread, 0.0, 1.0)), res = pal[0]; float best = 1e9;
  for (int i = 0; i < 24; i++) { if (i >= np) break; vec3 e = lab[i] - L; float dd = dot(e, e); if (dd < best) { best = dd; res = pal[i]; } }
  vec4 c = texelFetch(card, q, 0); o = vec4(mix(res, c.rgb, c.a), 1.0); }`,
  // ドット絵③：角を立てたまま 1080×1920 へ
  nearest: HEAD + `uniform sampler2D t; uniform int k;
void main() { int x = int(gl_FragCoord.x), y = ${H - 1} - int(gl_FragCoord.y); o = vec4(texelFetch(t, ivec2(x / k, y / k), 0).rgb, 1.0); }`,
  // ゲーム①（PS1/PS2 風）：色を濃く・暖かく・少し硬く → 1色5bit（32段）に落として4×4の格子ディザ（PS1 と同じやり方）
  gameq: HEAD + `uniform sampler2D t;
const float B4[16] = float[16](0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);
void main() { ivec2 q = ivec2(gl_FragCoord.xy); vec3 c = texelFetch(t, q, 0).rgb; float l = dot(c, vec3(0.299, 0.587, 0.114));
  c = clamp(l + 1.3 * (c - l), 0.0, 1.0); c = clamp((c - 0.5) * 1.12 + 0.5, 0.0, 1.0) * vec3(1.04, 1.0, 0.95);
  float d = (B4[(q.y & 3) * 4 + (q.x & 3)] + 0.5) / 16.0 - 0.5; c = floor(clamp(c, 0.0, 1.0) * 31.0 + 0.5 + d) / 31.0;
  o = vec4(clamp(c, 0.0, 1.0), 1.0); }`,
  // ゲーム②：三角形を描いた 270×480 を角を立てたまま拡大 → 色を濃く・5bit＋4×4の格子ディザ（PS1）→ 周辺減光・ブラウン管の丸い四隅 → 操作表示
  game: HEAD + `uniform sampler2D t; uniform sampler2D ov;
const float B4[16] = float[16](0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);
void main() { int x = int(gl_FragCoord.x), y = ${H - 1} - int(gl_FragCoord.y); ivec2 q = ivec2(x / 4, y / 4); vec3 c = texelFetch(t, q, 0).rgb;
  float l = dot(c, vec3(0.299, 0.587, 0.114)); c = clamp(l + 1.25 * (c - l), 0.0, 1.0); c = clamp((c - 0.5) * 1.1 + 0.5, 0.0, 1.0) * vec3(1.03, 1.0, 0.96);
  float d = (B4[(q.y & 3) * 4 + (q.x & 3)] + 0.5) / 16.0 - 0.5; c = floor(clamp(c, 0.0, 1.0) * 31.0 + 0.5 + d) / 31.0;
  vec2 p = vec2(float(x), float(y)) + 0.5, r = p / vec2(${W}.0, ${H}.0) * 2.0 - 1.0; c *= 1.0 - 0.3 * pow(dot(r * vec2(0.9, 0.7), r * vec2(0.9, 0.7)), 2.0);
  vec2 e = max(abs(p - vec2(${W / 2}.0, ${H / 2}.0)) - vec2(${W / 2 - 70}.0, ${H / 2 - 70}.0), 0.0); c *= 1.0 - smoothstep(66.0, 72.0, length(e));
  vec4 k = texelFetch(ov, ivec2(x, y), 0); o = vec4(mix(clamp(c, 0.0, 1.0), k.rgb, k.a), 1.0); }`,
  // 横だけ縮める（PIL の BILINEAR 縮小＝三角フィルタ）
  tri: HEAD + `uniform sampler2D t; uniform float sc; uniform int sw;
void main() { ivec2 q = ivec2(gl_FragCoord.xy); float cx = (float(q.x) + 0.5) * sc;
  int x0 = int(floor(cx - sc)), x1 = int(ceil(cx + sc)); vec4 acc = vec4(0.0); float ws = 0.0;
  for (int x = x0; x <= x1; x++) { if (x < 0 || x >= sw) continue; float w = max(0.0, 1.0 - abs(float(x) + 0.5 - cx) / sc);
    acc += w * texelFetch(t, ivec2(x, q.y), 0); ws += w; }
  o = acc / max(ws, 1e-6); }`,
  // SD → 1080×1920（PIL の BICUBIC＝a -0.5）
  bicubic: HEAD + `uniform sampler2D t; uniform vec2 src; uniform vec2 dst;
float k(float x) { x = abs(x); if (x < 1.0) return (1.5 * x - 2.5) * x * x + 1.0; if (x < 2.0) return ((-0.5 * x + 2.5) * x - 4.0) * x + 2.0; return 0.0; }
void main() { vec2 c = gl_FragCoord.xy * src / dst - 0.5; vec2 i0 = floor(c); vec2 f = c - i0; vec4 acc = vec4(0.0); float ws = 0.0;
  for (int j = -1; j <= 2; j++) { float wy = k(float(j) - f.y);
    for (int i = -1; i <= 2; i++) { float w = wy * k(float(i) - f.x);
      ivec2 p = clamp(ivec2(i0) + ivec2(i, j), ivec2(0), ivec2(src) - 1); acc += w * texelFetch(t, p, 0); ws += w; } }
  o = clamp(acc / ws, 0.0, 1.0); }`,
  // ガウスぼかし（片方向）。amount>0 のときはアンシャープ（orig + amount×(orig − ぼかし)）
  blur: HEAD + `uniform sampler2D t; uniform sampler2D orig; uniform vec2 size; uniform vec2 dir; uniform float w0;
uniform float wts[16]; uniform float offs[16]; uniform int n; uniform float amount;
void main() { vec2 uv = gl_FragCoord.xy / size; vec4 acc = texture(t, uv) * w0;
  for (int i = 0; i < 16; i++) { if (i >= n) break; vec2 d = dir * offs[i] / size; acc += (texture(t, uv + d) + texture(t, uv - d)) * wts[i]; }
  if (amount > 0.0) { vec4 u = texelFetch(orig, ivec2(gl_FragCoord.xy), 0); acc = clamp(u + amount * (u - acc), 0.0, 1.0); }
  o = acc; }`,
  // 色（Cb/Cr）だけを横1/14に縮める
  chroma: HEAD + `uniform sampler2D s; uniform float sc;
vec2 cbcr(vec3 c) { c *= 255.0; return vec2(128.0 - 0.168736 * c.r - 0.331264 * c.g + 0.5 * c.b, 128.0 + 0.5 * c.r - 0.418688 * c.g - 0.081312 * c.b) / 255.0; }
void main() { ivec2 q = ivec2(gl_FragCoord.xy); float cx = (float(q.x) + 0.5) * sc; int x0 = int(floor(cx - sc)), x1 = int(ceil(cx + sc));
  vec2 acc = vec2(0.0); float ws = 0.0;
  for (int x = x0; x <= x1; x++) { if (x < 0 || x >= ${W}) continue; float w = max(0.0, 1.0 - abs(float(x) + 0.5 - cx) / sc);
    acc += w * cbcr(texelFetch(s, ivec2(x, q.y), 0).rgb); ws += w; }
  o = vec4(acc / max(ws, 1e-6), 0.0, 1.0); }`,
  // 明るさはそのまま、色はにじませて右へずらす → 彩度 → 黒を浮かせて暗部を青く
  grade: HEAD + `uniform sampler2D s; uniform sampler2D ch; uniform float cbDx; uniform float crDx; uniform float sat; uniform vec3 la; uniform vec3 lb;
void main() { ivec2 q = ivec2(gl_FragCoord.xy); vec3 c = texelFetch(s, q, 0).rgb * 255.0;
  float Y = dot(c, vec3(0.299, 0.587, 0.114)); float x = float(q.x); float yv = (float(q.y) + 0.5) / ${H}.0;
  float xb = x >= cbDx ? x - cbDx : x; float xr = x >= crDx ? x - crDx : x;
  float Cb = texture(ch, vec2((xb + 0.5) / ${W}.0, yv)).r * 255.0 - 128.0;
  float Cr = texture(ch, vec2((xr + 0.5) / ${W}.0, yv)).g * 255.0 - 128.0;
  vec3 rgb = clamp(floor(vec3(Y + 1.402 * Cr, Y - 0.344136 * Cb - 0.714136 * Cr, Y + 1.772 * Cb) + 0.5), 0.0, 255.0);
  float L = dot(rgb, vec3(0.299, 0.587, 0.114)); rgb = clamp(floor(L + sat * (rgb - L) + 0.5), 0.0, 255.0);
  rgb = min(vec3(255.0), floor(la + rgb * lb)); o = vec4(rgb / 255.0, 1.0); }`,
  // 1/4 に縮める（4×4平均）
  box4: HEAD + `uniform sampler2D g;
void main() { vec2 p = floor(gl_FragCoord.xy) * 4.0; vec2 z = vec2(${W}.0, ${H}.0);
  o = 0.25 * (texture(g, (p + vec2(1.0, 1.0)) / z) + texture(g, (p + vec2(3.0, 1.0)) / z) + texture(g, (p + vec2(1.0, 3.0)) / z) + texture(g, (p + vec2(3.0, 3.0)) / z)); }`,
  // 仕上げ：明部のにじみ・揺れ（動画）・ヘッド切替ノイズ・横に流れた静止ノイズ・粒子・ロゴと日時
  final: HEAD + `uniform sampler2D g; uniform sampler2D gw; uniform sampler2D ov; uniform ivec2 jit; uniform int hdx; uniform uint seed;
uniform float thr; uniform float gain; uniform vec3 tint; uniform float nS; uniform float gS; uniform int hh; uniform int hn; uniform int useOv; uniform vec2 knee; uniform int fy; uniform int fh;
uvec3 pcg(uvec3 v) { v = v * 1664525u + 1013904223u; v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y; v ^= v >> 16u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y; return v; }
float gauss(int x, int y, uint k) { uvec3 h = pcg(uvec3(uint(x), uint(y), seed * 4u + k));
  float a = max(float(h.x >> 8u) / 16777216.0, 1e-7); float b = float(h.y >> 8u) / 16777216.0; return sqrt(-2.0 * log(a)) * cos(6.2831853 * b); }
float nz(int x, int y, uint k, float s) { return clamp(floor(128.0 + s * gauss(x, y, k) + 0.5), 0.0, 255.0); }
vec3 base(int x, int y) { x -= jit.x; y -= jit.y; if (x < 0 || y < 0 || x >= ${W} || y >= ${H}) return vec3(0.0);
  vec3 c = texelFetch(g, ivec2(x, y), 0).rgb * 255.0; vec3 b = texture(gw, (vec2(float(x), float(y)) + 0.5) / vec2(${W}.0, ${H}.0)).rgb * 255.0;
  vec3 glw = min(vec3(255.0), floor(max(vec3(0.0), b - thr) * gain)); vec3 v = min(vec3(255.0), c + floor(glw * tint / 255.0));
  vec3 t = floor(knee.x + (knee.y - knee.x) * (1.0 - exp(-(v - knee.x) / (knee.y - knee.x)))); return mix(v, t, step(vec3(knee.x + 0.5), v)); }   // ハイライトを寝かせる
void main() { int x = int(gl_FragCoord.x), Y = ${H - 1} - int(gl_FragCoord.y); vec3 v;
  if (Y < fy || Y >= fy + fh) { o = vec4(0.0, 0.0, 0.0, 1.0); return; }        // v8：窓の外は黒
  int y = (Y - fy) * ${H} / fh;                                                      // 窓の1行 → 引き伸ばした 1920 の1行
  if (y >= ${H} - hh) { int xs = x - hdx; if (xs < 0) xs += ${W}; if (xs >= ${W}) xs -= ${W}; v = base(xs, y); } else v = base(x, y);
  if (y >= ${H} - hn) v = floor(v * 0.4 + nz(x, y, 1u, 80.0) * 0.6 + 0.5);
  int wy = Y - fy;                                                                     // v8：ノイズと粒子は窓の大きさで付ける（縦に詰まらない）
  float u = (float(x) + 0.5) / 3.0 - 0.5; int i0 = int(floor(u)); float f = u - float(i0);
  float n = floor(mix(nz(clamp(i0, 0, ${W / 3 - 1}), wy, 2u, nS), nz(clamp(i0 + 1, 0, ${W / 3 - 1}), wy, 2u, nS), f) + 0.5);
  v = floor(v * (255.0 - max(0.0, n - 145.0) * 2.0) / 255.0);
  vec2 gp = (vec2(float(x), float(wy)) + 0.5) / 2.0 - 0.5; ivec2 gi = ivec2(floor(gp)); vec2 gf = gp - vec2(gi);
  ivec2 g0 = clamp(gi, ivec2(0), ivec2(${W / 2 - 1}, fh / 2 - 1)), g1 = clamp(gi + 1, ivec2(0), ivec2(${W / 2 - 1}, fh / 2 - 1));
  float gr = mix(mix(nz(g0.x, g0.y, 3u, gS), nz(g1.x, g0.y, 3u, gS), gf.x), mix(nz(g0.x, g1.y, 3u, gS), nz(g1.x, g1.y, 3u, gS), gf.x), gf.y);
  v = min(vec3(255.0), v + max(0.0, floor(gr + 0.5) - 128.0));
  float hf = float(fh) * 0.5; vec2 p = vec2(float(x), float(Y - fy)) + 0.5, e = max(abs(p - vec2(${FW / 2}.0, hf)) - vec2(${FW / 2 - FR}.0, hf - ${FR}.0), 0.0);
  float dd = ${FR}.0 - length(e), rim = dd < 1.0 ? 1.0 : clamp(1.0 - (dd - 1.0) / 6.0, 0.0, 1.0);   // v15：ぼかし 3px→6px   // dd＝ふちからの距離（内側が＋）
  vec3 rc = mix(v, vec3(232.0, 224.0, 210.0), 0.25);   // ふちの線の色＝その場の映像に暖かい明るい色を 25% 混ぜる（v12b＝55%）（映像に馴染む。v12 初版は #f7f7f7）
  v = floor(mix(v, rc, rim) * clamp(dd, 0.0, 1.0) + 0.5);   // v12：外側から 1px の線 → 6px（v15）で映像へぼかす・四隅は丸く
  if (useOv == 1 && Y >= fy && Y < fy + ${BAND_H}) { vec4 c = texelFetch(ov, ivec2(x, Y - fy), 0); v = v * (1.0 - c.a) + c.rgb * 255.0 * c.a; }
  o = vec4(v / 255.0, 1.0); }`,
};

function taps(sigma) {   // ガウスの重み（隣り合う2点を線形補間でまとめて半分の回数に）
  const R = Math.ceil(sigma * 3), w = []; let s = 0;
  for (let i = 0; i <= R; i++) { w[i] = Math.exp(-i * i / (2 * sigma * sigma)); s += i ? 2 * w[i] : w[i]; }
  const offs = new Float32Array(16), wts = new Float32Array(16); let n = 0;
  for (let i = 1; i <= R; i += 2) { const a = w[i] / s, b = (i + 1 <= R ? w[i + 1] : 0) / s; offs[n] = i + b / (a + b); wts[n] = a + b; n++; }
  return { w0: w[0] / s, offs, wts, n };
}

export class Look {
  constructor() {
    const c = document.createElement('canvas'); c.width = W; c.height = H; this.canvas = c;
    const gl = c.getContext('webgl2', { alpha: false, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: true, premultipliedAlpha: false });
    if (!gl) throw new Error('この端末では WebGL2 が使えません');
    this.gl = gl;
    this.pre = document.createElement('canvas'); this.pre.width = PRE[0]; this.pre.height = PRE[1];
    this.px = this.pre.getContext('2d', { alpha: false });
    const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.prog = {}; for (const k in FS) this.prog[k] = this._compile(FS[k]);
    const T = (w, h) => this._tex(w, h);
    this.t = { pre: T(...PRE), preH: T(...PRE), preL: T(...PRE), sdL: T(...WIN.land.sd), hsL: T(HS, WIN.land.sd[1]), sbL: T(...WIN.land.sd), sdP: T(...WIN.port.sd), hsP: T(HS, WIN.port.sd[1]), sbP: T(...WIN.port.sd), up: T(W, H), bh: T(W, H), sh: T(W, H),
               ch: T(CW, H), gr: T(W, H), g4: T(GW, GH), gb1: T(GW, GH), gb2: T(GW, GH), ov: T(W, BAND_H), fin: T(W, H), dn: T(...OUT720),
               ds: T(...DOT.size), dg: T(...DOT.size), dq: T(...DOT.size), card: T(...DOT.size), gms: T(...GMS), gan: T(...GAN), ovF: T(W, H) };
    this.f = {}; for (const k in this.t) if (!['pre', 'ov', 'card', 'ovF'].includes(k)) this.f[k] = this._fbo(this.t[k]);
    this.keys = {};
    // ゲーム：三角形をそのまま描くためのプログラム（頂点ごとに位置と色・面は1色）
    const pv = `#version 300 es
in vec2 pos; in vec3 col; flat out vec3 vc; uniform vec2 size;
void main() { vc = col; gl_Position = vec4(pos / size * 2.0 - 1.0, 0.0, 1.0); }`;
    const pf = `#version 300 es
precision highp float; flat in vec3 vc; out vec4 o; void main() { o = vec4(vc, 1.0); }`;
    const sh = (type, src) => { const x = gl.createShader(type); gl.shaderSource(x, src); gl.compileShader(x); if (!gl.getShaderParameter(x, gl.COMPILE_STATUS)) throw new Error('shader: ' + gl.getShaderInfoLog(x)); return x; };
    const pp = gl.createProgram(); gl.attachShader(pp, sh(gl.VERTEX_SHADER, pv)); gl.attachShader(pp, sh(gl.FRAGMENT_SHADER, pf));
    gl.bindAttribLocation(pp, 1, 'pos'); gl.bindAttribLocation(pp, 2, 'col'); gl.linkProgram(pp);
    if (!gl.getProgramParameter(pp, gl.LINK_STATUS)) throw new Error('link: ' + gl.getProgramInfoLog(pp));
    this.poly = { p: pp, size: gl.getUniformLocation(pp, 'size'), vao: gl.createVertexArray(), buf: gl.createBuffer() };
    gl.bindVertexArray(this.poly.vao); gl.bindBuffer(gl.ARRAY_BUFFER, this.poly.buf);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 20, 0);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 3, gl.FLOAT, false, 20, 8);
    gl.bindVertexArray(vao); this.vao = vao;
    this.k5 = taps(P.sharp[0]); this.k6 = taps(P.glow[0] / 4);
  }

  _compile(fs) {
    const gl = this.gl;
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('shader: ' + gl.getShaderInfoLog(s)); return s; };
    const p = gl.createProgram(); gl.attachShader(p, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
    gl.bindAttribLocation(p, 0, 'p'); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('link: ' + gl.getProgramInfoLog(p));
    const u = {}, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) { const info = gl.getActiveUniform(p, i); u[info.name.replace(/\[0\]$/, '')] = gl.getUniformLocation(p, info.name); }
    return { p, u };
  }

  _tex(w, h) {
    const gl = this.gl, t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t); gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, w, h);
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]])
      gl.texParameteri(gl.TEXTURE_2D, k, v);
    t.w = w; t.h = h; return t;
  }

  _fbo(t) {
    const gl = this.gl, f = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, f);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0); return f;
  }

  _pass(name, out, inputs, uni) {
    const gl = this.gl, pr = this.prog[name]; gl.useProgram(pr.p); gl.bindVertexArray(this.vao);
    if (out) { gl.bindFramebuffer(gl.FRAMEBUFFER, this.f[out]); gl.viewport(0, 0, this.t[out].w, this.t[out].h); }
    else { gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, W, H); }
    let unit = 0;
    for (const k in inputs) { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, this.t[inputs[k]]); if (pr.u[k]) gl.uniform1i(pr.u[k], unit); unit++; }
    for (const k in uni) { const loc = pr.u[k]; if (loc == null) continue; const [ty, ...v] = uni[k]; gl['uniform' + ty](loc, ...v); }
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  _blur(src, dst, w, h, k, dir, orig = src, amount = 0) {
    this._pass('blur', dst, { t: src, orig }, { size: ['2f', w, h], dir: ['2f', ...dir], w0: ['1f', k.w0], wts: ['1fv', k.wts], offs: ['1fv', k.offs], n: ['1i', k.n], amount: ['1f', amount] });
  }

  _upload(key, tex, w, h, data) {   // 透過の重ね絵を GPU へ（中身が変わったときだけ）
    if (!data || this.keys[tex] === key) return;
    const gl = this.gl; gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.t[tex]);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, data); this.keys[tex] = key;
  }

  _read(tex) {   // GPU の小さな画像を読む（ドット絵の色選び用）
    const gl = this.gl, t = this.t[tex], buf = new Uint8Array(t.w * t.h * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.f[tex]); gl.readPixels(0, 0, t.w, t.h, gl.RGBA, gl.UNSIGNED_BYTE, buf); return buf;
  }

  /** src（img / VideoFrame / canvas）を描く。sw,sh＝src の大きさ、rot＝表示の回転（時計回り 0/90/180/270）。
   *  o = { mode：'vhs'|'dot'|'game', seed：乱数, jitter：動画の揺れ, overlay：重ね絵（vhs＝Overlay.get、dot＝dotCard、game＝gameLayer）,
   *        hdr：'hlg'|'pq'（HDR の信号値のまま描かれたとき）, dot：ドット絵の色（1コマ目で決めて使い回す {} を渡す） } */
  render(src, sw, sh, rot, o) {
    const gl = this.gl, px = this.px;
    // 1) 縦9:16の中央を切り出して 480×852 へ（回転もここで）
    //    VHS（v8）だけは中央の 4:3 を切り出して縦に引き伸ばす（あとで窓へ縮める）
    const dw = rot % 180 ? sh : sw, dh = rot % 180 ? sw : sh, v8 = o.mode !== 'dot' && o.mode !== 'game';
    this.win = dw > dh ? 'land' : 'port';                        // 横長なら 4:3、縦長（と正方形）なら 3:4
    const bh = v8 ? PRE[0] * WIN[this.win].fh / FW : PRE[1], k = Math.max(PRE[0] / dw, bh / dh);
    px.setTransform(1, 0, 0, 1, 0, 0); px.fillStyle = '#000'; px.fillRect(0, 0, PRE[0], PRE[1]);
    px.imageSmoothingEnabled = true; px.imageSmoothingQuality = 'high';
    px.translate(PRE[0] / 2, PRE[1] / 2); px.scale(1, PRE[1] / bh); px.rotate(rot * Math.PI / 180); px.scale(k, k);
    px.drawImage(src, -sw / 2, -sh / 2, sw, sh); px.setTransform(1, 0, 0, 1, 0, 0);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.t.pre);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, this.pre);
    let s0 = 'pre';
    if (o.hdr) { this._pass('hdr', 'preH', { t: 'pre' }, { mode: ['1i', o.hdr === 'pq' ? 2 : 1], white: ['1f', o.hdr === 'pq' ? 300 : 0.4] }); s0 = 'preH'; }
    if (o.mode === 'dot') return this._dot(s0, o);
    if (o.mode === 'game') return this._game(s0, o);
    return this._vhs(s0, o);
  }

  _vhs(s0, o) {
    // 若干の魚眼 → 画質を落とす：SD → 横だけさらに縮めて戻す → 1080×1920 → 強いシャープ
    this._pass('lens', 'preL', { t: s0 }, { size: ['2f', ...PRE], k: ['1f', P.lens[0]], ca: ['1f', P.lens[1]], vig: ['1f', P.lens[2]] });
    const wn = WIN[this.win], sd = wn.sd, z = this.win === 'land' ? 'L' : 'P';
    this._pass('boxdown', 'sd' + z, { t: 'preL' }, { src: ['2f', ...PRE], dst: ['2f', ...sd] });
    this._pass('tri', 'hs' + z, { t: 'sd' + z }, { sc: ['1f', sd[0] / HS], sw: ['1i', sd[0]] });
    this._pass('copy', 'sb' + z, { t: 'hs' + z }, { size: ['2f', ...sd] });
    this._pass('bicubic', 'up', { t: 'sb' + z }, { src: ['2f', ...sd], dst: ['2f', W, H] });
    this._blur('up', 'bh', W, H, this.k5, [1, 0]);
    this._blur('bh', 'sh', W, H, this.k5, [0, 1], 'up', P.sharp[1]);
    // 色のにじみ・彩度・暗部の青み
    this._pass('chroma', 'ch', { s: 'sh' }, { sc: ['1f', W / CW] });
    this._pass('grade', 'gr', { s: 'sh', ch: 'ch' }, { cbDx: ['1f', P.cbDx], crDx: ['1f', P.crDx], sat: ['1f', P.sat],
      la: ['3f', ...P.lift.map(v => v[0])], lb: ['3f', ...P.lift.map(v => v[1])] });
    // 明部のにじみ（1/4で半径6＝元の24）
    this._pass('box4', 'g4', { g: 'gr' }, {});
    this._blur('g4', 'gb1', GW, GH, this.k6, [1, 0]);
    this._blur('gb1', 'gb2', GW, GH, this.k6, [0, 1]);
    if (o.overlay) this._upload(o.overlay.key, 'ov', W, BAND_H, o.overlay.data);
    const r = rng(o.seed), jit = o.jitter ? [randint(r, -2, 2), randint(r, -2, 2)] : [0, 0];
    this._pass('final', 'fin', { g: 'gr', gw: 'gb2', ov: 'ov' }, {
      jit: ['2i', ...jit], hdx: ['1i', P.head[1] + randint(r, -8, 8)], seed: ['1ui', o.seed >>> 0],
      thr: ['1f', P.glow[1]], gain: ['1f', P.glow[2]], tint: ['3f', ...P.glowTint], nS: ['1f', P.noise], gS: ['1f', P.grain],
      hh: ['1i', P.head[0]], hn: ['1i', P.head[2]], useOv: ['1i', o.overlay ? 1 : 0], knee: ['2f', ...P.knee], fy: ['1i', wn.fy], fh: ['1i', wn.fh] });
    this._pass('boxdown', 'dn', { t: 'fin' }, { src: ['2f', W, H], dst: ['2f', ...OUT720] });        // v14：720p へ（面積の平均）
    this._pass('bicubic', null, { t: 'dn' }, { src: ['2f', ...OUT720], dst: ['2f', W, H] });       // → 1080×1920 に戻す
  }

  _dot(s0, o) {
    const st = o.dot || (o.dot = {});
    this._pass('boxdown', 'ds', { t: s0 }, { src: ['2f', ...PRE], dst: ['2f', ...DOT.size] });
    if (!st.lo) { const L = levels(this._read('ds')); st.lo = L.lo; st.hi = L.hi; }        // 1コマ目で明るさの幅を決める
    this._pass('dotg', 'dg', { t: 'ds' }, { lo: ['3f', ...st.lo], hi: ['3f', ...st.hi], sat: ['1f', DOT.sat], dusk: ['1f', DOT.dusk] });
    if (!st.pal) {                                                                               // 1コマ目で24色を決める（動画はそのまま使い回す）
      st.pal = medianCut(this._read('dg'), DOT.colors); st.lab = st.pal.map(oklab);
      st.palF = new Float32Array(72); st.labF = new Float32Array(72); st.pal.forEach((c, i) => { st.palF.set(c, i * 3); st.labF.set(st.lab[i], i * 3); });
    }
    if (o.overlay) this._upload(o.overlay.key, 'card', ...DOT.size, o.overlay.data);
    this._pass('dotq', 'dq', { t: 'dg', card: 'card' }, { pal: ['3fv', st.palF], lab: ['3fv', st.labF], np: ['1i', st.pal.length], spread: ['1f', DOT.spread] });
    this._pass('nearest', null, { t: 'dq' }, { k: ['1i', DK] });
  }

  _game(s0, o) {
    // 人を切り抜いて PS1 風の 3D の世界に立たせる（game3d.js）→ 角を立てたまま拡大・5bit＋格子ディザ・ブラウン管の四隅 → 操作表示
    if (!this.g3d) this.g3d = new Game3D(this);
    this.g3d.render(this.pre, o.seg || null, o.t || 0, o.scene || 'park');
    if (o.overlay) this._upload(o.overlay.key, 'ovF', W, H, o.overlay.data);
    this._pass('game', null, { t: 'gms', ov: 'ovF' }, {});
  }


}

// ── ゲーム：輪郭に沿ったローポリ（CPU）。img＝w×h の RGBA、k＝描く大きさへの倍率。返り値＝[x, y, r, g, b] × 頂点 の Float32Array
function lowPoly(img, w, h, k, seed) {
  const L = new Float32Array(w * h); for (let i = 0; i < w * h; i++) L[i] = 0.299 * img[i * 4] + 0.587 * img[i * 4 + 1] + 0.114 * img[i * 4 + 2];
  const G = new Float32Array(w * h), cand = [];
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {   // Sobel（明るさ＋色の差）
    const i = y * w + x, gx = L[i - w + 1] + 2 * L[i + 1] + L[i + w + 1] - L[i - w - 1] - 2 * L[i - 1] - L[i + w - 1],
      gy = L[i + w - 1] + 2 * L[i + w] + L[i + w + 1] - L[i - w - 1] - 2 * L[i - w] - L[i - w + 1];
    let cd = 0; for (let c = 0; c < 3; c++) cd += Math.abs(img[(i + 1) * 4 + c] - img[(i - 1) * 4 + c]) + Math.abs(img[(i + w) * 4 + c] - img[(i - w) * 4 + c]);
    G[i] = Math.hypot(gx, gy) + cd * 0.5; if (G[i] > 40) cand.push(i);
  }
  cand.sort((a, b) => G[b] - G[a]);
  const pts = [], R = 2.6, cell = new Uint8Array(Math.ceil(w / R) * Math.ceil(h / R)), cw = Math.ceil(w / R);
  const take = (x, y) => { const c = Math.floor(y / R) * cw + Math.floor(x / R); if (cell[c]) return; cell[c] = 1; pts.push(x, y); };
  for (let x = 0; x <= w; x += w / 9) { pts.push(x, 0, x, h); } for (let y = h / 16; y < h; y += h / 16) { pts.push(0, y, w, y); }
  const r = rng(seed ^ 0x9e3779b9);   // 下地のまばらな点（位置は固定）
  const rb = rng(12345); for (let y = 6; y < h; y += 12) for (let x = 6; x < w; x += 12) take(x + (rb() - 0.5) * 8, y + (rb() - 0.5) * 8);
  for (let n = 0; n < cand.length && pts.length < 2600; n++) { const i = cand[n]; take(i % w + 0.5, Math.floor(i / w) + 0.5); }
  const tri = delaunay(pts), out = new Float32Array(tri.length / 3 * 15);
  const px = (x, y) => { const xi = Math.min(w - 1, Math.max(0, x | 0)), yi = Math.min(h - 1, Math.max(0, y | 0)), j = (yi * w + xi) * 4; return [img[j], img[j + 1], img[j + 2]]; };
  for (let t = 0, o = 0; t < tri.length; t += 3) {
    const a = tri[t] * 2, b = tri[t + 1] * 2, c = tri[t + 2] * 2, ax = pts[a], ay = pts[a + 1], bx = pts[b], by = pts[b + 1], cx = pts[c], cy = pts[c + 1];
    const mx = (ax + bx + cx) / 3, my = (ay + by + cy) / 3, col = [0, 0, 0];
    for (const [sx, sy] of [[mx, my], [(mx + ax) / 2, (my + ay) / 2], [(mx + bx) / 2, (my + by) / 2], [(mx + cx) / 2, (my + cy) / 2]]) { const v = px(sx, sy); col[0] += v[0]; col[1] += v[1]; col[2] += v[2]; }
    const nz = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax), sh = 0.93 + 0.14 * (((Math.sin(mx * 12.9898 + my * 78.233) * 43758.5453) % 1 + 1) % 1);   // 面ごとに少し明暗
    for (const [vx, vy] of nz > 0 ? [[ax, ay], [bx, by], [cx, cy]] : [[ax, ay], [cx, cy], [bx, by]]) {
      out[o++] = vx * k; out[o++] = vy * k; out[o++] = col[0] / 1020 * sh; out[o++] = col[1] / 1020 * sh; out[o++] = col[2] / 1020 * sh; }
  }
  return out;
}
// Delaunay 三角形分割（Bowyer–Watson）。pts＝[x0, y0, x1, y1, …]、返り値＝三角形ごとの点の番号
function delaunay(pts) {
  const n = pts.length / 2; let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < n; i++) { const x = pts[i * 2], y = pts[i * 2 + 1]; if (x < minX) minX = x; if (y < minY) minY = y; if (x > maxX) maxX = x; if (y > maxY) maxY = y; }
  const d = Math.max(maxX - minX, maxY - minY) * 20, mx = (minX + maxX) / 2, my = (minY + maxY) / 2;
  const P = pts.concat([mx - d, my - d, mx, my + d, mx + d, my - d]);
  let T = [];   // [a, b, c, ccx, ccy, r2]
  const circ = (a, b, c) => { const ax = P[a * 2], ay = P[a * 2 + 1], bx = P[b * 2], by = P[b * 2 + 1], cx = P[c * 2], cy = P[c * 2 + 1];
    const D = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by)) || 1e-9, a2 = ax * ax + ay * ay, b2 = bx * bx + by * by, c2 = cx * cx + cy * cy;
    const ux = (a2 * (by - cy) + b2 * (cy - ay) + c2 * (ay - by)) / D, uy = (a2 * (cx - bx) + b2 * (ax - cx) + c2 * (bx - ax)) / D;
    return [a, b, c, ux, uy, (ax - ux) ** 2 + (ay - uy) ** 2]; };
  T.push(circ(n, n + 1, n + 2));
  // 近い順に入れる（横帯ごとに蛇行）と速い
  const order = Array.from({ length: n }, (_, i) => i).sort((i, j) => { const bi = Math.floor(P[i * 2 + 1] / 8), bj = Math.floor(P[j * 2 + 1] / 8); return bi - bj || (bi % 2 ? P[j * 2] - P[i * 2] : P[i * 2] - P[j * 2]); });
  for (const i of order) {
    const x = P[i * 2], y = P[i * 2 + 1], keep = [], edges = new Map();
    for (const t of T) {
      if ((x - t[3]) ** 2 + (y - t[4]) ** 2 < t[5]) {
        for (const [u, v] of [[t[0], t[1]], [t[1], t[2]], [t[2], t[0]]]) { const key = u < v ? u * 100000 + v : v * 100000 + u; edges.set(key, edges.has(key) ? null : [u, v]); }
      } else keep.push(t);
    }
    for (const e of edges.values()) if (e) keep.push(circ(e[0], e[1], i));
    T = keep;
  }
  const out = []; for (const t of T) if (t[0] < n && t[1] < n && t[2] < n) out.push(t[0], t[1], t[2]);
  return out;
}

// ── ドット絵の色選び（CPU）：明るさの幅（1%で切る）と、写真から24色（メディアンカット）
function levels(px) {
  const n = px.length / 4, lo = [], hi = [];
  for (let c = 0; c < 3; c++) {
    const h = new Uint32Array(256); for (let i = 0; i < n; i++) h[px[i * 4 + c]]++;
    const cut = n * 0.01; let a = 0, s = 0; while (a < 255 && s + h[a] <= cut) s += h[a++];
    let b = 255; s = 0; while (b > a && s + h[b] <= cut) s += h[b--];
    lo.push(a / 255); hi.push(b / 255);
  }
  return { lo, hi };
}
function medianCut(px, n) {
  const N = px.length / 4; let boxes = [Array.from({ length: N }, (_, i) => i)];
  const span = b => { const mn = [255, 255, 255], mx = [0, 0, 0]; for (const i of b) for (let c = 0; c < 3; c++) { const v = px[i * 4 + c]; if (v < mn[c]) mn[c] = v; if (v > mx[c]) mx[c] = v; } return mx.map((v, c) => v - mn[c]); };
  while (boxes.length < n) {
    let bi = -1, best = -1, bc = 0;
    boxes.forEach((b, k) => { if (b.length < 2) return; const r = span(b), c = r.indexOf(Math.max(...r)), sc = r[c] * Math.sqrt(b.length); if (sc > best) { best = sc; bi = k; bc = c; } });
    if (bi < 0 || best <= 0) break;
    const b = boxes[bi].sort((i, j) => px[i * 4 + bc] - px[j * 4 + bc]), mid = b.length >> 1;
    boxes.splice(bi, 1, b.slice(0, mid), b.slice(mid));
  }
  return boxes.map(b => { const s = [0, 0, 0]; for (const i of b) for (let c = 0; c < 3; c++) s[c] += px[i * 4 + c]; return s.map(v => v / b.length / 255); });
}
function oklab([r, g, b]) {
  const lin = c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; r = lin(r); g = lin(g); b = lin(b);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b), m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b),
        s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s, 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s];
}

// ── ロゴと日時（グリッチ）。CPU で 1080×520 の透過帯を作り、GPU で重ねる
const G5x7 = {
  '0': ['01110', '10001', '10011', '10101', '11001', '10001', '01110'], '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  '2': ['01110', '10001', '00001', '00010', '00100', '01000', '11111'], '3': ['11111', '00010', '00100', '00010', '00001', '10001', '01110'],
  '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'], '5': ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  '6': ['00110', '01000', '10000', '11110', '10001', '10001', '01110'], '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'], '9': ['01110', '10001', '10001', '01111', '00001', '00010', '01100'],
  ':': ['00000', '01100', '01100', '00000', '01100', '01100', '00000'], "'": ['01100', '01100', '00100', '01000', '00000', '00000', '00000'],
  ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000'],
  'A': ['01110', '10001', '10001', '11111', '10001', '10001', '10001'], 'B': ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  'C': ['01110', '10001', '10000', '10000', '10000', '10001', '01110'], 'D': ['11100', '10010', '10001', '10001', '10001', '10010', '11100'],
  'E': ['11111', '10000', '10000', '11110', '10000', '10000', '11111'], 'F': ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
  'G': ['01110', '10001', '10000', '10111', '10001', '10001', '01111'], 'J': ['00111', '00010', '00010', '00010', '00010', '10010', '01100'],
  'L': ['10000', '10000', '10000', '10000', '10000', '10000', '11111'], 'M': ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
  'N': ['10001', '10001', '11001', '10101', '10011', '10001', '10001'], 'O': ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  'P': ['11110', '10001', '10001', '11110', '10000', '10000', '10000'], 'R': ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  'S': ['01111', '10000', '10000', '01110', '00001', '00001', '11110'], 'T': ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  'U': ['10001', '10001', '10001', '10001', '10001', '10001', '01110'], 'V': ['10001', '10001', '10001', '10001', '10001', '01010', '00100'],
  'Y': ['10001', '10001', '01010', '00100', '00100', '00100', '00100'],
  'H': ['10001', '10001', '10001', '11111', '10001', '10001', '10001'], 'I': ['01110', '00100', '00100', '00100', '00100', '00100', '01110'],
  'K': ['10001', '10010', '10100', '11000', '10100', '10010', '10001'], 'Q': ['01110', '10001', '10001', '10001', '10101', '10010', '01101'],
  'W': ['10001', '10001', '10001', '10101', '10101', '10101', '01010'], 'X': ['10001', '10001', '01010', '00100', '01010', '10001', '10001'],
  'Z': ['11111', '00001', '00010', '00100', '01000', '10000', '11111'], '.': ['00000', '00000', '00000', '00000', '00000', '01100', '01100'],
  '·': ['00000', '00000', '00000', '01100', '01100', '00000', '00000'],
};

class Gray { constructor(w, h, d) { this.w = w; this.h = h; this.d = d || new Float32Array(w * h); } }
class Layer { constructor(w, h) { this.w = w; this.h = h; const n = w * h; this.r = new Float32Array(n); this.g = new Float32Array(n); this.b = new Float32Array(n); this.a = new Float32Array(n); } }

function shiftX(m, dx) {
  const o = new Gray(m.w, m.h);
  for (let y = 0; y < m.h; y++) for (let x = Math.max(0, dx); x < Math.min(m.w, m.w + dx); x++) o.d[y * m.w + x] = m.d[y * m.w + x - dx];
  return o;
}
function offsetWrap(m, dx, dy) {
  const o = new Gray(m.w, m.h);
  for (let y = 0; y < m.h; y++) { const sy = ((y - dy) % m.h + m.h) % m.h;
    for (let x = 0; x < m.w; x++) o.d[y * m.w + x] = m.d[sy * m.w + ((x - dx) % m.w + m.w) % m.w]; }
  return o;
}
function scan(m, v) { for (let y = 0; y < m.h; y += 3) for (let x = 0; x < m.w; x++) m.d[y * m.w + x] = Math.floor(m.d[y * m.w + x] * v / 255); }
function sep(m, fnRow) {   // 横→縦の順に1次元処理
  const t = new Gray(m.w, m.h), o = new Gray(m.w, m.h), row = new Float32Array(Math.max(m.w, m.h)), res = new Float32Array(Math.max(m.w, m.h));
  for (let y = 0; y < m.h; y++) { for (let x = 0; x < m.w; x++) row[x] = m.d[y * m.w + x]; fnRow(row, res, m.w); for (let x = 0; x < m.w; x++) t.d[y * m.w + x] = res[x]; }
  for (let x = 0; x < m.w; x++) { for (let y = 0; y < m.h; y++) row[y] = t.d[y * m.w + x]; fnRow(row, res, m.h); for (let y = 0; y < m.h; y++) o.d[y * m.w + x] = res[y]; }
  return o;
}
function maxFilter(m, r) {
  return sep(m, (a, out, n) => { for (let i = 0; i < n; i++) { let v = 0; for (let j = Math.max(0, i - r); j <= Math.min(n - 1, i + r); j++) v = Math.max(v, a[j]); out[i] = v; } });
}
const KCACHE = new Map();
function blurGray(m, sigma) {
  let k = KCACHE.get(sigma);
  if (!k) { const R = Math.ceil(sigma * 3); k = new Float32Array(2 * R + 1); let s = 0;
    for (let i = -R; i <= R; i++) { k[i + R] = Math.exp(-i * i / (2 * sigma * sigma)); s += k[i + R]; } for (let i = 0; i < k.length; i++) k[i] /= s; KCACHE.set(sigma, k); }
  const R = (k.length - 1) / 2;
  return sep(m, (a, out, n) => { for (let i = 0; i < n; i++) { let v = 0; for (let j = -R; j <= R; j++) v += a[Math.min(n - 1, Math.max(0, i + j))] * k[j + R]; out[i] = v; } });
}
function resize1(a, sn, dn) {   // PIL の BILINEAR（縮小は三角フィルタで平均）
  const out = new Float32Array(dn), sc = sn / dn, sup = Math.max(1, sc);
  for (let i = 0; i < dn; i++) { const c = (i + 0.5) * sc; let v = 0, ws = 0;
    for (let x = Math.max(0, Math.floor(c - sup)); x <= Math.min(sn - 1, Math.ceil(c + sup)); x++) { const w = Math.max(0, 1 - Math.abs((x + 0.5 - c) / sup)); v += a[x] * w; ws += w; }
    out[i] = ws ? v / ws : 0; }
  return out;
}
function resize(m, dw, dh) {
  const t = new Gray(dw, m.h), o = new Gray(dw, dh);
  for (let y = 0; y < m.h; y++) t.d.set(resize1(m.d.subarray(y * m.w, (y + 1) * m.w), m.w, dw), y * dw);
  const col = new Float32Array(m.h);
  for (let x = 0; x < dw; x++) { for (let y = 0; y < m.h; y++) col[y] = t.d[y * dw + x]; const r = resize1(col, m.h, dh); for (let y = 0; y < dh; y++) o.d[y * dw + x] = r[y]; }
  return o;
}
const lowres = (m, k, blur) => blurGray(resize(resize(m, Math.max(2, Math.floor(m.w * k * 0.8)), Math.max(2, Math.floor(m.h * k))), m.w, m.h), blur);
function mkBands(r, h, s, n0, n1, lo, hi) {
  const out = []; for (let i = randint(r, n0, n1); i > 0; i--) { const bh = randint(r, 3, 14); out.push([randint(r, 0, Math.max(0, h - bh)), bh, Math.trunc(sign(r) * randint(r, lo, hi) * s)]); }
  return out;
}
function applyBands(m, bands) {
  const o = new Gray(m.w, m.h, m.d.slice());
  for (const [y0, bh, dx] of bands) for (let y = y0; y < Math.min(m.h, y0 + bh); y++) for (let x = 0; x < m.w; x++) {
    const sx = x - dx; o.d[y * m.w + x] = sx >= 0 && sx < m.w ? m.d[y * m.w + sx] : 0; }
  return o;
}
function blurLayer(L, sigma) {
  const o = new Layer(L.w, L.h);
  for (const c of ['r', 'g', 'b', 'a']) o[c] = blurGray(new Gray(L.w, L.h, L[c]), sigma).d;
  return o;
}
function over(dst, src, ox, oy) {   // PIL の alpha_composite（透過どうしの重ね）
  for (let y = 0; y < src.h; y++) { const dy = y + oy; if (dy < 0 || dy >= dst.h) continue;
    for (let x = 0; x < src.w; x++) { const dx = x + ox; if (dx < 0 || dx >= dst.w) continue;
      const i = y * src.w + x, j = dy * dst.w + dx, sa = src.a[i] / 255; if (sa <= 0) continue;
      const da = dst.a[j] / 255, oa = sa + da * (1 - sa), kd = da * (1 - sa);
      dst.r[j] = (src.r[i] * sa + dst.r[j] * kd) / oa; dst.g[j] = (src.g[i] * sa + dst.g[j] * kd) / oa; dst.b[j] = (src.b[i] * sa + dst.b[j] * kd) / oa; dst.a[j] = oa * 255; } }
}

export class Overlay {
  constructor(logoImg, vhsLogoImg = logoImg) {   // logoImg＝logo_white.png（ドット絵・ゲーム）、vhsLogoImg＝logo_vhs.png（v8：凸版文久見出しゴシック EB の「浪漫制作」）
    const w = 300, h = Math.round(vhsLogoImg.height * w / vhsLogoImg.width);   // v8：VHS のロゴは幅300
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const x = c.getContext('2d', { willReadFrequently: true }); x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high'; x.drawImage(vhsLogoImg, 0, 0, w, h);
    const d = x.getImageData(0, 0, w, h).data; this.logo = new Gray(w, h); for (let i = 0; i < w * h; i++) this.logo.d[i] = d[i * 4 + 3];
    { const dw = vhsLogoImg.width, dh = vhsLogoImg.height, c2 = document.createElement('canvas'); c2.width = dw; c2.height = dh;   // v12：ドットのロゴ（等倍で読む）
      const x2 = c2.getContext('2d', { willReadFrequently: true }); x2.drawImage(vhsLogoImg, 0, 0); const a = x2.getImageData(0, 0, dw, dh).data;
      this.dots = new Gray(dw, dh); for (let i = 0; i < dw * dh; i++) this.dots.d[i] = a[i * 4 + 3]; }
    this.cache = new Map(); this.img = logoImg;
  }

  /** ドット絵：ポストカード風のラベル（180×320 のドットで描く）。look_pixel_reference.py の card と同じ配置 */
  dotCard(dt) {
    const key = 'dot|' + dt.toISOString().slice(0, 16), [w, h] = DOT.size, out = new Uint8ClampedArray(w * h * 4);
    const put = (x, y, c) => { if (x < 0 || y < 0 || x >= w || y >= h) return; const i = (y * w + x) * 4; out[i] = c[0]; out[i + 1] = c[1]; out[i + 2] = c[2]; out[i + 3] = 255; };
    const INK = [0x26, 0x21, 0x3f], PAPER = [0xf3, 0xef, 0xe6], SHADE = [0x1d, 0x18, 0x3c], GRAY = [0x8a, 0x86, 0xa0];
    const text = (x, y, str, c) => [...str].forEach((ch, i) => (G5x7[ch] || G5x7[' ']).forEach((row, ry) => [...row].forEach((v, rx) => { if (v === '1') put(x + i * 6 + rx, y + ry, c); })));
    const lw = 74, lh = Math.round(this.img.height * lw / this.img.width);
    if (!this.dotLogo) {   // ロゴをドットにする（面積で縮めて、濃いところだけ残す）
      const c = document.createElement('canvas'); c.width = lw; c.height = lh; const g = c.getContext('2d', { willReadFrequently: true });
      g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high'; g.drawImage(this.img, 0, 0, lw, lh);
      const a = g.getImageData(0, 0, lw, lh).data; this.dotLogo = Array.from({ length: lw * lh }, (_, i) => a[i * 4 + 3] > 110);
    }
    const x0 = 10, y0 = 26, cw = 160, ch = 6 + lh + 4 + 7 + 4 + 1 + 4 + 7 + 6;
    for (let y = y0 + 1; y <= y0 + ch; y++) for (let x = x0 + 1; x <= x0 + cw; x++) put(x, y, SHADE);           // 影（右下に1ドット）
    for (let y = y0; y < y0 + ch; y++) for (let x = x0; x < x0 + cw; x++) {
      const edge = x === x0 || x === x0 + cw - 1 || y === y0 || y === y0 + ch - 1; put(x, y, edge && (x + y) % 2 === 0 ? INK : PAPER); }   // 点線のふち
    let yy = y0 + 6;
    for (let y = 0; y < lh; y++) for (let x = 0; x < lw; x++) if (this.dotLogo[y * lw + x]) put(x0 + 6 + x, yy + y, INK);
    const hr = dt.getHours(), tm = `${hr < 12 ? 'AM' : 'PM'} ${hr % 12 || 12}:${String(dt.getMinutes()).padStart(2, '0')}`;
    text(x0 + cw - 6 - tm.length * 6, yy + lh - 7, tm, INK);
    yy += lh + 4; text(x0 + 6, yy, `${DAYS[(dt.getDay() + 6) % 7]} ${dt.getDate()} ${MONTHS[dt.getMonth()]}`, INK);
    yy += 7 + 4; for (let x = x0 + 6; x < x0 + cw - 6; x += 2) put(x, yy, INK);
    yy += 5; text(x0 + 6, yy, `STAY WITH ROMAN · ${dt.getFullYear()}`, GRAY);
    return { key, data: new Uint8Array(out.buffer) };
  }

  /** ゲーム：画面下の操作表示（PRESS ✕ TO SAVE）にロゴと日時。1080×1920 の透過 */
  gameLayer(dt) {
    const key = 'game|' + dt.toISOString().slice(0, 16), c = document.createElement('canvas'); c.width = W; c.height = H;
    const x = c.getContext('2d', { willReadFrequently: true }), img = this.img, F = sz => `800 ${sz}px "Helvetica Neue", Arial, sans-serif`;
    const hr = dt.getHours(), tm = `${MON[dt.getMonth()]} ${dt.getDate()} ${dt.getFullYear()} · ${hr < 12 ? 'AM' : 'PM'} ${hr % 12 || 12}:${String(dt.getMinutes()).padStart(2, '0')}`;
    const bw = 660, bh = 250, bx = (W - bw) / 2, by = 1330, r = 22;
    x.save(); x.shadowColor = 'rgba(80, 160, 255, 0.55)'; x.shadowBlur = 30;
    x.beginPath(); x.roundRect(bx, by, bw, bh, r); x.fillStyle = 'rgba(12, 16, 34, 0.78)'; x.fill(); x.restore();
    x.lineWidth = 3; x.strokeStyle = 'rgba(170, 205, 255, 0.85)'; x.beginPath(); x.roundRect(bx, by, bw, bh, r); x.stroke();
    const lw = 250, lh = Math.round(img.height * lw / img.width); x.drawImage(img, (W - lw) / 2, by + 16, lw, lh);
    x.fillStyle = '#e8eefc'; x.textAlign = 'center'; x.font = F(30); x.fillText(tm, W / 2, by + 16 + lh + 44);
    x.font = F(36); x.textAlign = 'left'; const a = 'PRESS', b = 'TO SAVE', gap = 64, wa = x.measureText(a).width, wb = x.measureText(b).width;
    const x0 = W / 2 - (wa + gap + wb) / 2, cy = by + bh - 42, cx = x0 + wa + gap / 2;
    x.fillText(a, x0, cy + 13); x.fillText(b, x0 + wa + gap, cy + 13);
    x.beginPath(); x.arc(cx, cy, 22, 0, Math.PI * 2); x.fillStyle = '#2f62d8'; x.fill(); x.lineWidth = 3; x.strokeStyle = '#cfe0ff'; x.stroke();
    x.strokeStyle = '#ffffff'; x.lineWidth = 5; x.beginPath(); x.moveTo(cx - 9, cy - 9); x.lineTo(cx + 9, cy + 9); x.moveTo(cx + 9, cy - 9); x.lineTo(cx - 9, cy + 9); x.stroke();
    return { key, data: new Uint8Array(x.getImageData(0, 0, W, H).data.buffer) };
  }


  /** lines＝osdLines() の2行。seed で崩れ方が決まる。burst＝大きく乱れる */
  get(lines, seed, burst = false) {
    const key = lines.join('|') + '#' + seed + (burst ? 'b' : '');
    let v = this.cache.get(key);
    if (!v) { v = { key, data: this._make(lines, seed, burst) }; this.cache.set(key, v); if (this.cache.size > 48) this.cache.delete(this.cache.keys().next().value); }
    return v;
  }

  _logo(seed, burst) {   // 横に裂けてずれる帯・3行おきの走査線の抜け・赤を右／青を左へ
    const r = rng(seed), s = burst ? G.burst : 1, pad = 40, L = this.logo, w = L.w + 2 * pad, h = L.h;
    const A = new Gray(w, h); for (let y = 0; y < h; y++) A.d.set(L.d.subarray(y * L.w, (y + 1) * L.w), y * w + pad);
    const out = lowres(applyBands(A, mkBands(r, h, s, ...G.logoBands, ...G.logoShift)), ...G.logoLowres); scan(out, G.logoScan);
    const off = Math.trunc(G.logoRgb * s), R = shiftX(out, off), B = shiftX(out, -off), Ly = new Layer(w, h);
    for (let i = 0; i < w * h; i++) { Ly.r[i] = R.d[i]; Ly.g[i] = out.d[i]; Ly.b[i] = B.d[i]; Ly.a[i] = Math.floor(Math.max(R.d[i], out.d[i], B.d[i]) * 0.95); }
    return Ly;
  }

  _osd(lines, seed, burst) {   // 白いドット文字＋黒い縁。画質を落としてグリッチ（ロゴより弱め）
    const px = 6, LS = 56, pad = 40, r = rng(seed + 101), s = burst ? G.burst : 1;
    const tw = Math.max(...lines.map(t => t.length)) * 6 * px, th = 7 * px + LS * (lines.length - 1), w = tw + 2 * pad, h = th + 12;
    let text = new Gray(w, h);
    lines.forEach((t, k) => { const x0 = pad + tw - t.length * 6 * px, y0 = k * LS;
      [...t].forEach((ch, i) => (G5x7[ch] || G5x7[' ']).forEach((row, ry) => [...row].forEach((c, rx) => {
        if (c !== '1') return; const X = x0 + i * 6 * px + rx * px, Y = y0 + ry * px;
        for (let yy = Y; yy < Y + px; yy++) text.d.fill(255, yy * w + X, yy * w + X + px); }))); });
    return { x: W - 72 - tw - pad, y: 58, ...this._dots(text, r, s) };   // 窓の右上から 右72・上58
  }

  _dots(text, r, s) {   // 白いドット文字に黒い縁を付けて画質を落とす（日時とロゴで共通）
    const w = text.w, h = text.h;
    let shadow = offsetWrap(maxFilter(text, 3), 3, 3);
    const [k, bt, bs] = G.osdLowres; text = lowres(text, k, bt); shadow = lowres(shadow, k, bs);
    const bands = mkBands(r, h, s, ...G.osdBands, ...G.osdShift); text = applyBands(text, bands); shadow = applyBands(shadow, bands);
    scan(text, G.osdScan);
    const off = Math.trunc(G.osdRgb * s), R = shiftX(text, off), B = shiftX(text, -off), dark = new Layer(w, h), col = new Layer(w, h);
    for (let i = 0; i < w * h; i++) {
      dark.r[i] = 10; dark.g[i] = 10; dark.b[i] = 14; dark.a[i] = Math.floor(shadow.d[i] * 0.85);
      col.r[i] = Math.floor(R.d[i] * 246 / 255); col.g[i] = Math.floor(text.d[i] * 246 / 255); col.b[i] = Math.floor(B.d[i] * 246 / 255);
      col.a[i] = Math.max(R.d[i], text.d[i], B.d[i]); }
    return { dark, col };
  }

  _logoDots(seed) {   // v12：左上のロゴ＝日時と同じドット（logo_vhs.png の1画素＝1ドット）。窓の左上から 左72・上58
    const px = 6, pad = 40, L = this.dots, w = L.w * px + 2 * pad, h = L.h * px + 12, text = new Gray(w, h);
    for (let y = 0; y < L.h; y++) for (let x = 0; x < L.w; x++) if (L.d[y * L.w + x] > 127) {
      const X = pad + x * px, Y = y * px; for (let yy = Y; yy < Y + px; yy++) text.d.fill(255, yy * w + X, yy * w + X + px); }
    return { x: 72 - pad, y: 58, ...this._dots(text, rng(seed + 202), 1) };
  }

  _make(lines, seed, burst) {
    const band = new Layer(W, BAND_H);
    for (const o of [this._logoDots(seed), this._osd(lines, seed, burst)]) {   // 帯（窓の上端から）の中の位置
      over(band, o.dark, o.x, o.y); over(band, blurLayer(o.col, 2), o.x, o.y); over(band, o.col, o.x, o.y); }
    const out = new Uint8ClampedArray(W * BAND_H * 4);
    for (let i = 0; i < W * BAND_H; i++) { out[i * 4] = band.r[i]; out[i * 4 + 1] = band.g[i]; out[i * 4 + 2] = band.b[i]; out[i * 4 + 3] = band.a[i]; }
    return new Uint8Array(out.buffer);
  }
}
