// 浪漫カメラ：MP4/MOV を読む・書く（要るところだけ）。外部ライブラリなし。
// 読む：映像1本（H.264/HEVC）と音声1本（AAC）のサンプル表・設定・回転・撮影日時。書く：H.264＋AAC の MP4（moov を先頭に）。

const fourcc = (b, o) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);
const u16 = (b, o) => (b[o] << 8) | b[o + 1];
const u32 = (b, o) => (b[o] * 16777216) + ((b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]);
const i32 = (b, o) => (b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3];
const u64 = (b, o) => u32(b, o) * 4294967296 + u32(b, o + 4);
const i64 = (b, o) => i32(b, o) * 4294967296 + u32(b, o + 4);
const MAC_EPOCH = 2082844800;   // 1904-01-01 → 1970-01-01（秒）

function* kids(b, s, e) {
  let p = s;
  while (p + 8 <= e) {
    let size = u32(b, p), hdr = 8; const type = fourcc(b, p + 4);
    if (size === 1) { size = u64(b, p + 8); hdr = 16; } else if (size === 0) size = e - p;
    if (size < hdr || p + size > e) return;
    yield { type, s: p, b: p + hdr, e: p + size };
    p += size;
  }
}
const kid = (b, box, type) => { for (const k of kids(b, box.b, box.e)) if (k.type === type) return k; return null; };
const dig = (b, box, ...types) => { for (const t of types) { if (!box) return null; box = kid(b, box, t); } return box; };
function deep(b, s, e, type) { for (const k of kids(b, s, e)) { if (k.type === type) return k; if (k.type === 'wave') { const r = deep(b, k.b, k.e, type); if (r) return r; } } return null; }

/** ファイルの範囲読み（前から順に読む前提で 4MB ずつ先読み） */
export class Reader {
  constructor(file, win = 4 << 20) { this.f = file; this.win = win; this.s = 0; this.buf = null; }
  async get(off, size) {
    if (!this.buf || off < this.s || off + size > this.s + this.buf.length) {
      this.buf = new Uint8Array(await this.f.slice(off, Math.min(this.f.size, off + Math.max(size, this.win))).arrayBuffer()); this.s = off;
    }
    return this.buf.subarray(off - this.s, off - this.s + size);
  }
}

async function topBoxes(file) {
  const out = []; let p = 0;
  while (p + 8 <= file.size) {
    const h = new Uint8Array(await file.slice(p, Math.min(file.size, p + 16)).arrayBuffer());
    let size = u32(h, 0), hdr = 8; const type = fourcc(h, 4);
    if (size === 1) { size = u64(h, 8); hdr = 16; } else if (size === 0) size = file.size - p;
    if (size < hdr) break;
    out.push({ type, s: p, e: Math.min(file.size, p + size), hdr }); p += size;
  }
  return out;
}

/** MP4/MOV を読む。返り値 { video, audio, creation(Date|null) } */
export async function demux(file) {
  const tops = await topBoxes(file), mv = tops.find(t => t.type === 'moov');
  if (!mv) throw new Error('動画の中身が読めません（MP4/MOV ではない）');
  const b = new Uint8Array(await file.slice(mv.s, mv.e).arrayBuffer()), moov = { s: 0, b: mv.hdr, e: b.length };
  const mvhd = kid(b, moov, 'mvhd'), mv1 = b[mvhd.b] === 1;
  const mts = u32(b, mvhd.b + (mv1 ? 20 : 12)), ctime = mv1 ? u64(b, mvhd.b + 4) : u32(b, mvhd.b + 4);
  const tracks = []; for (const k of kids(b, moov.b, moov.e)) if (k.type === 'trak') { const t = trak(b, k, mts); if (t) tracks.push(t); }
  let creation = appleDate(b, moov);
  if (!creation && ctime > MAC_EPOCH + 946684800) creation = new Date((ctime - MAC_EPOCH) * 1000);   // 2000年より前は未設定とみなす
  return { video: tracks.find(t => t.kind === 'video' && t.codec) || null, audio: tracks.find(t => t.kind === 'audio' && t.asc) || null, creation };
}

