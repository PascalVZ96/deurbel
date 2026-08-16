import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const config = {
  serial: process.env.EUFY_SERIAL || '',
  wsUrl: process.env.EUFY_WS_URL || 'ws://127.0.0.1:3000',
  port: Number(process.env.WEB_PORT || 8090),
  autoStopSeconds: Number(process.env.AUTO_STOP_SECONDS || 120),
  mjpegFps: Number(process.env.MJPEG_FPS || 8),
  mjpegQuality: Number(process.env.MJPEG_QUALITY || 5),
};

const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'));

const state = {
  wsConnected: false,
  listening: false,
  active: false,
  eufyRunning: false,
  ffmpegRunning: false,
  codec: null,
  width: null,
  height: null,
  fps: null,
  inputBytes: 0,
  layer0Bytes: 0,
  totalNals: 0,
  keptNals: 0,
  frames: 0,
  clients: 0,
  lastError: null,
  lastFfmpeg: null,
  startedAt: null,
};

let ws = null;
let reconnectTimer = null;
let autoStopTimer = null;
let ffmpeg = null;
let ffmpegStdin = null;
let pending = Buffer.alloc(0);
let jpegPending = Buffer.alloc(0);
const mjpegClients = new Set();

function json(res, status, body) {
  const payload = Buffer.from(JSON.stringify(body));
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': payload.length,
    'Cache-Control': 'no-store',
  });
  res.end(payload);
}

function publicState() {
  return {
    ...state,
    serialConfigured: Boolean(config.serial),
    autoStopSeconds: config.autoStopSeconds,
  };
}

function setError(message) {
  state.lastError = String(message || 'Onbekende fout');
  console.error(state.lastError);
}

function clearCounters() {
  state.codec = null;
  state.width = null;
  state.height = null;
  state.fps = null;
  state.inputBytes = 0;
  state.layer0Bytes = 0;
  state.totalNals = 0;
  state.keptNals = 0;
  state.frames = 0;
  state.lastFfmpeg = null;
  pending = Buffer.alloc(0);
  jpegPending = Buffer.alloc(0);
}

function send(command, data = {}, messageId = `${command}-${Date.now()}`) {
  if (!ws || ws.readyState !== 1) {
    throw new Error('Geen verbinding met eufy-security-ws');
  }

  ws.send(JSON.stringify({ messageId, command, ...data }));
}

function connectEufy() {
  if (ws && (ws.readyState === 0 || ws.readyState === 1)) return;

  console.log(`Verbinden met ${config.wsUrl} ...`);
  ws = new WebSocket(config.wsUrl);

  ws.addEventListener('open', () => {
    console.log('Verbonden met eufy-security-ws');
    state.wsConnected = true;
    state.listening = false;
    state.lastError = null;

    try {
      send('set_api_schema', { schemaVersion: 21 }, 'viewer-schema');
      send('start_listening', {}, 'viewer-start-listening');
    } catch (error) {
      setError(error.message);
    }
  });

  ws.addEventListener('message', (message) => {
    let data;

    try {
      const raw = typeof message.data === 'string' ? message.data : message.data.toString();
      data = JSON.parse(raw);
    } catch {
      return;
    }

    handleEufyMessage(data);
  });

  ws.addEventListener('close', () => {
    console.warn('Verbinding met eufy-security-ws verbroken');
    state.wsConnected = false;
    state.listening = false;
    ws = null;

    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connectEufy, 3000);
  });

  ws.addEventListener('error', () => {
    setError('WebSocket-fout met eufy-security-ws');
  });
}

function getBuffer(value) {
  if (!value) return null;

  if (value.type === 'Buffer' && Array.isArray(value.data)) {
    return Buffer.from(value.data);
  }

  if (Array.isArray(value)) {
    return Buffer.from(value);
  }

  if (typeof value === 'string') {
    return Buffer.from(value, 'base64');
  }

  return null;
}

