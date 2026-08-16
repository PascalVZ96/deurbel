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
  motionFps: Number(process.env.MOTION_FPS || 2),
  motionPixelThreshold: Number(process.env.MOTION_PIXEL_THRESHOLD || 24),
  motionThresholdPercent: Number(process.env.MOTION_THRESHOLD_PERCENT || 1.5),
  motionMinHits: Number(process.env.MOTION_MIN_HITS || 2),
  warmupSeconds: Number(process.env.MOTION_WARMUP_SECONDS || 3),
  preSeconds: Number(process.env.PRE_RECORD_SECONDS || 5),
  postSeconds: Number(process.env.POST_RECORD_SECONDS || 15),
  maxRecordSeconds: Number(process.env.MAX_RECORD_SECONDS || 300),
  retentionDays: Number(process.env.RETENTION_DAYS || 14),
  recordingsDir: process.env.RECORDINGS_DIR || '/recordings',
  dataDir: process.env.DATA_DIR || '/data',
};

const VIEWER = `http://127.0.0.1:${config.viewerPort}`;
const MOTION_W = 96;
const MOTION_H = 138;
const MOTION_SIZE = MOTION_W * MOTION_H;
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
  monitorConnected: false,
  motionActive: false,
  motionScore: 0,
  motionHits: 0,
  lastMotionAt: 0,
  recording: false,
  recordingFile: null,
  recordingStartedAt: null,
  recordingsCount: 0,
  storageBytes: 0,
  lastError: null,
};

let monitorAbort = null;
let monitorLoopRunning = false;
let detector = null;
let detectorPending = Buffer.alloc(0);
let previousMotion = null;
let detectorHits = 0;
let securityStartedAt = 0;
let preBuffer = [];
let recorder = null;

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

function startDetector() {
  if (detector && !detector.killed) return;
  detectorPending = Buffer.alloc(0);
  previousMotion = null;
  detectorHits = 0;

  detector = spawn('ffmpeg', [
    '-hide_banner', '-loglevel', 'error',
    '-f', 'image2pipe', '-framerate', String(config.mjpegFps), '-vcodec', 'mjpeg', '-i', 'pipe:0',
    '-vf', `fps=${config.motionFps},scale=${MOTION_W}:${MOTION_H},format=gray`,
    '-f', 'rawvideo', '-pix_fmt', 'gray', 'pipe:1',
  ], { stdio: ['pipe', 'pipe', 'pipe'] });

  detector.stdout.on('data', parseMotion);
  detector.stderr.on('data', (chunk) => {
    const text = chunk.toString().trim();
    if (text) console.warn('[detectie]', text);
  });
  detector.on('exit', () => { detector = null; });
}

function stopDetector() {
  const current = detector;
  detector = null;
  previousMotion = null;
  detectorPending = Buffer.alloc(0);
  detectorHits = 0;
  try { current?.stdin?.end(); } catch {}
  if (current && !current.killed) setTimeout(() => { try { current.kill('SIGKILL'); } catch {} }, 1000).unref();
}

function feedDetector(jpeg) {
  if (!state.securityEnabled) return;
  startDetector();
  if (!detector?.stdin || detector.stdin.destroyed || detector.stdin.writableNeedDrain) return;
  try { detector.stdin.write(jpeg); } catch {}
}

function parseMotion(chunk) {
  detectorPending = Buffer.concat([detectorPending, chunk]);
  while (detectorPending.length >= MOTION_SIZE) {
    const frame = detectorPending.subarray(0, MOTION_SIZE);
    detectorPending = detectorPending.subarray(MOTION_SIZE);

    if (!state.securityEnabled || Date.now() - securityStartedAt < config.warmupSeconds * 1000) {
      previousMotion = Buffer.from(frame);
      continue;
    }
    if (!previousMotion) { previousMotion = Buffer.from(frame); continue; }

    let changed = 0;
    let checked = 0;
    const ignoreTop = Math.floor(MOTION_H * 0.05);
    for (let y = ignoreTop; y < MOTION_H; y++) {
      const row = y * MOTION_W;
      for (let x = 0; x < MOTION_W; x++) {
        const i = row + x;
        checked++;
        if (Math.abs(frame[i] - previousMotion[i]) >= config.motionPixelThreshold) changed++;
      }
    }
    previousMotion = Buffer.from(frame);
    const score = checked ? changed / checked * 100 : 0;
    state.motionScore = Number(score.toFixed(2));

    if (score >= config.motionThresholdPercent) detectorHits++;
    else detectorHits = 0;
    state.motionHits = detectorHits;

    if (detectorHits >= config.motionMinHits) {
      detectorHits = 0;
      state.motionHits = 0;
      motionDetected(score);
    }
  }
}

function addPreFrame(jpeg) {
  const now = Date.now();
  preBuffer.push({ time: now, jpeg: Buffer.from(jpeg) });
  const cutoff = now - config.preSeconds * 1000;
  while (preBuffer.length && preBuffer[0].time < cutoff) preBuffer.shift();
}

function timestamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
}

function startRecording(score, snapshot) {
  if (recorder || !snapshot) return;
  const base = `motion_${timestamp()}`;
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
    stopAfter: Date.now() + config.postSeconds * 1000,
  };
  state.recording = true;
  state.recordingFile = recorder.file;
  state.recordingStartedAt = new Date().toISOString();
  console.log(`Beweging ${score.toFixed(2)}% -> opname ${recorder.file}`);

  child.stderr.on('data', (chunk) => { const t = chunk.toString().trim(); if (t) console.warn('[opname]', t); });
  child.on('exit', () => {
    if (recorder?.process === child) recorder = null;
    state.recording = false;
    state.recordingFile = null;
    state.recordingStartedAt = null;
    refreshStorage();
  });

  for (const frame of preBuffer) writeRecording(frame.jpeg);
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
  setTimeout(() => { if (!current.process.killed) { try { current.process.kill('SIGTERM'); } catch {} } }, 5000).unref();
}

let lastJpeg = null;
function motionDetected(score) {
  state.motionActive = true;
  state.lastMotionAt = Date.now();
  if (!recorder) startRecording(score, lastJpeg);
  if (recorder) recorder.stopAfter = Date.now() + config.postSeconds * 1000;
}

function parseMjpegChunk(parser, chunk) {
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
    lastJpeg = jpeg;
    addPreFrame(jpeg);
    feedDetector(jpeg);
    if (recorder) writeRecording(jpeg);
  }
}

async function ensureViewerStarted() {
  const status = await viewerStatus();
  if (!status.wsConnected || !status.listening) return false;
  if (!status.active) {
    await viewerJson('/api/start', { method:'POST' });
    await sleep(1000);
  }
  return true;
}

async function monitorLoop() {
  if (monitorLoopRunning) return;
  monitorLoopRunning = true;

  while (state.securityEnabled) {
    try {
      const ready = await ensureViewerStarted();
      if (!ready) { await sleep(2000); continue; }

      monitorAbort = new AbortController();
      const response = await fetch(VIEWER + '/stream.mjpg?security=1&t=' + Date.now(), { signal: monitorAbort.signal, cache:'no-store' });
      if (!response.ok || !response.body) throw new Error(`MJPEG HTTP ${response.status}`);
      state.monitorConnected = true;
      state.lastError = null;
      securityStartedAt = Date.now();
      startDetector();
      const parser = { pending: Buffer.alloc(0) };

      for await (const chunk of response.body) {
        if (!state.securityEnabled) break;
        parseMjpegChunk(parser, Buffer.from(chunk));
      }
    } catch (error) {
      if (state.securityEnabled && error.name !== 'AbortError') {
        state.lastError = `Bewakingsstream opnieuw verbinden: ${error.message}`;
        console.warn(state.lastError);
      }
    } finally {
      state.monitorConnected = false;
      monitorAbort = null;
    }
    if (state.securityEnabled) await sleep(1200);
  }

  stopDetector();
  monitorLoopRunning = false;
}

async function setSecurity(enabled) {
  state.securityEnabled = Boolean(enabled);
  saveSettings();
  state.motionActive = false;
  state.motionScore = 0;
  state.lastError = null;

  if (state.securityEnabled) {
    securityStartedAt = Date.now();
    monitorLoop();
  } else {
    try { monitorAbort?.abort(); } catch {}
    stopDetector();
    if (recorder) finishRecording();
    try { await viewerJson('/api/stop', { method:'POST' }); } catch {}
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
    res.writeHead(206, { 'Content-Type':type, 'Content-Length':end-start+1, 'Content-Range':`bytes ${start}-${end}/${stat.size}`, 'Accept-Ranges':'bytes' });
    fs.createReadStream(filePath, { start, end }).pipe(res);
    return;
  }
  res.writeHead(200, { 'Content-Type':type, 'Content-Length':stat.size, 'Accept-Ranges':'bytes', 'Cache-Control':'no-store' });
  fs.createReadStream(filePath).pipe(res);
}

