import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const cfg = {
  device: process.env.EUFY_SERIAL || '',
  station: process.env.EUFY_STATION_SERIAL || 'T8030T2324151AF5',
  ws: process.env.EUFY_WS_URL || 'ws://127.0.0.1:3000',
  status: process.env.SECURITY_STATUS_URL || 'http://127.0.0.1:8090/api/status',
  dir: process.env.RECORDINGS_DIR || '/recordings',
  minDisk: Number(process.env.STORAGE_MIN_BYTES || 2_000_000_000_000),
  tz: process.env.TZ || 'Europe/Amsterdam',
};

let ws;
let busy = false;
let lastTrigger = 0;
let queryWaiter = null;
let downloadWaiter = null;
let reconnectTimer = null;
let stopping = false;

const sleep = ms => new Promise(r => setTimeout(r, ms));

function send(command, extra = {}, messageId = `${command}-${Date.now()}`) {
  ws.send(JSON.stringify({ messageId, command, ...extra }));
}

function bufferOf(v) {
  if (!v) return null;
  if (Buffer.isBuffer(v)) return v;
  if (Array.isArray(v)) return Buffer.from(v);
  if (Array.isArray(v.data)) return Buffer.from(v.data);
  if (typeof v === 'string') {
    try { return Buffer.from(v, 'base64'); } catch {}
  }
  return null;
}

function localParts(ms) {
  const f = new Intl.DateTimeFormat('en-GB', {
    timeZone: cfg.tz, year:'numeric', month:'2-digit', day:'2-digit',
    hour:'2-digit', minute:'2-digit', second:'2-digit', hourCycle:'h23'
  });
  const o = {};
  for (const p of f.formatToParts(new Date(ms))) if (p.type !== 'literal') o[p.type] = p.value;
  return o;
}

function dateToken(ms) {
  const p = localParts(ms);
  return `${p.year}${p.month}${p.day}`;
}

function nextDateToken(token) {
  const d = new Date(Date.UTC(+token.slice(0,4), +token.slice(4,6)-1, +token.slice(6,8)+1));
  return `${d.getUTCFullYear()}${String(d.getUTCMonth()+1).padStart(2,'0')}${String(d.getUTCDate()).padStart(2,'0')}`;
}

function triggerPseudo(ms) {
  const p = localParts(ms);
  return Date.UTC(+p.year, +p.month-1, +p.day, +p.hour, +p.minute, +p.second);
}

function recordToken(r) {
  const p = String(r.storage_path || '');
  return /([0-9]{14})[.]zxvideo$/i.exec(p)?.[1] || null;
}

function tokenPseudo(t) {
  return Date.UTC(+t.slice(0,4), +t.slice(4,6)-1, +t.slice(6,8), +t.slice(8,10), +t.slice(10,12), +t.slice(12,14));
}

function tokenStamp(t) {
  return `${t.slice(0,4)}-${t.slice(4,6)}-${t.slice(6,8)}_${t.slice(8,10)}-${t.slice(10,12)}-${t.slice(12,14)}`;
}

function tokenDate(t) {
  return new Date(+t.slice(0,4), +t.slice(4,6)-1, +t.slice(6,8), +t.slice(8,10), +t.slice(10,12), +t.slice(12,14));
}

function storageOK() {
  fs.accessSync(cfg.dir, fs.constants.R_OK | fs.constants.W_OK);
  const s = fs.statfsSync(cfg.dir, { bigint:true });
  return Number(s.blocks * s.bsize) >= cfg.minDisk;
}

async function securityEnabled() {
  const r = await fetch(cfg.status, { cache:'no-store' });
  if (!r.ok) throw new Error(`dashboard HTTP ${r.status}`);
  return Boolean((await r.json())?.security?.securityEnabled);
}

function queryDay(triggerAt) {
  const startDate = dateToken(triggerAt);
  const endDate = nextDateToken(startDate);
  const id = `hb-query-${Date.now()}`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (queryWaiter?.id === id) queryWaiter = null;
      reject(new Error('database-query timeout'));
    }, 15000);
    queryWaiter = { id, resolve, reject, timer };
    send('station.database_query_by_date', {
      serialNumber: cfg.station,
      serialNumbers: [cfg.device],
      startDate,
      endDate
    }, id);
  });
}

function bestRecord(records, triggerAt) {
  const target = triggerPseudo(triggerAt);
  return (records || [])
    .filter(r => r.device_sn === cfg.device && String(r.storage_path || '').endsWith('.zxvideo'))
    .map(r => {
      const token = recordToken(r);
      return token ? { r, token, diff: tokenPseudo(token) - target } : null;
    })
    .filter(x => x && x.diff >= -45000 && x.diff <= 30000)
    .sort((a,b) => Math.abs(a.diff)-Math.abs(b.diff))[0] || null;
}