function appleDate(b, moov) {   // iPhone：moov/meta の com.apple.quicktime.creationdate（現地時刻＋時差）
  const meta = kid(b, moov, 'meta'); if (!meta) return null;
  const m = fourcc(b, meta.b + 4) === 'hdlr' ? meta : { ...meta, b: meta.b + 4 };
  const keys = kid(b, m, 'keys'), ilst = kid(b, m, 'ilst'); if (!keys || !ilst) return null;
  const names = []; let p = keys.b + 8;
  for (let i = 0, n = u32(b, keys.b + 4); i < n && p + 8 <= keys.e; i++) { const sz = u32(b, p); names.push(String.fromCharCode(...b.subarray(p + 8, p + sz))); p += sz; }
  for (const it of kids(b, ilst.b, ilst.e)) {
    if (names[u32(b, it.s + 4) - 1] !== 'com.apple.quicktime.creationdate') continue;
    const data = kid(b, it, 'data'); if (!data) continue;
    const s = new TextDecoder().decode(b.subarray(data.b + 8, data.e)).trim().replace(/([+-]\d{2})(\d{2})$/, '$1:$2');
    const d = new Date(s); if (!isNaN(d)) return d;
  }
  return null;
}

function trak(b, tk, mts) {
  const tkhd = kid(b, tk, 'tkhd'), mdia = kid(b, tk, 'mdia'); if (!tkhd || !mdia) return null;
  const hdlr = kid(b, mdia, 'hdlr'), handler = hdlr ? fourcc(b, hdlr.b + 8) : '';
  const kind = handler === 'vide' ? 'video' : handler === 'soun' ? 'audio' : null; if (!kind) return null;
  const mdhd = kid(b, mdia, 'mdhd'), ts = u32(b, mdhd.b + (b[mdhd.b] === 1 ? 20 : 12));
  const stbl = dig(b, mdia, 'minf', 'stbl'); if (!stbl) return null;
  const mo = tkhd.b + (b[tkhd.b] === 1 ? 52 : 40);   // 行列 a b u / c d v / x y w
  const a = i32(b, mo) / 65536, bb = i32(b, mo + 4) / 65536, d = i32(b, mo + 16) / 65536;
  const rot = Math.abs(a) < 0.01 && Math.abs(d) < 0.01 ? (bb > 0 ? 90 : 270) : (a < 0 && d < 0 ? 180 : 0);
  let emptySec = 0, mediaStart = 0; const elst = dig(b, tk, 'edts', 'elst');
  if (elst) {
    const v1 = b[elst.b] === 1; let p = elst.b + 8;
    for (let i = 0, n = u32(b, elst.b + 4); i < n; i++, p += v1 ? 20 : 12) {
      const dur = v1 ? u64(b, p) : u32(b, p), mt = v1 ? i64(b, p + 8) : i32(b, p + 4);
      if (mt === -1) emptySec += dur / mts; else { mediaStart = mt; break; }
    }
  }
  const stsd = kid(b, stbl, 'stsd'), ent = kids(b, stsd.b + 8, stsd.e).next().value; if (!ent) return null;
  const t = { kind, ts, rot, fmt: ent.type, emptySec, mediaStart, samples: table(b, stbl) };
  if (kind === 'video') {
    t.width = u16(b, ent.b + 24); t.height = u16(b, ent.b + 26);
    for (const k of kids(b, ent.b + 78, ent.e)) if (k.type === 'avcC' || k.type === 'hvcC') { t.description = b.slice(k.b, k.e); t.codec = codecString(ent.type, k.type, t.description); }
  } else {
    const ver = u16(b, ent.b + 8); let ch = u16(b, ent.b + 16), rate = u32(b, ent.b + 24) / 65536, cs = ent.b + 28;
    if (ver === 1) cs += 16; else if (ver === 2) { rate = new DataView(b.buffer, b.byteOffset + ent.b + 32, 8).getFloat64(0); ch = u32(b, ent.b + 40); cs = ent.b + 64; }
    const es = ent.type === 'mp4a' ? deep(b, cs, ent.e, 'esds') : null, info = es && esds(b, es.b, es.e);
    if (info && info.oti === 0x40 && info.asc) { const c = asc(info.asc); t.asc = info.asc; t.rate = c.rate || Math.round(rate); t.ch = c.ch || ch; }
  }
  return t;
}