async function proxyStream(req, res) {
  try {
    const response = await fetch(VIEWER + '/stream.mjpg?browser=1&t=' + Date.now(), { cache:'no-store' });
    res.writeHead(response.status, {
      'Content-Type': response.headers.get('content-type') || 'multipart/x-mixed-replace; boundary=frame',
      'Cache-Control':'no-store, no-cache, must-revalidate',
      'Connection':'keep-alive',
      'X-Accel-Buffering':'no',
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
  const now = Date.now();
  if (state.motionActive && now - state.lastMotionAt > 2500) state.motionActive = false;
  if (recorder) {
    const maxed = now - recorder.startedAt >= config.maxRecordSeconds * 1000;
    if (now >= recorder.stopAfter || maxed) finishRecording();
  }
}, 500).unref();

setInterval(async () => {
  if (!state.securityEnabled) return;
  const status = await viewerStatus();
  if (!status.active && status.wsConnected && status.listening) {
    try { await viewerJson('/api/start', { method:'POST' }); } catch {}
  }
}, 5000).unref();
setInterval(cleanupOld, 6 * 60 * 60 * 1000).unref();

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (req.method === 'GET' && url.pathname === '/') {
    res.writeHead(200, { 'Content-Type':'text/html; charset=utf-8', 'Content-Length':html.length, 'Cache-Control':'no-store' });
    res.end(html); return;
  }

  if (req.method === 'GET' && url.pathname === '/api/status') {
    refreshStorage();
    const viewer = await viewerStatus();
    res.writeHead(200, { 'Content-Type':'application/json', 'Cache-Control':'no-store' });
    res.end(JSON.stringify({ ...viewer, security:{ ...state, retentionDays:config.retentionDays, threshold:config.motionThresholdPercent, preSeconds:config.preSeconds, postSeconds:config.postSeconds } }));
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/recordings') {
    res.writeHead(200, { 'Content-Type':'application/json', 'Cache-Control':'no-store' });
    res.end(JSON.stringify({ recordings:listRecordings() })); return;
  }

  if (req.method === 'POST' && url.pathname === '/api/security/on') {
    await setSecurity(true); res.writeHead(200, { 'Content-Type':'application/json' }); res.end('{"ok":true}'); return;
  }
  if (req.method === 'POST' && url.pathname === '/api/security/off') {
    await setSecurity(false); res.writeHead(200, { 'Content-Type':'application/json' }); res.end('{"ok":true}'); return;
  }
  if (req.method === 'POST' && url.pathname === '/api/start') {
    try { const data = await viewerJson('/api/start', { method:'POST' }); res.writeHead(200, {'Content-Type':'application/json'}); res.end(JSON.stringify(data)); }
    catch (error) { res.writeHead(503, {'Content-Type':'application/json'}); res.end(JSON.stringify({ok:false,error:error.message})); }
    return;
  }
  if (req.method === 'POST' && url.pathname === '/api/stop') {
    if (state.securityEnabled) { res.writeHead(409, {'Content-Type':'application/json'}); res.end(JSON.stringify({ok:false,error:'Schakel eerst beveiliging uit'})); return; }
    try { const data = await viewerJson('/api/stop', { method:'POST' }); res.writeHead(200, {'Content-Type':'application/json'}); res.end(JSON.stringify(data)); }
    catch (error) { res.writeHead(503, {'Content-Type':'application/json'}); res.end(JSON.stringify({ok:false,error:error.message})); }
    return;
  }

  if (req.method === 'DELETE' && url.pathname.startsWith('/api/recordings/')) {
    const name = decodeURIComponent(url.pathname.slice('/api/recordings/'.length));
    if (!/^motion_[A-Za-z0-9_-]+\.mp4$/.test(name)) { res.writeHead(400); res.end(); return; }
    const base = name.slice(0,-4);
    for (const ext of ['.mp4','.jpg']) { try { fs.unlinkSync(path.join(config.recordingsDir, base+ext)); } catch {} }
    refreshStorage(); res.writeHead(200, {'Content-Type':'application/json'}); res.end('{"ok":true}'); return;
  }

  if (req.method === 'GET' && url.pathname === '/stream.mjpg') { await proxyStream(req, res); return; }

  if (req.method === 'GET' && url.pathname.startsWith('/recordings/')) {
    const name = decodeURIComponent(url.pathname.slice('/recordings/'.length));
    if (!/^motion_[A-Za-z0-9_-]+\.(mp4|jpg)$/.test(name)) { res.writeHead(400); res.end(); return; }
    serveFile(req, res, path.join(config.recordingsDir, name), name.endsWith('.mp4') ? 'video/mp4' : 'image/jpeg'); return;
  }

  if (url.pathname === '/favicon.ico') { res.writeHead(204); res.end(); return; }
  res.writeHead(404); res.end('Not found');
});

refreshStorage(); cleanupOld();
server.listen(config.port, '0.0.0.0', () => {
  console.log(`Deurbel Security: http://0.0.0.0:${config.port} (viewer intern op ${config.viewerPort})`);
  console.log(`Detectie: ${config.motionThresholdPercent}% | ${config.preSeconds}s voor + ${config.postSeconds}s na beweging`);
  console.log(`Opnames: ${config.recordingsDir} | bewaren: ${config.retentionDays} dagen`);
  if (state.securityEnabled) monitorLoop();
});

process.on('SIGTERM', () => { try { monitorAbort?.abort(); } catch {}; stopDetector(); if (recorder) finishRecording(); process.exit(0); });
process.on('SIGINT', () => { try { monitorAbort?.abort(); } catch {}; stopDetector(); if (recorder) finishRecording(); process.exit(0); });
