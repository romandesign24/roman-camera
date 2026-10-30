// 浪漫カメラ：動画を変換する（端末の中だけ）。読む→1コマずつ見た目を付ける→H.264で書き出し。音声（AAC）はそのまま写す。
// ロゴと日時のグリッチは4コマごとに崩れ方が変わり、1.2〜2秒に一度2〜3コマ大きく乱れる（look_reference_video.py と同じ）。
import { demux, mux, Reader } from './mp4.js';
import { osdLines, rng } from './look.js';

export const canConvertVideo = () => typeof VideoDecoder !== 'undefined' && typeof VideoEncoder !== 'undefined';
const sleep = ms => new Promise(r => setTimeout(r, ms));

/** 変換前に中身を見る：{ date, duration, fps, info } */
export async function probeVideo(file) {
  const m = await demux(file), v = m.video;
  if (!v) throw new Error('映像が見つかりません');
  const S = v.samples, dur = (S.dts[S.n - 1] + S.durs[S.n - 1]) / v.ts;
  return { m, date: m.creation, duration: dur, fps: S.n / dur };
}

async function pickEncoder(fps, sec) {   // 60秒を超える動画はメモリを抑えるため少し下げる
  const base = { width: 1080, height: 1920, bitrate: sec > 60 ? 9e6 : 14e6, framerate: Math.round(fps * 1000) / 1000, avc: { format: 'avc' } };
  const list = fps > 30.5 ? ['avc1.64002a', 'avc1.4d002a', 'avc1.42002a'] : ['avc1.640028', 'avc1.4d0028', 'avc1.420028'];
  for (const codec of list) { try { if ((await VideoEncoder.isConfigSupported({ ...base, codec })).supported) return { ...base, codec }; } catch (e) { /* 次へ */ } }
  throw new Error('この端末では H.264 で書き出せません');
}

function burstFrames(n, fps) {
  const r = rng(5), out = new Set(); let t = 0.6 + r() * 0.6;
  while (t * fps < n) { const s = Math.floor(t * fps), k = 2 + Math.floor(r() * 2); for (let i = 0; i < k; i++) out.add(s + i); t += 1.2 + r() * 0.8; }
  return out;
}

