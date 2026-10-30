// 浪漫カメラ：見た目（VHS風）を作る。数字の正は 見本/look_reference.py（PIL版）で、これはそれを WebGL2 に移したもの。
// 写真も動画の1コマも同じ道を通る：縦1080×1920に切り出し → 画質を落とす → にじみ・ノイズ → 左上ロゴ＋右上日時（どちらもグリッチ）。

export const W = 1080, H = 1920, TOP = 270, BAND_Y = 200, BAND_H = 520;   // ロゴと日時は y200〜720 の帯に入る
export const P = {
  sd: [240, 426], hsoft: 0.45, sharp: [5, 2.4], chromaDiv: 14, cbDx: 14, crDx: 18, sat: 0.80,
  lift: [[12, 0.93], [14, 0.92], [24, 0.88]], glow: [24, 115, 2.2], glowTint: [150, 120, 110],
  noise: 48, grain: 24, head: [70, 46, 26],
};
const PRE = [P.sd[0] * 2, P.sd[1] * 2];                 // まず 480×852 へ（2D canvas で回転・切り出し）→ 2×2平均で SD へ
const HS = Math.max(2, Math.floor(P.sd[0] * P.hsoft));  // 108：横だけさらに縮める幅
const CW = Math.floor(W / P.chromaDiv);                 // 77：色のにじみ（横1/14）
const GW = W / 4, GH = H / 4;                           // 明部のにじみは1/4で計算（半径24 → 6）

// ── 乱数（シード固定で毎回同じ崩れ方）
export function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const randint = (r, a, b) => a + Math.floor(r() * (b - a + 1));
const sign = r => (r() < 0.5 ? -1 : 1);

// ── 右上の日時：OCT 30 '26 ／ PM  1:24
const MON = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
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
uniform float thr; uniform float gain; uniform vec3 tint; uniform float nS; uniform float gS; uniform int hh; uniform int hn; uniform int useOv;
uvec3 pcg(uvec3 v) { v = v * 1664525u + 1013904223u; v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y; v ^= v >> 16u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y; return v; }
float gauss(int x, int y, uint k) { uvec3 h = pcg(uvec3(uint(x), uint(y), seed * 4u + k));
  float a = max(float(h.x >> 8u) / 16777216.0, 1e-7); float b = float(h.y >> 8u) / 16777216.0; return sqrt(-2.0 * log(a)) * cos(6.2831853 * b); }
float nz(int x, int y, uint k, float s) { return clamp(floor(128.0 + s * gauss(x, y, k) + 0.5), 0.0, 255.0); }
vec3 base(int x, int y) { x -= jit.x; y -= jit.y; if (x < 0 || y < 0 || x >= ${W} || y >= ${H}) return vec3(0.0);
  vec3 c = texelFetch(g, ivec2(x, y), 0).rgb * 255.0; vec3 b = texture(gw, (vec2(float(x), float(y)) + 0.5) / vec2(${W}.0, ${H}.0)).rgb * 255.0;
  vec3 glw = min(vec3(255.0), floor(max(vec3(0.0), b - thr) * gain)); return min(vec3(255.0), c + floor(glw * tint / 255.0)); }