async function findRecord(triggerAt) {
  const until = Date.now() + 90000;
  let n = 0;
  while (Date.now() < until) {
    n++;
    try {
      const match = bestRecord(await queryDay(triggerAt), triggerAt);
      if (match) return match;
      console.log(`[homebase] Opname nog niet klaar (poging ${n}), over 5s opnieuw.`);
    } catch (e) {
      console.warn(`[homebase] Query ${n} mislukt: ${e.message}`);
    }
    await sleep(5000);
  }
  throw new Error('geen passende HomeBase-opname gevonden binnen 90s');
}

function endStream(s) {
  return new Promise((resolve, reject) => {
    s.once('close', resolve);
    s.once('error', reject);
    s.end();
  });
}

function downloadRecord(r, vfile, afile) {
  const video = fs.createWriteStream(vfile);
  const audio = fs.createWriteStream(afile);
  const id = `hb-download-${Date.now()}`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (downloadWaiter?.id === id) downloadWaiter = null;
      video.destroy(); audio.destroy();
      reject(new Error('download timeout'));
    }, 120000);
    downloadWaiter = {
      id, video, audio, timer, resolve, reject,
      vc:0, ac:0, vb:0, ab:0, vm:null, am:null
    };
    send('device.start_download', {
      serialNumber: cfg.device,
      path: r.storage_path,
      cipherId: Number(r.cipher_id || 0)
    }, id);
  });
}

function run(args) {
  return new Promise((resolve, reject) => {
    const p = spawn('ffmpeg', args, { stdio:['ignore','ignore','pipe'] });
    let err = '';
    p.stderr.on('data', b => { err += b.toString(); if (err.length > 12000) err = err.slice(-12000); });
    p.once('error', reject);
    p.once('exit', c => c === 0 ? resolve() : reject(new Error(err.trim() || `ffmpeg exit ${c}`)));
  });
}

async function convert(d, vfile, afile, out, jpg) {
  const codec = String(d.vm?.videoCodec || '').toUpperCase();
  const fmt = codec.includes('265') || codec.includes('HEVC') ? 'hevc' : 'h264';
  const fps = Math.max(1, Number(d.vm?.videoFPS || 15));
  const base = ['-hide_banner','-loglevel','warning','-fflags','+genpts','-r',String(fps),'-f',fmt,'-i',vfile];
  const enc = ['-c:v','libx264','-preset','veryfast','-crf','23','-pix_fmt','yuv420p'];
  let ok = false;

  if (d.ac > 0 && String(d.am?.audioCodec || '').toUpperCase().includes('AAC')) {
    try {
      await run([...base,'-f','aac','-i',afile,...enc,'-c:a','aac','-b:a','96k','-shortest','-movflags','+faststart','-y',out]);
      ok = true;
    } catch (e) {
      console.warn(`[homebase] Audio-conversie mislukt, probeer zonder audio: ${e.message}`);
    }
  }
  if (!ok) await run([...base,'-an',...enc,'-movflags','+faststart','-y',out]);
  await run(['-hide_banner','-loglevel','error','-ss','1','-i',out,'-frames:v','1','-q:v','3','-y',jpg]);
}

async function importRecord(match) {
  if (!storageOK()) throw new Error('/recordings staat niet op de verwachte grote HDD');

  const { r, token } = match;
  const base = `motion_${tokenStamp(token)}_eufy-original`;
  const out = path.join(cfg.dir, `${base}.mp4`);
  const jpg = path.join(cfg.dir, `${base}.jpg`);
  const vfile = path.join(cfg.dir, `.${base}.${r.record_id || Date.now()}.video`);
  const afile = path.join(cfg.dir, `.${base}.${r.record_id || Date.now()}.audio`);

  if (fs.existsSync(out) && fs.statSync(out).size > 0) {
    console.log(`[homebase] Bestaat al: ${path.basename(out)}`);
    return;
  }

  for (const f of [out,jpg,vfile,afile]) try { fs.unlinkSync(f); } catch {}

  try {
    console.log(`[homebase] Download: ${r.storage_path}`);
    const d = await downloadRecord(r, vfile, afile);
    if (!d.vc || !d.vb) throw new Error('download bevat geen videodata');
    console.log(`[homebase] Ontvangen: ${d.vc} videochunks / ${d.ac} audiochunks`);
    await convert(d, vfile, afile, out, jpg);
    const when = tokenDate(token);
    try { fs.utimesSync(out, when, when); } catch {}
    try { fs.utimesSync(jpg, when, when); } catch {}
    console.log(`[homebase] Opgeslagen: ${path.basename(out)} (${Math.round(fs.statSync(out).size/1024)} KB)`);
  } catch (e) {
    try { fs.unlinkSync(out); } catch {}
    try { fs.unlinkSync(jpg); } catch {}
    throw e;
  } finally {
    try { fs.unlinkSync(vfile); } catch {}
    try { fs.unlinkSync(afile); } catch {}
  }
}

async function processMotion(triggerAt, source) {
  if (busy) return;
  busy = true;
  try {
    await sleep(6000);
    if (!await securityEnabled()) {
      console.log('[homebase] Beweging gezien, maar beveiliging staat uit.');
      return;
    }
    if (!storageOK()) throw new Error('/recordings staat niet op de verwachte grote HDD');
    console.log(`[homebase] ${source}: originele opname zoeken; livestream blijft uit.`);
    const match = await findRecord(triggerAt);
    console.log(`[homebase] Record gevonden: ${match.r.record_id || '?'} (${match.token})`);
    await importRecord(match);
  } catch (e) {
    console.warn(`[homebase] Automatische originele opname mislukt: ${e.message}`);
  } finally {
    busy = false;
  }
}