/** file を変換して Blob（video/mp4）を返す。probe＝probeVideo() の結果、date＝右上に出す日時 */
export async function convertVideo(file, look, overlay, { probe, date, onProgress, signal }) {
  const { m, fps, duration } = probe || await probeVideo(file), v = m.video, S = v.samples;
  const dcfg = { codec: v.codec, codedWidth: v.width, codedHeight: v.height, description: v.description };
  let ok = false; try { ok = (await VideoDecoder.isConfigSupported(dcfg)).supported; } catch (e) { /* 下で */ }
  if (!ok) throw new Error(`この動画の形式（${v.codec}）はこのブラウザでは読めません`);
  const ecfg = await pickEncoder(fps, duration);
  const pts = i => (S.cts[i] - v.mediaStart) / v.ts + v.emptySec;   // 表示時刻（秒）
  const total = S.n, kf = Math.max(1, Math.round(fps * 2)), bursts = burstFrames(total + 8, fps), lines = osdLines(date);
  const frameUs = Math.round(1e6 / fps);
  let err = null, first = null, idx = 0, avcC = null; const chunks = [];

  const encoder = new VideoEncoder({
    output: (chunk, meta) => {
      if (meta && meta.decoderConfig && meta.decoderConfig.description) { const d = meta.decoderConfig.description; avcC = new Uint8Array(d.buffer ? d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength) : d.slice(0)); }
      const data = new Uint8Array(chunk.byteLength); chunk.copyTo(data); chunks.push({ data, us: chunk.timestamp, key: chunk.type === 'key' });
    },
    error: e => { err = err || e; },
  });
  encoder.configure(ecfg);

  const decoder = new VideoDecoder({
    output: frame => {
      try {
        if (err || frame.timestamp < -1) return;
        if (first === null) first = frame.timestamp;
        const i = idx++, seed = 1000 + Math.floor(i / 4), burst = bursts.has(i);
        const ov = overlay.get(lines, burst ? seed * 7 + i : seed, burst);
        look.render(frame, frame.displayWidth, frame.displayHeight, v.rot, { seed: 77 + i, jitter: true, overlay: ov });
        const out = new VideoFrame(look.canvas, { timestamp: frame.timestamp - first, duration: frameUs });
        encoder.encode(out, { keyFrame: i % kf === 0 }); out.close();
        if (onProgress) onProgress(Math.min(1, idx / total));
      } catch (e) { err = err || e; } finally { frame.close(); }
    },
    error: e => { err = err || e; },
  });
  decoder.configure(dcfg);

  const rd = new Reader(file);
  for (let i = 0; i < S.n; i++) {
    while (!err && (decoder.decodeQueueSize > 3 || encoder.encodeQueueSize > 4)) await sleep(2);
    if (err) break;
    if (signal && signal.aborted) { err = new DOMException('中止しました', 'AbortError'); break; }
    const data = await rd.get(S.offs[i], S.sizes[i]);
    decoder.decode(new EncodedVideoChunk({ type: !S.sync || S.sync[i] ? 'key' : 'delta', timestamp: Math.round(pts(i) * 1e6), duration: Math.round(S.durs[i] / v.ts * 1e6), data }));
  }
  if (!err) { try { await decoder.flush(); await encoder.flush(); } catch (e) { err = err || e; } }
  try { decoder.close(); } catch (e) { /* 済 */ } try { encoder.close(); } catch (e) { /* 済 */ }
  if (err) throw err;
  if (!chunks.length || !avcC) throw new Error('書き出しに失敗しました（映像が出てこない）');

  // 映像：時刻は元の時間単位に戻す（23.976fps などもずれない）。B フレームがあれば ctts と編集リストで合わせる
  const ts = v.ts >= 1000 && v.ts <= 1e6 ? v.ts : 90000, toT = us => Math.round(us * ts / 1e6);
  const pt = chunks.map(c => toT(c.us)), sorted = [...pt].sort((a, b) => a - b);
  let D = 0; for (let i = 0; i < pt.length; i++) D = Math.max(D, sorted[i] - pt[i]);
  const vs = chunks.map((c, i) => ({ data: c.data, key: c.key, dts: sorted[i], cts: pt[i] + D }));
  vs.forEach((s, i) => { s.dur = i + 1 < vs.length ? vs[i + 1].dts - s.dts : toT(frameUs); });
  const vSec = (sorted[sorted.length - 1] + toT(frameUs)) / ts;

  // 音声：最初のコマ（元の時刻 T0）に合わせて頭を切り、長さは映像に合わせる
  let audio = null; const a = m.audio;
  if (a) {
    const A = a.samples, T0 = first / 1e6; let k0 = 0, mediaTime = a.mediaStart, emptySec = a.emptySec - T0;
    if (emptySec < 0) {
      const m0 = a.mediaStart + Math.round(-emptySec * a.ts); let k = 0; while (k + 1 < A.n && A.dts[k + 1] <= m0) k++;
      k0 = Math.max(0, k - 1); mediaTime = m0 - A.dts[k0]; emptySec = 0;
    }
    const samples = [];
    for (let k = k0; k < A.n; k++) {
      if ((A.dts[k] - A.dts[k0] - mediaTime) / a.ts + emptySec > vSec + 0.05) break;
      samples.push({ data: new Uint8Array(await file.slice(A.offs[k], A.offs[k] + A.sizes[k]).arrayBuffer()), dur: A.durs[k] });
    }
    if (samples.length) audio = { ts: a.ts, rate: a.rate, ch: a.ch, asc: a.asc, samples, mediaTime, emptySec, segSec: Math.max(0, vSec - emptySec) };
  }
  return mux({ video: { width: 1080, height: 1920, ts, avcC, samples: vs, shift: D }, audio });
}