void main() { int x = int(gl_FragCoord.x), y = ${H - 1} - int(gl_FragCoord.y); vec3 v;
  if (y >= ${H} - hh) { int xs = x - hdx; if (xs < 0) xs += ${W}; if (xs >= ${W}) xs -= ${W}; v = base(xs, y); } else v = base(x, y);
  if (y >= ${H} - hn) v = floor(v * 0.4 + nz(x, y, 1u, 80.0) * 0.6 + 0.5);
  float u = (float(x) + 0.5) / 3.0 - 0.5; int i0 = int(floor(u)); float f = u - float(i0);
  float n = floor(mix(nz(clamp(i0, 0, ${W / 3 - 1}), y, 2u, nS), nz(clamp(i0 + 1, 0, ${W / 3 - 1}), y, 2u, nS), f) + 0.5);
  v = floor(v * (255.0 - max(0.0, n - 145.0) * 2.0) / 255.0);
  vec2 gp = (vec2(float(x), float(y)) + 0.5) / 2.0 - 0.5; ivec2 gi = ivec2(floor(gp)); vec2 gf = gp - vec2(gi);
  ivec2 g0 = clamp(gi, ivec2(0), ivec2(${W / 2 - 1}, ${H / 2 - 1})), g1 = clamp(gi + 1, ivec2(0), ivec2(${W / 2 - 1}, ${H / 2 - 1}));
  float gr = mix(mix(nz(g0.x, g0.y, 3u, gS), nz(g1.x, g0.y, 3u, gS), gf.x), mix(nz(g0.x, g1.y, 3u, gS), nz(g1.x, g1.y, 3u, gS), gf.x), gf.y);
  v = min(vec3(255.0), v + max(0.0, floor(gr + 0.5) - 128.0));
  if (useOv == 1 && y >= ${BAND_Y} && y < ${BAND_Y + BAND_H}) { vec4 c = texelFetch(ov, ivec2(x, y - ${BAND_Y}), 0); v = v * (1.0 - c.a) + c.rgb * 255.0 * c.a; }
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
    this.t = { pre: T(...PRE), sd: T(...P.sd), hs: T(HS, P.sd[1]), sb: T(...P.sd), up: T(W, H), bh: T(W, H), sh: T(W, H),
               ch: T(CW, H), gr: T(W, H), g4: T(GW, GH), gb1: T(GW, GH), gb2: T(GW, GH), ov: T(W, BAND_H) };
    this.f = {}; for (const k in this.t) if (k !== 'pre' && k !== 'ov') this.f[k] = this._fbo(this.t[k]);
    this.k5 = taps(P.sharp[0]); this.k6 = taps(P.glow[0] / 4);
    this.ovKey = null;
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
    const gl = this.gl, pr = this.prog[name]; gl.useProgram(pr.p);
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

  /** src（img / VideoFrame / canvas）を描く。sw,sh＝src の大きさ、rot＝表示の回転（時計回り 0/90/180/270）。
   *  o = { seed：ノイズ等の乱数, jitter：動画の揺れ, overlay：Overlay.get() の結果 } */
  render(src, sw, sh, rot, o) {
    const gl = this.gl, px = this.px;
    // 1) 縦9:16の中央を切り出して 480×852 へ（回転もここで）
    const dw = rot % 180 ? sh : sw, dh = rot % 180 ? sw : sh, k = Math.max(PRE[0] / dw, PRE[1] / dh);
    px.setTransform(1, 0, 0, 1, 0, 0); px.fillStyle = '#000'; px.fillRect(0, 0, PRE[0], PRE[1]);
    px.imageSmoothingEnabled = true; px.imageSmoothingQuality = 'high';
    px.translate(PRE[0] / 2, PRE[1] / 2); px.rotate(rot * Math.PI / 180); px.scale(k, k);
    px.drawImage(src, -sw / 2, -sh / 2, sw, sh); px.setTransform(1, 0, 0, 1, 0, 0);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.t.pre);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, this.pre);
    // 2) 画質を落とす：SD → 横だけさらに縮めて戻す → 1080×1920 → 強いシャープ
    this._pass('copy', 'sd', { t: 'pre' }, { size: ['2f', ...P.sd] });
    this._pass('tri', 'hs', { t: 'sd' }, { sc: ['1f', P.sd[0] / HS], sw: ['1i', P.sd[0]] });
    this._pass('copy', 'sb', { t: 'hs' }, { size: ['2f', ...P.sd] });
    this._pass('bicubic', 'up', { t: 'sb' }, { src: ['2f', ...P.sd], dst: ['2f', W, H] });
    this._blur('up', 'bh', W, H, this.k5, [1, 0]);
    this._blur('bh', 'sh', W, H, this.k5, [0, 1], 'up', P.sharp[1]);
    // 3) 色のにじみ・彩度・暗部の青み
    this._pass('chroma', 'ch', { s: 'sh' }, { sc: ['1f', W / CW] });
    this._pass('grade', 'gr', { s: 'sh', ch: 'ch' }, { cbDx: ['1f', P.cbDx], crDx: ['1f', P.crDx], sat: ['1f', P.sat],
      la: ['3f', ...P.lift.map(v => v[0])], lb: ['3f', ...P.lift.map(v => v[1])] });
    // 4) 明部のにじみ（1/4で半径6＝元の24）
    this._pass('box4', 'g4', { g: 'gr' }, {});
    this._blur('g4', 'gb1', GW, GH, this.k6, [1, 0]);
    this._blur('gb1', 'gb2', GW, GH, this.k6, [0, 1]);
    // 5) ロゴと日時（変わったときだけ送る）
    if (o.overlay && o.overlay.key !== this.ovKey) {
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.t.ov);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, W, BAND_H, gl.RGBA, gl.UNSIGNED_BYTE, o.overlay.data); this.ovKey = o.overlay.key;
    }
    // 6) 仕上げ
    const r = rng(o.seed), jit = o.jitter ? [randint(r, -2, 2), randint(r, -2, 2)] : [0, 0];
    this._pass('final', null, { g: 'gr', gw: 'gb2', ov: 'ov' }, {
      jit: ['2i', ...jit], hdx: ['1i', P.head[1] + randint(r, -8, 8)], seed: ['1ui', o.seed >>> 0],
      thr: ['1f', P.glow[1]], gain: ['1f', P.glow[2]], tint: ['3f', ...P.glowTint], nS: ['1f', P.noise], gS: ['1f', P.grain],
      hh: ['1i', P.head[0]], hn: ['1i', P.head[2]], useOv: ['1i', o.overlay ? 1 : 0] });
  }
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
  constructor(logoImg) {   // logoImg＝logo_white.png（860×270）
    const w = 330, h = Math.round(logoImg.height * w / logoImg.width);
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const x = c.getContext('2d', { willReadFrequently: true }); x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high'; x.drawImage(logoImg, 0, 0, w, h);
    const d = x.getImageData(0, 0, w, h).data; this.logo = new Gray(w, h); for (let i = 0; i < w * h; i++) this.logo.d[i] = d[i * 4 + 3];
    this.cache = new Map();
  }

  /** lines＝osdLines() の2行。seed で崩れ方が決まる。burst＝大きく乱れる */
  get(lines, seed, burst = false) {
    const key = lines.join('|') + '#' + seed + (burst ? 'b' : '');
    let v = this.cache.get(key);
    if (!v) { v = { key, data: this._make(lines, seed, burst) }; this.cache.set(key, v); if (this.cache.size > 48) this.cache.delete(this.cache.keys().next().value); }
    return v;
  }

  _logo(seed, burst) {   // 横に裂けてずれる帯・3行おきの走査線の抜け・赤を右／青を左へ
    const r = rng(seed), s = burst ? 2 : 1, pad = 40, L = this.logo, w = L.w + 2 * pad, h = L.h;
    const A = new Gray(w, h); for (let y = 0; y < h; y++) A.d.set(L.d.subarray(y * L.w, (y + 1) * L.w), y * w + pad);
    const out = applyBands(A, mkBands(r, h, s, 3, 6, 6, 26)); scan(out, 150);
    const R = shiftX(out, 6 * s), B = shiftX(out, -6 * s), Ly = new Layer(w, h);
    for (let i = 0; i < w * h; i++) { Ly.r[i] = R.d[i]; Ly.g[i] = out.d[i]; Ly.b[i] = B.d[i]; Ly.a[i] = Math.floor(Math.max(R.d[i], out.d[i], B.d[i]) * 0.95); }
    return Ly;
  }

  _osd(lines, seed, burst) {   // 白いドット文字＋黒い縁。画質を落としてグリッチ（ロゴより弱め）
    const px = 9, pad = 40, r = rng(seed + 101), s = burst ? 2 : 1;
    const tw = Math.max(...lines.map(t => t.length)) * 6 * px, th = 7 * px + 84 * (lines.length - 1), w = tw + 2 * pad, h = th + 12;
    let text = new Gray(w, h);
    lines.forEach((t, k) => { const x0 = pad + tw - t.length * 6 * px, y0 = k * 84;
      [...t].forEach((ch, i) => (G5x7[ch] || G5x7[' ']).forEach((row, ry) => [...row].forEach((c, rx) => {
        if (c !== '1') return; const X = x0 + i * 6 * px + rx * px, Y = y0 + ry * px;
        for (let yy = Y; yy < Y + px; yy++) text.d.fill(255, yy * w + X, yy * w + X + px); }))); });
    let shadow = offsetWrap(maxFilter(text, 3), 3, 3);
    text = lowres(text, 0.45, 1.2); shadow = lowres(shadow, 0.45, 2.0);
    const bands = mkBands(r, h, s, 2, 4, 4, 12); text = applyBands(text, bands); shadow = applyBands(shadow, bands);
    scan(text, 165);
    const R = shiftX(text, 5 * s), B = shiftX(text, -5 * s), dark = new Layer(w, h), col = new Layer(w, h);
    for (let i = 0; i < w * h; i++) {
      dark.r[i] = 10; dark.g[i] = 10; dark.b[i] = 14; dark.a[i] = Math.floor(shadow.d[i] * 0.85);
      col.r[i] = Math.floor(R.d[i] * 246 / 255); col.g[i] = Math.floor(text.d[i] * 246 / 255); col.b[i] = Math.floor(B.d[i] * 246 / 255);
      col.a[i] = Math.max(R.d[i], text.d[i], B.d[i]); }
    return { x: W - 60 - tw - pad, y: TOP + 8, dark, col };
  }

  _make(lines, seed, burst) {
    const band = new Layer(W, BAND_H), lg = this._logo(seed, burst);
    over(band, blurLayer(lg, 2.5), 20, TOP - BAND_Y); over(band, lg, 20, TOP - BAND_Y);
    const o = this._osd(lines, seed, burst), oy = o.y - BAND_Y;
    over(band, o.dark, o.x, oy); over(band, blurLayer(o.col, 2), o.x, oy); over(band, o.col, o.x, oy);
    const out = new Uint8ClampedArray(W * BAND_H * 4);
    for (let i = 0; i < W * BAND_H; i++) { out[i * 4] = band.r[i]; out[i * 4 + 1] = band.g[i]; out[i * 4 + 2] = band.b[i]; out[i * 4 + 3] = band.a[i]; }
    return new Uint8Array(out.buffer);
  }
}