function codecString(fmt, cfg, d) {
  const hx = v => v.toString(16).padStart(2, '0');
  if (cfg === 'avcC') return `avc1.${hx(d[1])}${hx(d[2])}${hx(d[3])}`;
  let comp = u32(d, 2), rev = 0; for (let i = 0; i < 32; i++) { rev = (rev * 2) + (comp & 1); comp = Math.floor(comp / 2); }
  const cons = [...d.subarray(6, 12)]; while (cons.length && !cons[cons.length - 1]) cons.pop();
  return `${fmt === 'hev1' ? 'hev1' : 'hvc1'}.${['', 'A', 'B', 'C'][d[1] >> 6]}${d[1] & 31}.${rev.toString(16).toUpperCase()}.${(d[1] >> 5) & 1 ? 'H' : 'L'}${d[12]}${cons.map(c => '.' + c.toString(16).toUpperCase()).join('')}`;
}

function esds(b, s, e) {
  let p = s + 4;
  const desc = () => { const tag = b[p++]; let len = 0; for (let i = 0; i < 4; i++) { const c = b[p++]; len = (len << 7) | (c & 127); if (!(c & 128)) break; } return { tag, len }; };
  if (desc().tag !== 3) return null;
  p += 2; const fl = b[p++]; if (fl & 128) p += 2; if (fl & 64) p += 1 + b[p]; if (fl & 32) p += 2;
  if (desc().tag !== 4) return null;
  const oti = b[p]; p += 13; if (p >= e) return { oti, asc: null };
  const d = desc(); return { oti, asc: d.tag === 5 ? b.slice(p, p + d.len) : null };
}

function asc(a) {   // AudioSpecificConfig → サンプルレート・チャンネル数
  let pos = 0; const rd = n => { let v = 0; for (let i = 0; i < n; i++, pos++) v = v * 2 + ((a[pos >> 3] >> (7 - (pos & 7))) & 1); return v; };
  if (rd(5) === 31) rd(6);
  const fi = rd(4), rate = fi === 15 ? rd(24) : [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350][fi];
  return { rate, ch: rd(4) };
}

function table(b, stbl) {   // サンプルごとの 位置・大きさ・時刻・キーフレーム
  const stsz = kid(b, stbl, 'stsz'), stz2 = stsz ? null : kid(b, stbl, 'stz2'); let n, sizes;
  if (stsz) { const ss = u32(b, stsz.b + 4); n = u32(b, stsz.b + 8); sizes = new Uint32Array(n); if (ss) sizes.fill(ss); else for (let i = 0; i < n; i++) sizes[i] = u32(b, stsz.b + 12 + i * 4); }
  else { const fs = b[stz2.b + 7], o = stz2.b + 12; n = u32(b, stz2.b + 8); sizes = new Uint32Array(n);
    for (let i = 0; i < n; i++) sizes[i] = fs === 16 ? u16(b, o + i * 2) : fs === 8 ? b[o + i] : (b[o + (i >> 1)] >> (i & 1 ? 0 : 4)) & 15; }
  const stco = kid(b, stbl, 'stco'), cb = stco || kid(b, stbl, 'co64'), nc = u32(b, cb.b + 4), co = new Float64Array(nc);
  for (let i = 0; i < nc; i++) co[i] = stco ? u32(b, cb.b + 8 + i * 4) : u64(b, cb.b + 8 + i * 8);
  const stsc = kid(b, stbl, 'stsc'), ns = u32(b, stsc.b + 4), offs = new Float64Array(n); let si = 0;
  for (let i = 0; i < ns; i++) {
    const first = u32(b, stsc.b + 8 + i * 12), spc = u32(b, stsc.b + 12 + i * 12), next = i + 1 < ns ? u32(b, stsc.b + 8 + (i + 1) * 12) : nc + 1;
    for (let c = first; c < next && c <= nc; c++) { let o = co[c - 1]; for (let k = 0; k < spc && si < n; k++) { offs[si] = o; o += sizes[si]; si++; } }
  }
  const dts = new Float64Array(n), durs = new Float64Array(n), stts = kid(b, stbl, 'stts'); let t = 0, idx = 0;
  for (let i = 0, ne = u32(b, stts.b + 4); i < ne; i++) { const cnt = u32(b, stts.b + 8 + i * 8), dl = u32(b, stts.b + 12 + i * 8); for (let k = 0; k < cnt && idx < n; k++, idx++) { dts[idx] = t; durs[idx] = dl; t += dl; } }
  const cts = Float64Array.from(dts), ctts = kid(b, stbl, 'ctts');
  if (ctts) { idx = 0; for (let i = 0, ne = u32(b, ctts.b + 4); i < ne; i++) { const cnt = u32(b, ctts.b + 8 + i * 8), off = i32(b, ctts.b + 12 + i * 8); for (let k = 0; k < cnt && idx < n; k++, idx++) cts[idx] += off; } }
  let sync = null; const stss = kid(b, stbl, 'stss');
  if (stss) { sync = new Uint8Array(n); for (let i = 0, ne = u32(b, stss.b + 4); i < ne; i++) { const k = u32(b, stss.b + 8 + i * 4) - 1; if (k < n) sync[k] = 1; } }
  return { n, sizes, offs, dts, cts, durs, sync };
}