function handleEufyMessage(msg) {
  if (msg.type === 'result') {
    if (msg.messageId === 'viewer-start-listening' && msg.success !== false) {
      state.listening = true;
      console.log('Eufy events worden ontvangen');
      return;
    }

    if (msg.success === false) {
      const code = msg.errorCode || 'onbekende_fout';

      // Deze fout betekent meestal dat een vorige sessie nog als actief gemarkeerd staat.
      // We blijven dan luisteren naar videodata in plaats van de viewer direct af te breken.
      if (code === 'device_livestream_already_running') {
        console.warn('Eufy meldt dat de livestream al draait; viewer blijft luisteren.');
        state.eufyRunning = true;
        return;
      }

      if (code === 'device_livestream_not_running' && !state.active) {
        return;
      }

      setError(`Eufy: ${code}`);
    }

    return;
  }

  if (msg.type !== 'event' || !msg.event) return;

  const event = msg.event;

  if (event.source !== 'device' || event.serialNumber !== config.serial) return;

  if (event.event === 'livestream started') {
    console.log('Eufy livestream gestart');
    state.eufyRunning = true;
    return;
  }

  if (event.event === 'livestream stopped') {
    console.log('Eufy livestream gestopt');
    state.eufyRunning = false;
    return;
  }

  if (event.event === 'livestream video data') {
    const buffer = getBuffer(event.buffer);
    if (!buffer?.length || !state.active) return;

    const metadata = event.metadata || {};
    state.codec = metadata.videoCodec || state.codec;
    state.width = metadata.videoWidth || state.width;
    state.height = metadata.videoHeight || state.height;
    state.fps = metadata.videoFPS || state.fps;
    state.inputBytes += buffer.length;

    processVideoChunk(buffer);
  }
}

function findStartCodes(buf) {
  const result = [];
  let i = 0;

  while (i <= buf.length - 3) {
    if (
      i <= buf.length - 4 &&
      buf[i] === 0x00 &&
      buf[i + 1] === 0x00 &&
      buf[i + 2] === 0x00 &&
      buf[i + 3] === 0x01
    ) {
      result.push({ pos: i, len: 4 });
      i += 4;
      continue;
    }

    if (
      buf[i] === 0x00 &&
      buf[i + 1] === 0x00 &&
      buf[i + 2] === 0x01
    ) {
      result.push({ pos: i, len: 3 });
      i += 3;
      continue;
    }

    i++;
  }

  return result;
}

function getLayerId(nal, startCodeLength) {
  const header = startCodeLength;
  if (header + 2 > nal.length) return null;

  const b0 = nal[header];
  const b1 = nal[header + 1];
  return ((b0 & 0x01) << 5) | ((b1 >> 3) & 0x1f);
}

function processVideoChunk(chunk) {
  pending = Buffer.concat([pending, chunk]);

  // Bescherming tegen een beschadigde stream zonder Annex-B startcodes.
  if (pending.length > 16 * 1024 * 1024) {
    pending = pending.subarray(-1024 * 1024);
  }

  let starts = findStartCodes(pending);
  if (starts.length < 2) return;

  // Gooi eventuele bytes vóór de eerste echte startcode weg.
  if (starts[0].pos > 0) {
    pending = pending.subarray(starts[0].pos);
    starts = findStartCodes(pending);
    if (starts.length < 2) return;
  }

  for (let i = 0; i < starts.length - 1; i++) {
    const startInfo = starts[i];
    const start = startInfo.pos;
    const end = starts[i + 1].pos;
    const nal = pending.subarray(start, end);

    state.totalNals++;

    if (getLayerId(nal, startInfo.len) === 0) {
      state.keptNals++;
      state.layer0Bytes += nal.length;

      if (ffmpegStdin && !ffmpegStdin.destroyed) {
        ffmpegStdin.write(nal);
      }
    }
  }

  pending = pending.subarray(starts.at(-1).pos);
}

