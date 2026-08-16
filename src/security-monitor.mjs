import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const config = {
  port: Number(process.env.WEB_PORT || 8090),
  viewerPort: Number(process.env.VIEWER_PORT || 8092),
  mjpegFps: Number(process.env.MJPEG_FPS || 8),
  eventSeconds: Number(process.env.EVENT_RECORD_SECONDS || 30),
  wakeTimeoutSeconds: Number(process.env.EVENT_WAKE_TIMEOUT_SECONDS || 15),
  maxRecordSeconds: Number(process.env.MAX_RECORD_SECONDS || 120),
  retentionDays: Number(process.env.RETENTION_DAYS || 14),
  recordingsDir: process.env.RECORDINGS_DIR || '/recordings',
  dataDir: process.env.DATA_DIR || '/data',
};

const VIEWER = `http://127.0.0.1:${config.viewerPort}`;
const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'security.html'));
const settingsFile = path.join(config.dataDir, 'security.json');
fs.mkdirSync(config.recordingsDir, { recursive: true });
fs.mkdirSync(config.dataDir, { recursive: true });

function loadSettings() {
  try { return JSON.parse(fs.readFileSync(settingsFile, 'utf8')); } catch { return {}; }
}
const saved = loadSettings();

const state = {
  securityEnabled: Boolean(saved.securityEnabled),
  eventActive: false,
  eventStarting: false,
  monitorConnected: false,
  lastTriggerAt: 0,
  lastTriggerSource: null,
  triggerCount: 0,
  recording: false,
  recordingFile: null,
  recordingStartedAt: null,
  recordingsCount: 0,
  storageBytes: 0,
  lastError: null,
};

let eventAbort = null;
let eventStopTimer = null;
let eventStopAt = 0;
let eventPromise = null;
let eventOwnsViewer = false;
let recorder = null;
let lastJpeg = null;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function saveSettings() {
  fs.writeFileSync(settingsFile, JSON.stringify({ securityEnabled: state.securityEnabled }, null, 2));
}

async function viewerJson(route, options = {}) {
  const response = await fetch(VIEWER + route, { ...options, cache: 'no-store' });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `Viewer HTTP ${response.status}`);
  return data;
}

async function viewerStatus() {
  try { return await viewerJson('/api/status'); }
  catch (error) { return { wsConnected:false, listening:false, active:false, streamHealthy:false, lastError:error.message }; }
}

function listRecordings() {
  try {
    return fs.readdirSync(config.recordingsDir)
      .filter((name) => name.endsWith('.mp4'))
      .map((name) => {
        const full = path.join(config.recordingsDir, name);
        const stat = fs.statSync(full);
        const base = name.slice(0, -4);
        const jpg = `${base}.jpg`;
        return {
          name,
          createdAt: stat.mtime.toISOString(),
          size: stat.size,
          videoUrl: `/recordings/${encodeURIComponent(name)}`,
          thumbnailUrl: fs.existsSync(path.join(config.recordingsDir, jpg)) ? `/recordings/${encodeURIComponent(jpg)}` : null,
        };
      })
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  } catch { return []; }
}

function refreshStorage() {
  const list = listRecordings();
  state.recordingsCount = list.length;
  state.storageBytes = list.reduce((sum, item) => sum + item.size, 0);
}

function cleanupOld() {
  if (config.retentionDays <= 0) return;
  const cutoff = Date.now() - config.retentionDays * 86400000;
  for (const item of listRecordings()) {
    if (new Date(item.createdAt).getTime() >= cutoff) continue;
    const base = item.name.slice(0, -4);
    for (const ext of ['.mp4', '.jpg']) {
      try { fs.unlinkSync(path.join(config.recordingsDir, base + ext)); } catch {}
    }
  }
  refreshStorage();
}

function timestamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
}

function safeSource(source) {
  return String(source || 'sensor').toLowerCase().replace(/[^a-z0-9_-]+/g, '-').slice(0, 24) || 'sensor';
}

function startRecording(snapshot, source) {
  if (recorder || !snapshot) return;

  const base = `motion_${timestamp()}_${safeSource(source)}`;
  const mp4 = path.join(config.recordingsDir, base + '.mp4');
  const jpg = path.join(config.recordingsDir, base + '.jpg');
  try { fs.writeFileSync(jpg, snapshot); } catch {}

  const child = spawn('ffmpeg', [
    '-hide_banner', '-loglevel', 'error',
    '-f', 'image2pipe', '-framerate', String(config.mjpegFps), '-vcodec', 'mjpeg', '-i', 'pipe:0',
    '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '24', '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart', '-y', mp4,
  ], { stdio: ['pipe', 'ignore', 'pipe'] });

  recorder = {
    process: child,
    stdin: child.stdin,
    file: base + '.mp4',
    startedAt: Date.now(),
  };

  state.recording = true;
  state.recordingFile = recorder.file;
  state.recordingStartedAt = new Date().toISOString();
  console.log(`[security] Opname gestart: ${recorder.file}`);

  child.stderr.on('data', (chunk) => {
    const text = chunk.toString().trim();
    if (text) console.warn('[opname]', text);
  });

  child.on('exit', () => {
    if (recorder?.process === child) recorder = null;
    state.recording = false;
    state.recordingFile = null;
    state.recordingStartedAt = null;
    refreshStorage();
  });
}

