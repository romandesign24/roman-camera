// 浪漫カメラ：VHS の音（v13・2026-11-03 代表）。元の AAC を読んで → 音質を落とす（低音・高音を削る・少し歪ませる・左右を狭める）→ テープのサーッという音を薄く足す → AAC に書き直す。
// 端末が AAC の書き出しに対応していなければ null を返し、呼び出し側は元の音をそのまま使う。
// Safari の AudioEncoder は AAC の設定（description）を正しく出さないことがある（WebKit bug 302253）ので、設定は自分で組む。

export const A = { hp: 140, lp: 6500, drive: 1.35, width: 0.55, hiss: 0.0035, hissLp: 5000, bitrate: 96000 };

const RATES = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];
function makeAsc(rate, ch) {   // AAC-LC（2）の AudioSpecificConfig（2バイト）
  const fi = RATES.indexOf(rate); if (fi < 0) return null;
  return new Uint8Array([(2 << 3) | (fi >> 1), ((fi & 1) << 7) | (ch << 3)]);
}

async function decodeAll(chunks, codec, rate, ch, desc) {   // chunks＝[{data, dur(サンプル数)}] → { sr, pcm:[Float32Array…] }
  const parts = []; let sr = 0, err = null;
  const dec = new AudioDecoder({ output: d => {
    sr = d.sampleRate; const n = d.numberOfFrames, p = [];
    for (let c = 0; c < d.numberOfChannels; c++) { const b = new Float32Array(n); d.copyTo(b, { planeIndex: c, format: 'f32-planar' }); p.push(b); }
    parts.push(p); d.close(); }, error: e => { err = e; } });
  dec.configure({ codec, sampleRate: rate, numberOfChannels: ch, description: desc });
  let t = 0; for (const s of chunks) { dec.decode(new EncodedAudioChunk({ type: 'key', timestamp: Math.round(t * 1e6 / rate), data: s.data })); t += s.dur; }
  await dec.flush(); dec.close(); if (err) throw err;
  const nc = parts.length ? parts[0].length : ch, len = parts.reduce((s, p) => s + p[0].length, 0), pcm = [];
  for (let c = 0; c < nc; c++) { const o = new Float32Array(len); let k = 0; for (const p of parts) { o.set(p[c] || p[0], k); k += p[0].length; } pcm.push(o); }
  return { sr: sr || rate, pcm };
}

async function encodeAll(pcm, sr, bitrate) {   // → [{ data, dur }]（1つ 1024 サンプル）
  const ch = pcm.length, out = []; let err = null;
  const enc = new AudioEncoder({ output: c => { const b = new Uint8Array(c.byteLength); c.copyTo(b); out.push({ data: b, dur: 1024 }); }, error: e => { err = e; } });
  enc.configure({ codec: 'mp4a.40.2', sampleRate: sr, numberOfChannels: ch, bitrate });
  const N = pcm[0].length, F = 4096;
  for (let i = 0; i < N; i += F) {
    const n = Math.min(F, N - i), buf = new Float32Array(n * ch);
    for (let c = 0; c < ch; c++) buf.set(pcm[c].subarray(i, i + n), c * n);
    const d = new AudioData({ format: 'f32-planar', sampleRate: sr, numberOfFrames: n, numberOfChannels: ch, timestamp: Math.round(i * 1e6 / sr), data: buf });
    enc.encode(d); d.close();
  }
  await enc.flush(); enc.close(); if (err) throw err;
  return out;
}

function biquad(x, sr, f, type) {   // 2次のフィルター（Q＝0.707）をその場で掛ける
  const w = 2 * Math.PI * f / sr, cs = Math.cos(w), al = Math.sin(w) / (2 * 0.7071);
  let b0, b1, b2; const a0 = 1 + al, a1 = -2 * cs, a2 = 1 - al;
  if (type === 'lp') { b0 = (1 - cs) / 2; b1 = 1 - cs; b2 = b0; } else { b0 = (1 + cs) / 2; b1 = -(1 + cs); b2 = b0; }
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) { const v = x[i], y = (b0 * v + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0; x2 = x1; x1 = v; y2 = y1; y1 = y; x[i] = y; }
}