function trigger(source, label) {
  const now = Date.now();
  if (now - lastTrigger < 3000) return;
  if (busy) {
    console.log(`[homebase] ${label} tijdens lopende import; samengevoegd.`);
    return;
  }
  lastTrigger = now;
  console.log(`[homebase] Eufy: ${label}`);
  void processMotion(now, source);
}

async function finishDownload() {
  const d = downloadWaiter;
  if (!d) return;
  downloadWaiter = null;
  clearTimeout(d.timer);
  try {
    await Promise.all([endStream(d.video), endStream(d.audio)]);
    d.resolve(d);
  } catch (e) {
    d.reject(e);
  }
}

function onMessage(data) {
  if (queryWaiter) {
    if (data.type === 'result' && data.messageId === queryWaiter.id && data.success === false) {
      const q = queryWaiter; queryWaiter = null; clearTimeout(q.timer);
      q.reject(new Error(data.error || data.errorCode || 'database-query geweigerd'));
    } else if (data.type === 'event' && data.event?.source === 'station' &&
               data.event.serialNumber === cfg.station && data.event.event === 'database query by date') {
      const q = queryWaiter; queryWaiter = null; clearTimeout(q.timer);
      Number(data.event.returnCode) === 0
        ? q.resolve(Array.isArray(data.event.data) ? data.event.data : [])
        : q.reject(new Error(`database returnCode ${data.event.returnCode}`));
    }
  }

  if (downloadWaiter) {
    if (data.type === 'result' && data.messageId === downloadWaiter.id && data.success === false) {
      const d = downloadWaiter; downloadWaiter = null; clearTimeout(d.timer);
      d.video.destroy(); d.audio.destroy();
      d.reject(new Error(data.error || data.errorCode || 'download geweigerd'));
    }
    const e = data.event;
    if (data.type === 'event' && e?.source === 'device' && e.serialNumber === cfg.device) {
      if (e.event === 'download started') console.log('[homebase] HomeBase-download gestart.');
      if (e.event === 'download video data') {
        const b = bufferOf(e.buffer);
        if (b?.length) { downloadWaiter.video.write(b); downloadWaiter.vc++; downloadWaiter.vb += b.length; downloadWaiter.vm ||= e.metadata; }
      }
      if (e.event === 'download audio data') {
        const b = bufferOf(e.buffer);
        if (b?.length) { downloadWaiter.audio.write(b); downloadWaiter.ac++; downloadWaiter.ab += b.length; downloadWaiter.am ||= e.metadata; }
      }
      if (e.event === 'download finished') void finishDownload();
    }
  }

  const e = data.event;
  if (data.type !== 'event' || e?.source !== 'device' || e.serialNumber !== cfg.device) return;

  if (e.state === true && ['motion detected','person detected','stranger person detected'].includes(e.event)) {
    trigger(e.event.includes('person') ? 'eufy-person' : 'eufy-motion', e.event);
    return;
  }
  if (e.event === 'property changed' && (e.name === 'motionDetected' || e.name === 'personDetected') &&
      (e.value === true || e.value === 1 || e.value === '1' || e.value === 'true')) {
    trigger(e.name === 'personDetected' ? 'eufy-person' : 'eufy-motion', `${e.name}=true`);
  }
}

function connect() {
  if (!cfg.device || !cfg.station) {
    console.error('[homebase] EUFY_SERIAL of EUFY_STATION_SERIAL ontbreekt.');
    return;
  }
  ws = new WebSocket(cfg.ws);
  ws.addEventListener('open', () => {
    console.log(`[homebase] Verbonden. Deurbel ${cfg.device} via HomeBase ${cfg.station}.`);
    send('set_api_schema', { schemaVersion:21 }, 'hb-schema');
    send('start_listening', {}, 'hb-listen');
  });
  ws.addEventListener('message', m => {
    try { onMessage(JSON.parse(typeof m.data === 'string' ? m.data : m.data.toString())); } catch {}
  });
  ws.addEventListener('close', () => {
    if (stopping) return;
    console.warn('[homebase] WebSocket verbroken; over 3s opnieuw verbinden.');
    ws = null;
    reconnectTimer = setTimeout(connect, 3000);
  });
  ws.addEventListener('error', () => {
    if (!stopping) console.warn('[homebase] WebSocket-fout.');
  });
}

function shutdown() {
  stopping = true;
  if (reconnectTimer) clearTimeout(reconnectTimer);
  try { ws?.close(); } catch {}
  process.exit(0);
}

console.log('[homebase] Automatisch: Eufy beweging -> originele HomeBase-opname -> H264 MP4 + thumbnail.');
console.log('[homebase] Automatische beweging start GEEN livestream.');
connect();
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
