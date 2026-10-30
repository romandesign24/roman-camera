// 浪漫カメラ：写真の撮影日時（EXIF の DateTimeOriginal）を読む。JPEG と HEIC。読めなければ null。
const u16 = (b, o) => (b[o] << 8) | b[o + 1];
const u32 = (b, o) => (b[o] * 16777216) + ((b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]);
const fourcc = (b, o) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);

export async function photoDate(file) {
  try {
    const head = new Uint8Array(await file.slice(0, Math.min(file.size, 512 * 1024)).arrayBuffer());
    if (head[0] === 0xff && head[1] === 0xd8) return jpeg(head);
    if (fourcc(head, 4) === 'ftyp') return await heif(file, head);
  } catch (e) { console.warn('EXIF', e); }
  return null;
}

function jpeg(b) {
  let p = 2;
  while (p + 4 < b.length && b[p] === 0xff) {
    const m = b[p + 1], len = u16(b, p + 2);
    if (m === 0xe1 && fourcc(b, p + 4) === 'Exif') return tiff(b, p + 10);
    if (m === 0xda) break;
    p += 2 + len;
  }
  return null;
}

function tiff(b, t) {   // t＝TIFF ヘッダの位置
  const le = b[t] === 0x49;
  const r16 = o => le ? b[t + o] | (b[t + o + 1] << 8) : u16(b, t + o);
  const r32 = o => le ? (b[t + o] | (b[t + o + 1] << 8) | (b[t + o + 2] << 16) | (b[t + o + 3] << 24)) >>> 0 : u32(b, t + o);
  const str = (o, n) => { let s = ''; for (let i = 0; i < n && b[t + o + i]; i++) s += String.fromCharCode(b[t + o + i]); return s; };
  const ifd = (off, want) => {
    const res = {}, n = r16(off);
    for (let i = 0; i < n; i++) {
      const e = off + 2 + i * 12, tag = r16(e); if (!want.includes(tag)) continue;
      const type = r16(e + 2), cnt = r32(e + 4);
      res[tag] = type === 2 ? str(cnt > 4 ? r32(e + 8) : e + 8, cnt) : r32(e + 8);
    }
    return res;
  };
  const i0 = ifd(r32(4), [0x0132, 0x8769]); let s = null;
  if (i0[0x8769]) { const ex = ifd(i0[0x8769], [0x9003, 0x9004]); s = ex[0x9003] || ex[0x9004]; }
  const m = (s || i0[0x0132] || '').match(/(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if (!m) return null;
  const d = new Date(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +m[6]);   // 撮影した場所の時刻のまま
  return d.getFullYear() > 1990 ? d : null;
}

function* kids(b, s, e) {
  let p = s;
  while (p + 8 <= e) { const size = u32(b, p); if (size < 8 || p + size > e) return; yield { type: fourcc(b, p + 4), s: p, b: p + 8, e: p + size }; p += size; }
}

async function heif(file, head) {   // meta → iinf で Exif の項目を探し、iloc で場所を知る
  let meta = null; for (const k of kids(head, 0, head.length)) if (k.type === 'meta') { meta = { ...k, b: k.b + 4 }; break; }
  if (!meta) return null;
  let exifId = null, iloc = null;
  for (const k of kids(head, meta.b, meta.e)) {
    if (k.type === 'iinf') {
      const v = head[k.b];
      for (const e of kids(head, k.b + 4 + (v === 0 ? 2 : 4), k.e)) {
        if (e.type !== 'infe' || head[e.b] < 2) continue;
        const iv = head[e.b], id = iv === 2 ? u16(head, e.b + 4) : u32(head, e.b + 4);
        if (fourcc(head, e.b + 4 + (iv === 2 ? 2 : 4) + 2) === 'Exif') exifId = id;
      }
    } else if (k.type === 'iloc') iloc = k;
  }
  if (exifId === null || !iloc) return null;
  const v = head[iloc.b]; let q = iloc.b + 4;
  const os = head[q] >> 4, ls = head[q] & 15, bs = head[q + 1] >> 4, is = v >= 1 ? head[q + 1] & 15 : 0; q += 2;
  const rd = n => { let x = 0; for (let i = 0; i < n; i++) x = x * 256 + head[q + i]; q += n; return x; };
  const cnt = rd(v < 2 ? 2 : 4);
  for (let i = 0; i < cnt; i++) {
    const id = rd(v < 2 ? 2 : 4); if (v >= 1) rd(2); rd(2); const base = rd(bs), ne = rd(2); let off = 0, len = 0;
    for (let j = 0; j < ne; j++) { if (v >= 1 && is) rd(is); const eo = rd(os), el = rd(ls); if (j === 0) { off = eo; len = el; } }
    if (id === exifId) {
      const d = new Uint8Array(await file.slice(base + off, base + off + Math.min(len, 1 << 16)).arrayBuffer());
      return tiff(d, 4 + u32(d, 0));
    }
  }
  return null;
}