function degrade(pcm, sr, seed) {   // 音質を落とす＋テープのサーッという音を薄く
  const ch = pcm.length;
  if (ch === 2) { const [L, R] = pcm; for (let i = 0; i < L.length; i++) { const m = (L[i] + R[i]) / 2, s = (L[i] - R[i]) / 2 * A.width; L[i] = m + s; R[i] = m - s; } }
  const k = Math.tanh(A.drive);
  let a = seed >>> 0 || 1; const rnd = () => { a ^= a << 13; a >>>= 0; a ^= a >>> 17; a ^= a << 5; a >>>= 0; return a / 4294967296 - 0.5; };
  for (const x of pcm) {
    biquad(x, sr, A.hp, 'hp'); biquad(x, sr, A.lp, 'lp'); biquad(x, sr, A.lp, 'lp');
    for (let i = 0; i < x.length; i++) x[i] = Math.tanh(x[i] * A.drive) / k;   // 少し歪ませる（大きい音だけ丸まる）
    const n = new Float32Array(x.length); for (let i = 0; i < n.length; i++) n[i] = rnd();
    biquad(n, sr, A.hissLp, 'lp');
    for (let i = 0; i < x.length; i++) x[i] = Math.max(-1, Math.min(1, x[i] + n[i] * A.hiss * 3.4));
  }
}

let delayCache = null;
async function encoderDelay(sr, ch) {   // AAC に書いて読み直したときに、音が何サンプル後ろへずれるか（端末ごとに測る）
  const key = sr + '/' + ch; if (delayCache && delayCache.key === key) return delayCache.d;
  const N = sr, at = 8192, pcm = []; for (let c = 0; c < ch; c++) { const x = new Float32Array(N); x[at] = 0.9; x[at + 1] = -0.9; pcm.push(x); }
  const enc = await encodeAll(pcm, sr, A.bitrate), back = await decodeAll(enc, 'mp4a.40.2', sr, ch, makeAsc(sr, ch));
  const y = back.pcm[0]; let best = 0, bi = at; for (let i = 0; i < y.length; i++) if (Math.abs(y[i]) > best) { best = Math.abs(y[i]); bi = i; }
  const d = bi - at; delayCache = { key, d }; return d;
}

/** audio＝video.js が作る { ts, rate, ch, asc, samples, mediaTime, emptySec, segSec }。成功すれば同じ形で返す（rate・asc・samples・mediaTime が変わる） */
export async function vhsAudio(audio, seed = 1) {
  try {
    if (typeof AudioEncoder === 'undefined' || typeof AudioDecoder === 'undefined') return null;
    const ot = audio.asc[0] >> 3, codec = `mp4a.40.${ot === 5 || ot === 29 ? ot : 2}`;
    const dIn = audio.samples.map(s => ({ data: s.data, dur: Math.round(s.dur * audio.rate / audio.ts) }));
    const { sr, pcm } = await decodeAll(dIn, codec, audio.rate, audio.ch, audio.asc);
    const ch = Math.min(2, pcm.length), asc = makeAsc(sr, ch);
    if (!asc || !(await AudioEncoder.isConfigSupported({ codec: 'mp4a.40.2', sampleRate: sr, numberOfChannels: ch, bitrate: A.bitrate })).supported) return null;
    const P = pcm.slice(0, ch); degrade(P, sr, seed);
    const samples = await encodeAll(P, sr, A.bitrate), delay = await encoderDelay(sr, ch);
    if (!samples.length || delay < 0 || delay > 8192) return null;
    return { ...audio, ts: sr, rate: sr, ch, asc, samples, mediaTime: Math.round(audio.mediaTime * sr / audio.ts) + delay };
  } catch (e) { console.warn('vhsAudio', e); return null; }
}