function startFfmpeg() {
  if (ffmpeg && !ffmpeg.killed) return;

  const outputFps = Math.max(1, Math.min(15, config.mjpegFps));
  const quality = Math.max(2, Math.min(31, config.mjpegQuality));

  console.log(`FFmpeg starten: MJPEG ${outputFps} fps, kwaliteit ${quality}`);

  ffmpeg = spawn('ffmpeg', [
    '-hide_banner',
    '-loglevel', 'warning',
    '-f', 'hevc',
    '-r', '15',
    '-i', 'pipe:0',
    '-an',
    '-vf', `fps=${outputFps}`,
    '-q:v', String(quality),
    '-f', 'image2pipe',
    '-vcodec', 'mjpeg',
    'pipe:1',
  ], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  ffmpegStdin = ffmpeg.stdin;
  state.ffmpegRunning = true;

  ffmpeg.stdout.on('data', parseJpegOutput);

  ffmpeg.stderr.on('data', (chunk) => {
    const text = chunk.toString().trim();
    if (!text) return;
    state.lastFfmpeg = text.slice(-1000);
    console.warn(`[ffmpeg] ${text}`);
  });

  ffmpeg.on('error', (error) => {
    setError(`FFmpeg kon niet starten: ${error.message}`);
  });

  ffmpeg.on('exit', (code, signal) => {
    console.log(`FFmpeg gestopt (code=${code}, signal=${signal})`);
    state.ffmpegRunning = false;
    ffmpeg = null;
    ffmpegStdin = null;
  });
}

function parseJpegOutput(chunk) {
  jpegPending = Buffer.concat([jpegPending, chunk]);

  while (true) {
    const soi = jpegPending.indexOf(Buffer.from([0xff, 0xd8]));
    if (soi < 0) {
      if (jpegPending.length > 2 * 1024 * 1024) jpegPending = Buffer.alloc(0);
      return;
    }

    if (soi > 0) jpegPending = jpegPending.subarray(soi);

    const eoi = jpegPending.indexOf(Buffer.from([0xff, 0xd9]), 2);
    if (eoi < 0) return;

    const frame = jpegPending.subarray(0, eoi + 2);
    jpegPending = jpegPending.subarray(eoi + 2);
    state.frames++;
    broadcastJpeg(frame);
  }
}

function broadcastJpeg(frame) {
  const header = Buffer.from(
    `--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${frame.length}\r\n\r\n`,
  );
  const footer = Buffer.from('\r\n');

  for (const res of mjpegClients) {
    try {
      res.write(header);
      res.write(frame);
      res.write(footer);
    } catch {
      mjpegClients.delete(res);
    }
  }
}

async function startViewer() {
  if (!config.serial) throw new Error('EUFY_SERIAL ontbreekt in .env');
  if (!state.wsConnected || !state.listening) throw new Error('eufy-security-ws is nog niet klaar');

  if (state.active) return;

  clearCounters();
  state.active = true;
  state.startedAt = new Date().toISOString();
  state.lastError = null;
  startFfmpeg();

  send('device.start_livestream', { serialNumber: config.serial });

  if (autoStopTimer) clearTimeout(autoStopTimer);
  autoStopTimer = setTimeout(() => {
    console.log('Automatisch stoppen om batterij te sparen');
    stopViewer().catch((error) => setError(error.message));
  }, Math.max(10, config.autoStopSeconds) * 1000);
}

async function stopViewer() {
  if (autoStopTimer) {
    clearTimeout(autoStopTimer);
    autoStopTimer = null;
  }

  const wasActive = state.active;
  state.active = false;
  state.startedAt = null;

  if (wasActive && state.wsConnected) {
    try {
      send('device.stop_livestream', { serialNumber: config.serial });
    } catch (error) {
      console.warn(error.message);
    }
  }

  state.eufyRunning = false;

  if (ffmpegStdin && !ffmpegStdin.destroyed) {
    try { ffmpegStdin.end(); } catch {}
  }

  if (ffmpeg) {
    const processToKill = ffmpeg;
    setTimeout(() => {
      if (processToKill && !processToKill.killed) {
        try { processToKill.kill('SIGKILL'); } catch {}
      }
    }, 1500);
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (req.method === 'GET' && url.pathname === '/') {
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Length': indexHtml.length,
      'Cache-Control': 'no-store',
    });
    res.end(indexHtml);
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/status') {
    json(res, 200, publicState());
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/start') {
    try {
      await startViewer();
      json(res, 200, { ok: true });
    } catch (error) {
      setError(error.message);
      json(res, 503, { ok: false, error: error.message });
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/stop') {
    await stopViewer();
    json(res, 200, { ok: true });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/stream.mjpg') {
    res.writeHead(200, {
      'Content-Type': 'multipart/x-mixed-replace; boundary=frame',
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      'Pragma': 'no-cache',
      'Connection': 'keep-alive',
    });

    mjpegClients.add(res);
    state.clients = mjpegClients.size;

    req.on('close', () => {
      mjpegClients.delete(res);
      state.clients = mjpegClients.size;
    });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/favicon.ico') {
    res.writeHead(204);
    res.end();
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Not found');
});

server.listen(config.port, '0.0.0.0', () => {
  console.log(`Deurbel Viewer: http://0.0.0.0:${config.port}`);
  if (!config.serial) console.warn('LET OP: EUFY_SERIAL is nog niet ingesteld.');
});

connectEufy();

process.on('SIGTERM', async () => {
  await stopViewer();
  process.exit(0);
});

process.on('SIGINT', async () => {
  await stopViewer();
  process.exit(0);
});
