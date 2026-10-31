// 浪漫カメラ「ゲーム」モード：写真・動画の人を切り抜き、PS1 風の 3D の世界（秋の公園）に立たせる。
// 世界はここで作る（低ポリの木・建物・地面、64px の粗いテクスチャ、霧、頂点のガタつき、アフィンのゆがみ）。
// 人の切り抜きは MediaPipe（vendor/ に同梱・端末の中だけで動く）。人がいないときは写真を看板にして立てる。
import { rng } from './look.js';

const RW = 270, RH = 480;   // PS1 くらいの粗さで描く（表示は 4 倍に拡大）
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
precision highp float; out vec4 o; uniform float h;
void main() { float y = 1.0 - gl_FragCoord.y / h; vec3 a = vec3(0.98, 0.62, 0.42), b = vec3(0.42, 0.36, 0.58); o = vec4(mix(a, b, smoothstep(0.45, 1.0, y)), 1.0); }`;

function mat4persp(fov, asp, n, f) { const t = 1 / Math.tan(fov / 2); return [t / asp, 0, 0, 0, 0, t, 0, 0, 0, 0, (f + n) / (n - f), -1, 0, 0, 2 * f * n / (n - f), 0]; }
function mat4look(e, c, u) {
  const z = norm([e[0] - c[0], e[1] - c[1], e[2] - c[2]]), x = norm(cross(u, z)), y = cross(z, x);
  return [x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x, e), -dot(y, e), -dot(z, e), 1];
}
function mul(a, b) { const o = new Array(16).fill(0); for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) for (let k = 0; k < 4; k++) o[j * 4 + i] += a[k * 4 + i] * b[j * 4 + k]; return o; }
const norm = v => { const l = Math.hypot(...v) || 1; return v.map(x => x / l); }, cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]], dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

// ── 世界のテクスチャ（64px のタイルを 4×4 並べた 256px の 1 枚）
const TILE = 64;
function atlas() {
  const c = document.createElement('canvas'); c.width = c.height = TILE * 4; const x = c.getContext('2d'), r = rng(7);
  const blot = (tx, ty, cols, n, s) => { for (let i = 0; i < n; i++) { x.fillStyle = cols[Math.floor(r() * cols.length)]; const w = 1 + Math.floor(r() * s); x.fillRect(tx * TILE + Math.floor(r() * TILE), ty * TILE + Math.floor(r() * TILE), w, w); } };
  const fill = (tx, ty, col) => { x.fillStyle = col; x.fillRect(tx * TILE, ty * TILE, TILE, TILE); };
  fill(0, 0, '#7a3a1c'); blot(0, 0, ['#a4501f', '#c86a24', '#5e2c16', '#d98a2b', '#8f4a22', '#b23b1e'], 900, 4);              // 落ち葉の地面
  fill(1, 0, '#4a3326'); for (let i = 0; i < 9; i++) { x.fillStyle = i % 2 ? '#3a281d' : '#5b4031'; x.fillRect(TILE + i * 7, 0, 3 + (i % 3), TILE); } // 木の幹
  fill(2, 0, '#c4521c'); blot(2, 0, ['#e07a22', '#f2a33a', '#9e3418', '#d8641e', '#ffcf5a', '#7d2a14'], 700, 5);               // 紅葉
  fill(3, 0, '#8a7f74'); x.fillStyle = '#6d645b'; for (let y = 0; y < TILE; y += 8) x.fillRect(3 * TILE, y, TILE, 1);           // 建物の壁＋窓
  for (let wy = 6; wy < TILE - 8; wy += 16) for (let wx = 5; wx < TILE - 8; wx += 15) { x.fillStyle = r() < 0.4 ? '#ffd27a' : '#2b3442'; x.fillRect(3 * TILE + wx, wy, 8, 9); }
  fill(0, 1, '#5d4632'); blot(0, 1, ['#6e5540', '#4d3a2a', '#7c6249'], 400, 3);                                                   // 土の道
  fill(1, 1, '#3f3f46'); blot(1, 1, ['#4f4f58', '#35353b'], 200, 3);                                                               // 屋根
  fill(2, 1, '#2f5a2b'); blot(2, 1, ['#3f7238', '#24461f', '#5b8a3a', '#7f6a2a'], 700, 5);                                         // 常緑の木
  fill(3, 1, '#26262b'); x.fillStyle = '#ffe9a8'; x.fillRect(3 * TILE + 26, TILE + 2, 12, 10);                                       // 街灯
  return c;
}
const T = (tx, ty) => [tx / 4, ty / 4, (tx + 1) / 4, (ty + 1) / 4];

// ── 低ポリの形
function quad(V, a, b, c, d, t, sh) {   // a b c d は反時計回り
  const [u0, v0, u1, v1] = t, uv = [[u0, v1], [u1, v1], [u1, v0], [u0, v0]];
  for (const i of [0, 1, 2, 0, 2, 3]) { const p = [a, b, c, d][i]; V.push(p[0], p[1], p[2], uv[i][0], uv[i][1], sh); }
}
function prism(V, cx, cz, r, y0, y1, sides, t, rot) {   // 幹
  for (let i = 0; i < sides; i++) {
    const a0 = rot + i / sides * Math.PI * 2, a1 = rot + (i + 1) / sides * Math.PI * 2, sh = 0.7 + 0.3 * Math.abs(Math.cos(a0 + 0.6));
    const p = a => [cx + Math.cos(a) * r, cz + Math.sin(a) * r];
    const [x0, z0] = p(a0), [x1, z1] = p(a1); quad(V, [x0, y0, z0], [x1, y0, z1], [x1, y1, z1], [x0, y1, z0], t, sh);
  }
}
function cone(V, cx, cz, r, y0, y1, sides, t, rot) {   // 葉（とがった多面体）
  const [u0, v0, u1, v1] = t;
  for (let i = 0; i < sides; i++) {
    const a0 = rot + i / sides * Math.PI * 2, a1 = rot + (i + 1) / sides * Math.PI * 2, sh = 0.62 + 0.38 * Math.max(0, Math.cos(a0 - 0.9));
    V.push(cx + Math.cos(a0) * r, y0, cz + Math.sin(a0) * r, u0, v1, sh, cx + Math.cos(a1) * r, y0, cz + Math.sin(a1) * r, u1, v1, sh, cx, y1, cz, (u0 + u1) / 2, v0, sh * 1.1);
    V.push(cx + Math.cos(a1) * r, y0, cz + Math.sin(a1) * r, u1, v1, 0.5, cx + Math.cos(a0) * r, y0, cz + Math.sin(a0) * r, u0, v1, 0.5, cx, y0 - r * 0.5, cz, (u0 + u1) / 2, v0, 0.45);
  }
}
function box(V, cx, cz, w, d, h, t, tr) {
  const x0 = cx - w / 2, x1 = cx + w / 2, z0 = cz - d / 2, z1 = cz + d / 2;
  quad(V, [x0, 0, z1], [x1, 0, z1], [x1, h, z1], [x0, h, z1], t, 0.95); quad(V, [x1, 0, z0], [x0, 0, z0], [x0, h, z0], [x1, h, z0], t, 0.7);
  quad(V, [x1, 0, z1], [x1, 0, z0], [x1, h, z0], [x1, h, z1], t, 0.8); quad(V, [x0, 0, z0], [x0, 0, z1], [x0, h, z1], [x0, h, z0], t, 0.65);
  quad(V, [x0, h, z1], [x1, h, z1], [x1, h, z0], [x0, h, z0], tr, 0.9);
}
function world() {
  const V = [], r = rng(31);
  for (let gz = -14; gz < 14; gz++) for (let gx = -14; gx < 14; gx++)   // 地面（タイル1枚ずつ＝アフィンのゆがみが出る）
    quad(V, [gx * 1.6, 0, (gz + 1) * 1.6], [(gx + 1) * 1.6, 0, (gz + 1) * 1.6], [(gx + 1) * 1.6, 0, gz * 1.6], [gx * 1.6, 0, gz * 1.6], Math.abs(gx) < 1 && gz > -14 ? T(0, 1) : T(0, 0), 0.85 + 0.15 * r());
  for (let i = 0; i < 46; i++) {   // 木
    const a = r() * Math.PI * 2, d = 4 + r() * 17, x = Math.cos(a) * d, z = Math.sin(a) * d; if (Math.abs(x) < 1.6 && z > 0) continue;
    const h = 2.2 + r() * 1.8, ev = r() < 0.2;
    prism(V, x, z, 0.16, 0, h * 0.55, 5, T(1, 0), r());
    cone(V, x, z, 1.0 + r() * 0.5, h * 0.45, h * 1.05, 6, ev ? T(2, 1) : T(2, 0), r()); cone(V, x, z, 0.8, h * 0.85, h * 1.4, 5, ev ? T(2, 1) : T(2, 0), r());
  }
  for (let i = 0; i < 9; i++) { const a = -Math.PI / 2 + (i - 4) * 0.33, d = 24; box(V, Math.cos(a) * d, Math.sin(a) * d, 4 + r() * 3, 4, 5 + r() * 8, T(3, 0), T(1, 1)); }   // 遠くの建物
  for (const [x, z] of [[-2.2, -3], [2.4, -6], [-2.6, -10]]) { prism(V, x, z, 0.07, 0, 2.6, 4, T(3, 1), 0); box(V, x, z, 0.35, 0.35, 0.3, T(3, 1), T(3, 1)); }   // 街灯
  return new Float32Array(V);
}

export class Game3D {
  constructor(look) {
    const gl = look.gl; this.look = look; this.gl = gl;
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('shader: ' + gl.getShaderInfoLog(s)); return s; };
    const prog = (vs, fs, attrs) => { const p = gl.createProgram(); gl.attachShader(p, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
      attrs.forEach((a, i) => gl.bindAttribLocation(p, i + 3, a)); gl.linkProgram(p); if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('link: ' + gl.getProgramInfoLog(p)); return p; };
    this.p = prog(VS, FS, ['pos', 'uv', 'shade']);
    this.sky = prog(`#version 300 es\nin vec2 pos; void main() { gl_Position = vec4(pos, 0.999, 1.0); }`, SKY_FS, ['pos']);
    this.u = n => gl.getUniformLocation(this.p, n);
    // 描く先：PS1 の粗さ（look の gms）＋奥行き
    this.fbo = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, look.t.gms, 0);
    const db = gl.createRenderbuffer(); gl.bindRenderbuffer(gl.RENDERBUFFER, db); gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, RW, RH);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, db);
    const tex = (src, w, h) => { const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
      for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.NEAREST], [gl.TEXTURE_MAG_FILTER, gl.NEAREST], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
      if (src) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src); return t; };
    this.atlas = tex(atlas()); this.ptex = tex(null);
    const vb = (data) => { const vao = gl.createVertexArray(); gl.bindVertexArray(vao); const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 3, gl.FLOAT, false, 24, 0); gl.enableVertexAttribArray(4); gl.vertexAttribPointer(4, 2, gl.FLOAT, false, 24, 12);
      gl.enableVertexAttribArray(5); gl.vertexAttribPointer(5, 1, gl.FLOAT, false, 24, 20); return { vao, b, n: data.length / 6 }; };
    this.world = vb(world()); this.person = vb(new Float32Array(36));
    this.skyv = gl.createVertexArray(); gl.bindVertexArray(this.skyv); gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW); gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(look.vao);
    this.cut = document.createElement('canvas'); this.cx = this.cut.getContext('2d', { willReadFrequently: true }); this.box = null;
  }

  /** pre＝480×852 の切り出し済み canvas、seg＝MediaPipe（null なら看板）、t＝秒（動画はカメラがゆっくり回る） */
  render(pre, seg, t) {
    const gl = this.gl, P = this._person(pre, seg);
    // 人（または看板）の板：カメラの方を向けて立てる
    const ang = 0.35 + t * 0.12, cam = [Math.sin(ang) * 4.4, 1.55, Math.cos(ang) * 4.4], fwd = norm([-cam[0], 0, -cam[2]]), right = [fwd[2], 0, -fwd[0]];
    const hgt = P.sign ? 2.2 : 1.85, wid = hgt * P.aspect, y0 = P.sign ? 0.6 : 0, hw = wid / 2;
    const a = [-right[0] * hw, y0, -right[2] * hw], b = [right[0] * hw, y0, right[2] * hw];
    const pv = []; quad(pv, a, b, [b[0], y0 + hgt, b[2]], [a[0], y0 + hgt, a[2]], [0, 0, P.u, P.v], 1.0);
    if (P.sign) { prism(pv, -right[0] * hw * 0.7, -right[2] * hw * 0.7, 0.06, 0, y0, 4, [0.75, 0.25, 1, 0.5], 0); prism(pv, right[0] * hw * 0.7, right[2] * hw * 0.7, 0.06, 0, y0, 4, [0.75, 0.25, 1, 0.5], 0); }
    gl.bindBuffer(gl.ARRAY_BUFFER, this.person.b); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(pv), gl.DYNAMIC_DRAW); this.person.n = pv.length / 6;
    // 描く
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo); gl.viewport(0, 0, RW, RH); gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(this.sky); gl.uniform1f(gl.getUniformLocation(this.sky, 'h'), RH); gl.bindVertexArray(this.skyv); gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.enable(gl.DEPTH_TEST); gl.useProgram(this.p);
    const mvp = mul([1, 0, 0, 0, 0, -1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], mul(mat4persp(1.0, RW / RH, 0.1, 60), mat4look(cam, [0, 1.05, 0], [0, 1, 0])));   // 描く先は上が0行目なので上下を返す
    gl.uniformMatrix4fv(this.u('mvp'), false, new Float32Array(mvp)); gl.uniform2f(this.u('snap'), RW / 3, RH / 3); gl.uniform2f(this.u('fog'), 7, 30); gl.uniform3f(this.u('fogc'), 0.93, 0.6, 0.45);
    gl.activeTexture(gl.TEXTURE0); gl.uniform1i(this.u('tex'), 0);
    gl.bindTexture(gl.TEXTURE_2D, this.atlas); gl.bindVertexArray(this.world.vao); gl.drawArrays(gl.TRIANGLES, 0, this.world.n);
    gl.bindTexture(gl.TEXTURE_2D, this.ptex); gl.bindVertexArray(this.person.vao); gl.drawArrays(gl.TRIANGLES, 0, 6);
    if (this.person.n > 6) { gl.bindTexture(gl.TEXTURE_2D, this.atlas); gl.drawArrays(gl.TRIANGLES, 6, this.person.n - 6); }
    gl.disable(gl.DEPTH_TEST); gl.bindVertexArray(this.look.vao);
  }

  _person(pre, seg) {   // 人を切り抜いて、粗いテクスチャにする（いなければ写真そのものを看板に）
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
    let sign = !mask || cnt < w * h * 0.02, bx;
    if (sign) bx = [0, 0, w, h]; else {
      const nb = [Math.max(0, x0 - 2), Math.max(0, y0 - 2), Math.min(w, x1 + 3), Math.min(h, y1 + 3)];
      this.box = this.box ? this.box.map((v, i) => v * 0.6 + nb[i] * 0.4) : nb; bx = this.box.map(Math.round);   // 動画でガタつかないよう少しならす
      x.putImageData(id, 0, 0);
    }
    if (sign) { x.drawImage(pre, 0, 0, w, h); for (let i = 0; i < w; i++) for (const yy of [0, 1, h - 2, h - 1]) x.fillRect(i, yy, 1, 1); }
    // PS1 らしく粗いテクスチャに（高さ 128px まで）
    const cw = Math.max(1, bx[2] - bx[0]), ch = Math.max(1, bx[3] - bx[1]), s = Math.min(1, 128 / ch), tw = Math.max(2, Math.round(cw * s)), th = Math.max(2, Math.round(ch * s));
    const small = document.createElement('canvas'); small.width = tw; small.height = th; const sx = small.getContext('2d'); sx.imageSmoothingQuality = 'high';
    sx.drawImage(this.cut, bx[0], bx[1], cw, ch, 0, 0, tw, th);
    gl.bindTexture(gl.TEXTURE_2D, this.ptex); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, small);
    return { sign, aspect: cw / ch * (480 / 852) / (240 / 426), u: 1, v: 1 };
  }
}