// ── 書く
const enc = new TextEncoder();
function cat(parts) { let n = 0; for (const p of parts) n += p.length; const o = new Uint8Array(n); let k = 0; for (const p of parts) { o.set(p, k); k += p.length; } return o; }
function U32(...v) { const o = new Uint8Array(v.length * 4), dv = new DataView(o.buffer); v.forEach((x, i) => dv.setUint32(i * 4, x >>> 0)); return o; }
function U32a(arr) { const o = new Uint8Array(arr.length * 4), dv = new DataView(o.buffer); for (let i = 0; i < arr.length; i++) dv.setUint32(i * 4, arr[i] >>> 0); return o; }
function U16(...v) { const o = new Uint8Array(v.length * 2), dv = new DataView(o.buffer); v.forEach((x, i) => dv.setUint16(i * 2, x & 0xffff)); return o; }
const U8 = (...v) => Uint8Array.from(v);
const box = (type, ...parts) => { const body = cat(parts.flat().filter(Boolean)), o = new Uint8Array(8 + body.length); new DataView(o.buffer).setUint32(0, o.length); o.set(enc.encode(type), 4); o.set(body, 8); return o; };
const fbox = (type, v, fl, ...parts) => box(type, U8(v, (fl >> 16) & 255, (fl >> 8) & 255, fl & 255), ...parts);
const MATRIX = U32(0x10000, 0, 0, 0, 0x10000, 0, 0, 0, 0x40000000);
function rle(vals) { const out = []; for (const v of vals) { if (out.length && out[out.length - 1][1] === v) out[out.length - 1][0]++; else out.push([1, v]); } return out; }
const runs = r => U32a([r.length, ...r.flat()]);
function desc(tag, body) { const n = body.length; return cat([U8(tag, 0x80 | ((n >> 21) & 127), 0x80 | ((n >> 14) & 127), 0x80 | ((n >> 7) & 127), n & 127), body]); }

/** video = { width, height, ts, avcC, samples:[{data, dts, cts, dur, key}]（デコード順・dts は0から） , shift（ctts のずらし）}
 *  audio = { ts, rate, ch, asc, samples:[{data, dur}], mediaTime, emptySec, segSec } または null */
