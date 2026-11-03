// 浪漫カメラ：画面の動き。写真は選んだらすぐ変換、動画は選んだら変換を始める（日時を直したら作り直す）。
import { Look, Overlay, osdLines } from './look.js';
import { photoDate } from './exif.js';
import { probeVideo, convertVideo, canConvertVideo } from './video.js';
import { loadSegmenter } from './game3d.js';

export const VERSION = 'v13 (2026-11-03)';
const MAX_SEC = 180;
const $ = id => document.getElementById(id);
const ui = { file: $('file'), work: $('work'), img: $('outImg'), vid: $('outVid'), busy: $('busy'), busyText: $('busyText'), busySub: $('busySub'),
             bar: $('barFill'), dt: $('dt'), save: $('save'), reroll: $('reroll'), msg: $('msg') };
$('ver').textContent = VERSION;

let look = null, overlay = null;
const st = { kind: null, file: null, img: null, probe: null, date: null, seed: 0, blob: null, url: null, abort: null, job: 0,
             mode: ['vhs', 'dot', 'game'].includes(localStorage.getItem('roman-mode')) ? localStorage.getItem('roman-mode') : 'vhs' };
const modeButtons = [...document.querySelectorAll('#modes button')], sceneButtons = [...document.querySelectorAll('#scenes button')];
st.scene = ['park', 'night', 'snow', 'beach', 'wa'].includes(localStorage.getItem('roman-scene')) ? localStorage.getItem('roman-scene') : 'park';
const showMode = () => { modeButtons.forEach(b => b.classList.toggle('on', b.dataset.mode === st.mode)); $('scenes').hidden = st.mode !== 'game'; sceneButtons.forEach(b => b.classList.toggle('on', b.dataset.scene === st.scene)); ui.reroll.hidden = !(st.kind === 'photo' && st.img && st.mode === 'vhs'); };
showMode();

async function engine() {
  if (look) return;
  look = new Look();
  const logo = new Image(); logo.src = 'logo_white.png'; const vlogo = new Image(); vlogo.src = 'logo_vhs.png';
  await Promise.all([logo.decode(), vlogo.decode()]);
  overlay = new Overlay(logo, vlogo);
}

const pad = n => String(n).padStart(2, '0');
const toLocalInput = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
const fromLocalInput = s => { const m = s.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/); return m ? new Date(+m[1], m[2] - 1, +m[3], +m[4], +m[5]) : null; };
const stamp = d => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
const isVideo = f => /^video\//.test(f.type) || /\.(mov|mp4|m4v)$/i.test(f.name);

function say(text) { ui.msg.textContent = text || ''; }
function busy(on, text, sub) {
  ui.busy.hidden = !on; if (text) ui.busyText.textContent = text; if (sub !== undefined) ui.busySub.textContent = sub; if (!on) ui.bar.style.width = '0';
}
function setResult(blob, kind) {
  if (st.url) URL.revokeObjectURL(st.url);
  st.blob = blob; st.url = URL.createObjectURL(blob);
  ui.img.hidden = kind !== 'photo'; ui.vid.hidden = kind !== 'video';
  if (kind === 'photo') ui.img.src = st.url; else { ui.vid.src = st.url; ui.vid.load(); }
  ui.save.disabled = false;
}
function clearResult() {
  ui.save.disabled = true; ui.img.hidden = true; ui.vid.hidden = true; ui.vid.removeAttribute('src'); ui.vid.load();
  if (st.url) URL.revokeObjectURL(st.url); st.url = null; st.blob = null;
}

ui.file.addEventListener('change', async () => {
  const f = ui.file.files && ui.file.files[0]; ui.file.value = '';
  if (!f) return;
  if (st.abort) st.abort.abort();
  const job = ++st.job; say(''); clearResult(); ui.work.hidden = false; ui.reroll.hidden = true;
  document.body.classList.add('has'); document.querySelector('.pick').firstChild.textContent = 'べつの写真・動画をえらぶ';
  Object.assign(st, { file: f, img: null, probe: null, kind: isVideo(f) ? 'video' : 'photo' });
  try {
    busy(true, '読み込み中…', '');
    await engine();
    if (st.kind === 'photo') {
      st.date = (await photoDate(f)) || new Date(f.lastModified || Date.now());
      const img = new Image(); const u = URL.createObjectURL(f); img.src = u;
      try { await img.decode(); } catch (e) { throw new Error('この写真は読めませんでした'); } finally { setTimeout(() => URL.revokeObjectURL(u), 1000); }
      if (job !== st.job) return;
      st.img = img; st.seed = (Math.random() * 1e9) >>> 0; ui.dt.value = toLocalInput(st.date); showMode();
      await renderPhoto(job);
    } else {
      if (!canConvertVideo()) throw new Error('このブラウザでは動画を変換できません。iOS を最新にしてからお試しください。');
      st.probe = await probeVideo(f);
      if (st.probe.duration > MAX_SEC) throw new Error(`動画が長すぎます（${Math.round(st.probe.duration)}秒）。${MAX_SEC / 60}分以内にしてください。`);
      st.date = st.probe.date || new Date(f.lastModified || Date.now()); ui.dt.value = toLocalInput(st.date);
      await runVideo(job);
    }
  } catch (e) { if (job === st.job) { busy(false); say(e.message || String(e)); } }
});

async function segOrNull() {   // ゲーム：人の切り抜き（初回は読み込みに数秒）。使えなければ写真を看板にする
  try { busy(true, '人を探す準備中…', '初回だけ少し時間がかかります'); return await loadSegmenter(); } catch (e) { console.warn('seg', e); return null; }
}