function writeRecording(jpeg) {
  if (!recorder?.stdin || recorder.stdin.destroyed || recorder.stdin.writableNeedDrain) return;
  try { recorder.stdin.write(jpeg); } catch {}
}

function finishRecording() {
  if (!recorder) return;
  const current = recorder;
  recorder = null;
  state.recording = false;
  state.recordingFile = null;
  state.recordingStartedAt = null;
  try { current.stdin.end(); } catch {}
  setTimeout(() => {
    if (!current.process.killed) {
      try { current.process.kill('SIGTERM'); } catch {}
    }
  }, 5000).unref();
}

function parseMjpegChunk(parser, chunk, onFrame) {
  parser.pending = Buffer.concat([parser.pending, chunk]);
  while (true) {
    const start = parser.pending.indexOf(Buffer.from([0xff, 0xd8]));
    if (start < 0) {
      if (parser.pending.length > 2_000_000) parser.pending = Buffer.alloc(0);
      return;
    }
    if (start > 0) parser.pending = parser.pending.subarray(start);
    const end = parser.pending.indexOf(Buffer.from([0xff, 0xd9]), 2);
    if (end < 0) return;
    const jpeg = Buffer.from(parser.pending.subarray(0, end + 2));
    parser.pending = parser.pending.subarray(end + 2);
    onFrame(jpeg);
  }
}

async function waitForHealthy(timeoutSeconds = config.wakeTimeoutSeconds) {
  const deadline = Date.now() + Math.max(3, timeoutSeconds) * 1000;
  while (Date.now() < deadline) {
    const status = await viewerStatus();
    if (status.streamHealthy && Number(status.frames || 0) > 0) return true;
    await sleep(500);
  }
  return false;
}

async function startFreshViewer() {
  let status = await viewerStatus();
  if (!status.wsConnected || !status.listening) throw new Error('eufy-security-ws is niet gereed');

  let ownsViewer = !status.active;

  if (status.active && !status.streamHealthy) {
    console.warn('[security] Bestaande stream is ongezond; eerst volledig stoppen.');
    try { await viewerJson('/api/stop', { method:'POST' }); } catch {}
    await sleep(1200);
    status = await viewerStatus();
    ownsViewer = true;
  }

  if (!status.active) {
    await viewerJson('/api/start', { method:'POST' });
    ownsViewer = true;
  }

  if (await waitForHealthy()) return ownsViewer;

  console.warn('[security] Geen beeld na eerste start; geforceerde tweede poging.');
  try { await viewerJson('/api/stop', { method:'POST' }); } catch {}
  await sleep(1500);
  await viewerJson('/api/start', { method:'POST' });
  ownsViewer = true;

  if (!await waitForHealthy()) throw new Error('Deurbel werd niet wakker: geen decodeerbare liveframes');
  return ownsViewer;
}

function scheduleEventStop() {
  if (eventStopTimer) clearTimeout(eventStopTimer);
  if (!eventAbort) return;

  const delay = Math.max(500, eventStopAt - Date.now());
  eventStopTimer = setTimeout(() => {
    console.log('[security] Opnametijd voorbij; camera mag weer slapen.');
    try { eventAbort?.abort(); } catch {}
  }, delay);
  eventStopTimer.unref?.();
}