export function mux({ video, audio }) {
  const now = Math.floor(Date.now() / 1000) + MAC_EPOCH, MTS = 1000;
  const vDurT = video.samples.reduce((s, x) => s + x.dur, 0), vSec = vDurT / video.ts, vDurM = Math.round(vSec * MTS);
  const items = video.samples.map((s, i) => ({ tr: 0, i, data: s.data, t: s.dts / video.ts }));
  if (audio) { let t = 0; audio.samples.forEach((s, i) => { items.push({ tr: 1, i, data: s.data, t: (t - audio.mediaTime) / audio.ts + audio.emptySec }); t += s.dur; }); }
  items.sort((x, y) => x.t - y.t || x.tr - y.tr);
  let pos = 0; for (const it of items) { it.off = pos; pos += it.data.length; }
  const vOff = new Array(video.samples.length), aOff = audio ? new Array(audio.samples.length) : null;
  const build = base => {
    for (const it of items) (it.tr ? aOff : vOff)[it.i] = base + it.off;
    const vs = video.samples, vt = [
      fbox('tkhd', 0, 3, U32(now, now, 1, 0, vDurM, 0, 0), U16(0, 0, 0, 0), MATRIX, U32(video.width * 65536, video.height * 65536)),
      video.shift ? box('edts', fbox('elst', 0, 0, U32(1, vDurM, video.shift, 0x10000))) : null,
      box('mdia', fbox('mdhd', 0, 0, U32(now, now, video.ts, vDurT), U16(0x55c4, 0)),
        fbox('hdlr', 0, 0, U32(0), enc.encode('vide'), U32(0, 0, 0), enc.encode('VideoHandler\0')),
        box('minf', fbox('vmhd', 0, 1, U16(0, 0, 0, 0)), box('dinf', fbox('dref', 0, 0, U32(1), fbox('url ', 0, 1))),
          box('stbl',
            fbox('stsd', 0, 0, U32(1), box('avc1', new Uint8Array(6), U16(1, 0, 0), U32(0, 0, 0), U16(video.width, video.height), U32(0x480000, 0x480000, 0), U16(1),
              cat([U8(11), enc.encode('RomanCamera'), new Uint8Array(20)]), U16(0x18, 0xffff), box('avcC', video.avcC))),
            fbox('stts', 0, 0, runs(rle(vs.map(s => s.dur)))),
            vs.some(s => s.cts !== s.dts) ? fbox('ctts', 0, 0, runs(rle(vs.map(s => s.cts - s.dts)))) : null,
            vs.every(s => s.key) ? null : fbox('stss', 0, 0, U32a([vs.filter(s => s.key).length, ...vs.flatMap((s, i) => s.key ? [i + 1] : [])])),
            fbox('stsc', 0, 0, U32(1, 1, 1, 1)), fbox('stsz', 0, 0, U32(0, vs.length), U32a(vs.map(s => s.data.length))), fbox('stco', 0, 0, U32a([vOff.length, ...vOff]))))),
    ];
    let at = null;
    if (audio) {
      const as = audio.samples, aDurT = as.reduce((s, x) => s + x.dur, 0), segM = Math.round(audio.segSec * MTS), emptyM = Math.round(audio.emptySec * MTS);
      const bitrate = Math.round(as.reduce((s, x) => s + x.data.length, 0) * 8 / Math.max(0.1, aDurT / audio.ts));
      const es = fbox('esds', 0, 0, desc(3, cat([U16(0), U8(0), desc(4, cat([U8(0x40, 0x15, 0, 0, 0), U32(bitrate, bitrate), desc(5, audio.asc)])), desc(6, U8(2))])));
      at = [
        fbox('tkhd', 0, 3, U32(now, now, 2, 0, emptyM + segM, 0, 0), U16(0, 1, 0x100, 0), MATRIX, U32(0, 0)),
        box('edts', fbox('elst', 0, 0, emptyM ? U32(2, emptyM, 0xffffffff, 0x10000) : U32(1), U32(segM, audio.mediaTime, 0x10000))),
        box('mdia', fbox('mdhd', 0, 0, U32(now, now, audio.ts, aDurT), U16(0x55c4, 0)),
          fbox('hdlr', 0, 0, U32(0), enc.encode('soun'), U32(0, 0, 0), enc.encode('SoundHandler\0')),
          box('minf', fbox('smhd', 0, 0, U16(0, 0)), box('dinf', fbox('dref', 0, 0, U32(1), fbox('url ', 0, 1))),
            box('stbl',
              fbox('stsd', 0, 0, U32(1), box('mp4a', new Uint8Array(6), U16(1, 0, 0), U32(0), U16(audio.ch, 16, 0, 0), U32(audio.rate * 65536), es)),
              fbox('stts', 0, 0, runs(rle(as.map(s => s.dur)))),
              fbox('stsc', 0, 0, U32(1, 1, 1, 1)), fbox('stsz', 0, 0, U32(0, as.length), U32a(as.map(s => s.data.length))), fbox('stco', 0, 0, U32a([aOff.length, ...aOff]))))),
      ];
    }
    return box('moov', fbox('mvhd', 0, 0, U32(now, now, MTS, vDurM, 0x10000), U16(0x100, 0), U32(0, 0), MATRIX, U32(0, 0, 0, 0, 0, 0), U32(audio ? 3 : 2)),
      box('trak', ...vt), at ? box('trak', ...at) : null);
  };
  const ftyp = box('ftyp', enc.encode('isom'), U32(0x200), enc.encode('isomiso2avc1mp41'));
  let moov = build(0); moov = build(ftyp.length + moov.length + 8);
  return new Blob([ftyp, moov, U32(pos + 8), enc.encode('mdat'), ...items.map(it => it.data)], { type: 'video/mp4' });
}