async function renderPhoto(job) {
  busy(true, '変換中…', '');
  await new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));   // 「変換中」を先に描かせる
  const img = st.img;
  const ov = st.mode === 'dot' ? overlay.dotCard(st.date) : st.mode === 'game' ? overlay.gameLayer(st.date) : overlay.get(osdLines(st.date), st.seed % 100000);
  const seg = st.mode === 'game' ? await segOrNull() : null;
  look.render(img, img.naturalWidth, img.naturalHeight, 0, { mode: st.mode, seed: st.seed, jitter: false, overlay: ov, dot: {}, seg, t: 0, scene: st.scene });
  const blob = await new Promise((res, rej) => look.canvas.toBlob(b => b ? res(b) : rej(new Error('画像を書き出せませんでした')), 'image/jpeg', 0.92));
  if (job !== st.job) return;
  setResult(blob, 'photo'); busy(false);
}

async function runVideo(job) {
  const ac = new AbortController(); st.abort = ac; let lock = null;
  try { lock = navigator.wakeLock ? await navigator.wakeLock.request('screen') : null; } catch (e) { /* 使えなくても続ける */ }
  const t0 = performance.now(); busy(true, '変換中 0%', '画面を閉じずにお待ちください');
  try {
    const seg = st.mode === 'game' ? await segOrNull() : null; busy(true, '変換中 0%', '画面を閉じずにお待ちください');
    const blob = await convertVideo(st.file, look, overlay, { probe: st.probe, date: st.date, mode: st.mode, seg, scene: st.scene, signal: ac.signal,
      onProgress: p => {
        if (job !== st.job) return; ui.bar.style.width = (p * 100).toFixed(1) + '%'; ui.busyText.textContent = `変換中 ${Math.round(p * 100)}%`;
        const left = p > 0.05 ? (performance.now() - t0) / p * (1 - p) / 1000 : null;
        ui.busySub.textContent = left === null ? '画面を閉じずにお待ちください' : `あと約${Math.max(1, Math.round(left))}秒・画面を閉じずにお待ちください`;
      } });
    if (job !== st.job) return;
    setResult(blob, 'video'); busy(false);
  } catch (e) {
    if (e.name === 'AbortError' || job !== st.job) return;
    throw new Error('動画の変換に失敗しました：' + (e.message || e));
  } finally { if (lock) lock.release().catch(() => {}); if (st.abort === ac) st.abort = null; }
}

ui.dt.addEventListener('change', async () => {
  const d = fromLocalInput(ui.dt.value); if (!d || !st.file) return;
  st.date = d; if (st.abort) st.abort.abort();
  const job = ++st.job; say('');
  try { if (st.kind === 'photo' && st.img) await renderPhoto(job); else if (st.kind === 'video' && st.probe) { clearResult(); await runVideo(job); } }
  catch (e) { if (job === st.job) { busy(false); say(e.message || String(e)); } }
});

const rerun = async () => {
  if (!st.file) return;
  if (st.abort) st.abort.abort();
  const job = ++st.job; say('');
  try { if (st.kind === 'photo' && st.img) await renderPhoto(job); else if (st.kind === 'video' && st.probe) { clearResult(); await runVideo(job); } }
  catch (e) { if (job === st.job) { busy(false); say(e.message || String(e)); } }
};
sceneButtons.forEach(b => b.addEventListener('click', () => { if (b.dataset.scene === st.scene) return; st.scene = b.dataset.scene; localStorage.setItem('roman-scene', st.scene); showMode(); rerun(); }));   // ゲームの背景
modeButtons.forEach(b => b.addEventListener('click', async () => {   // 見た目の切り替え（選んだものは次回も使う）
  if (b.dataset.mode === st.mode) return;
  st.mode = b.dataset.mode; localStorage.setItem('roman-mode', st.mode); showMode();
  if (!st.file) return;
  if (st.abort) st.abort.abort();
  const job = ++st.job; say('');
  try { if (st.kind === 'photo' && st.img) await renderPhoto(job); else if (st.kind === 'video' && st.probe) { clearResult(); await runVideo(job); } }
  catch (e) { if (job === st.job) { busy(false); say(e.message || String(e)); } }
}));

ui.reroll.addEventListener('click', async () => {
  if (st.kind !== 'photo' || !st.img) return;
  st.seed = (Math.random() * 1e9) >>> 0; const job = ++st.job;
  try { await renderPhoto(job); } catch (e) { busy(false); say(e.message || String(e)); }
});

ui.save.addEventListener('click', async () => {
  if (!st.blob) return;
  const name = `roman_${st.mode}_${stamp(st.date || new Date())}.${st.kind === 'video' ? 'mp4' : 'jpg'}`;
  const file = new File([st.blob], name, { type: st.blob.type });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file] }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  const a = document.createElement('a'); a.href = st.url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
});

// ホーム画面に追加したとき電波がなくても開けるように（試験中の localhost では使わない）
if ('serviceWorker' in navigator && (!/^(localhost|127\.0\.0\.1)$/.test(location.hostname) || /[?&]sw=1/.test(location.search))) {
  const had = !!navigator.serviceWorker.controller;   // 新しい版が入ったら、まだ何も選んでいなければ開き直して新しい版にする
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (had && !st.file) location.reload(); });
  navigator.serviceWorker.register('sw.js').catch(e => console.warn('sw', e));
}