async function runTriggeredEvent(source) {
  state.eventActive = true;
  state.eventStarting = true;
  state.lastError = null;
  eventOwnsViewer = false;
  lastJpeg = null;

  try {
    eventOwnsViewer = await startFreshViewer();

    eventAbort = new AbortController();
    const response = await fetch(VIEWER + '/stream.mjpg?security-event=1&t=' + Date.now(), {
      signal: eventAbort.signal,
      cache: 'no-store',
    });
    if (!response.ok || !response.body) throw new Error(`MJPEG HTTP ${response.status}`);

    state.monitorConnected = true;
    state.eventStarting = false;
    const parser = { pending: Buffer.alloc(0) };
    let firstFrame = true;

    for await (const chunk of response.body) {
      parseMjpegChunk(parser, Buffer.from(chunk), (jpeg) => {
        lastJpeg = jpeg;
        if (firstFrame) {
          firstFrame = false;
          startRecording(jpeg, source);
          eventStopAt = Math.max(eventStopAt, Date.now() + config.eventSeconds * 1000);
          scheduleEventStop();
        }
        if (recorder) writeRecording(jpeg);
      });
    }
  } catch (error) {
    if (error.name !== 'AbortError') {
      state.lastError = `Beveiligingsopname mislukt: ${error.message}`;
      console.warn(state.lastError);
    }
  } finally {
    if (eventStopTimer) clearTimeout(eventStopTimer);
    eventStopTimer = null;
    eventAbort = null;
    state.monitorConnected = false;
    state.eventStarting = false;
    state.eventActive = false;

    if (recorder) finishRecording();
    await sleep(600);

    if (eventOwnsViewer) {
      try { await viewerJson('/api/stop', { method:'POST' }); } catch {}
    }

    eventOwnsViewer = false;
    eventStopAt = 0;
    eventPromise = null;
    refreshStorage();
  }
}

function triggerEvent(source = 'sensor') {
  if (!state.securityEnabled) throw new Error('Beveiliging staat uit');

  const now = Date.now();
  state.lastTriggerAt = now;
  state.lastTriggerSource = source;
  state.triggerCount++;
  state.lastError = null;
  eventStopAt = Math.max(eventStopAt, now + config.eventSeconds * 1000);

  if (eventPromise) {
    console.log(`[security] Extra trigger (${source}); opname verlengd.`);
    scheduleEventStop();
    return { started:false, extended:true };
  }

  console.log(`[security] Bewegings-trigger: ${source}`);
  eventPromise = runTriggeredEvent(source);
  return { started:true, extended:false };
}

async function setSecurity(enabled) {
  state.securityEnabled = Boolean(enabled);
  saveSettings();
  state.lastError = null;

  if (state.securityEnabled) {
    // Zuinige modus: bij inschakelen moet de camera juist slapen.
    if (!state.eventActive) {
      try { await viewerJson('/api/stop', { method:'POST' }); } catch {}
    }
    console.log('[security] Zuinige beveiliging actief: camera slaapt tot een trigger binnenkomt.');
  } else {
    try { eventAbort?.abort(); } catch {}
    if (recorder) finishRecording();
    try { await viewerJson('/api/stop', { method:'POST' }); } catch {}
    console.log('[security] Beveiliging uitgeschakeld.');
  }
}

function serveFile(req, res, filePath, type) {
  let stat;
  try { stat = fs.statSync(filePath); } catch { res.writeHead(404); res.end(); return; }

  const range = req.headers.range;
  if (range && type === 'video/mp4') {
    const match = /bytes=(\d*)-(\d*)/.exec(range);
    const start = match?.[1] ? Number(match[1]) : 0;
    const end = match?.[2] ? Math.min(Number(match[2]), stat.size - 1) : stat.size - 1;
    res.writeHead(206, {
      'Content-Type': type,
      'Content-Length': end - start + 1,
      'Content-Range': `bytes ${start}-${end}/${stat.size}`,
      'Accept-Ranges': 'bytes',
    });
    fs.createReadStream(filePath, { start, end }).pipe(res);
    return;
  }

  res.writeHead(200, {
    'Content-Type': type,
    'Content-Length': stat.size,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-store',
  });
  fs.createReadStream(filePath).pipe(res);
}

async function proxyStream(req, res) {
  try {
    const response = await fetch(VIEWER + '/stream.mjpg?browser=1&t=' + Date.now(), { cache:'no-store' });
    res.writeHead(response.status, {
      'Content-Type': response.headers.get('content-type') || 'multipart/x-mixed-replace; boundary=frame',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    for await (const chunk of response.body) {
      if (res.destroyed) break;
      if (!res.write(Buffer.from(chunk))) await new Promise((resolve) => res.once('drain', resolve));
    }
  } catch {
    if (!res.headersSent) res.writeHead(502);
  } finally {
    try { res.end(); } catch {}
  }
}

setInterval(() => {
  if (!recorder) return;
  if (Date.now() - recorder.startedAt >= config.maxRecordSeconds * 1000) {
    console.warn('[security] Maximale opnameduur bereikt.');
    try { eventAbort?.abort(); } catch {}
  }
}, 1000).unref();

setInterval(cleanupOld, 6 * 60 * 60 * 1000).unref();

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (req.method === 'GET' && url.pathname === '/') {
    res.writeHead(200, { 'Content-Type':'text/html; charset=utf-8', 'Content-Length':html.length, 'Cache-Control':'no-store' });
    res.end(html);
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/status') {
    refreshStorage();
    const viewer = await viewerStatus();
    res.writeHead(200, { 'Content-Type':'application/json', 'Cache-Control':'no-store' });
    res.end(JSON.stringify({
      ...viewer,
      security: {
        ...state,
        retentionDays: config.retentionDays,
        eventSeconds: config.eventSeconds,
        wakeTimeoutSeconds: config.wakeTimeoutSeconds,
      },
    }));
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/recordings') {
    res.writeHead(200, { 'Content-Type':'application/json', 'Cache-Control':'no-store' });
    res.end(JSON.stringify({ recordings:listRecordings() }));
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/security/on') {
    await setSecurity(true);
    res.writeHead(200, { 'Content-Type':'application/json' });
    res.end('{"ok":true}');
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/security/off') {
    await setSecurity(false);
    res.writeHead(200, { 'Content-Type':'application/json' });
    res.end('{"ok":true}');
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/trigger') {
    try {
      const source = url.searchParams.get('source') || req.headers['x-trigger-source'] || 'external';
      const result = triggerEvent(source);
      res.writeHead(202, { 'Content-Type':'application/json' });
      res.end(JSON.stringify({ ok:true, ...result, recordSeconds:config.eventSeconds }));
    } catch (error) {
      res.writeHead(409, { 'Content-Type':'application/json' });
      res.end(JSON.stringify({ ok:false, error:error.message }));
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/start') {
    try {
      const data = await viewerJson('/api/start', { method:'POST' });
      res.writeHead(200, {'Content-Type':'application/json'});
      res.end(JSON.stringify(data));
    } catch (error) {
      res.writeHead(503, {'Content-Type':'application/json'});
      res.end(JSON.stringify({ok:false,error:error.message}));
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/stop') {
    if (state.eventActive) {
      res.writeHead(409, {'Content-Type':'application/json'});
      res.end(JSON.stringify({ok:false,error:'Beveiligingsopname is bezig'}));
      return;
    }
    try {
      const data = await viewerJson('/api/stop', { method:'POST' });
      res.writeHead(200, {'Content-Type':'application/json'});
      res.end(JSON.stringify(data));
    } catch (error) {
      res.writeHead(503, {'Content-Type':'application/json'});
      res.end(JSON.stringify({ok:false,error:error.message}));
    }
    return;
  }

  if (req.method === 'DELETE' && url.pathname.startsWith('/api/recordings/')) {
    const name = decodeURIComponent(url.pathname.slice('/api/recordings/'.length));
    if (!/^motion_[A-Za-z0-9_-]+\.mp4$/.test(name)) { res.writeHead(400); res.end(); return; }
    const base = name.slice(0,-4);
    for (const ext of ['.mp4','.jpg']) {
      try { fs.unlinkSync(path.join(config.recordingsDir, base+ext)); } catch {}
    }
    refreshStorage();
    res.writeHead(200, {'Content-Type':'application/json'});
    res.end('{"ok":true}');
    return;
  }

  if (req.method === 'GET' && url.pathname === '/stream.mjpg') {
    await proxyStream(req, res);
    return;
  }

  if (req.method === 'GET' && url.pathname.startsWith('/recordings/')) {
    const name = decodeURIComponent(url.pathname.slice('/recordings/'.length));
    if (!/^motion_[A-Za-z0-9_-]+\.(mp4|jpg)$/.test(name)) { res.writeHead(400); res.end(); return; }
    serveFile(req, res, path.join(config.recordingsDir, name), name.endsWith('.mp4') ? 'video/mp4' : 'image/jpeg');
    return;
  }

  if (url.pathname === '/favicon.ico') { res.writeHead(204); res.end(); return; }
  res.writeHead(404);
  res.end('Not found');
});

refreshStorage();
cleanupOld();
server.listen(config.port, '0.0.0.0', () => {
  console.log(`Deurbel Security: http://0.0.0.0:${config.port} (viewer intern op ${config.viewerPort})`);
  console.log(`Zuinige modus: camera slaapt; trigger => ${config.eventSeconds}s opname`);
  console.log(`Trigger endpoint: POST /api/trigger?source=pir`);
  console.log(`Opnames: ${config.recordingsDir} | bewaren: ${config.retentionDays} dagen`);

  if (state.securityEnabled) {
    setTimeout(() => {
      viewerJson('/api/stop', { method:'POST' }).catch(() => {});
    }, 1500).unref();
  }
});

process.on('SIGTERM', () => {
  try { eventAbort?.abort(); } catch {}
  if (recorder) finishRecording();
  process.exit(0);
});

process.on('SIGINT', () => {
  try { eventAbort?.abort(); } catch {}
  if (recorder) finishRecording();
  process.exit(0);
});
