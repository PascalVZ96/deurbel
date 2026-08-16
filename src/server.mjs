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
  frames: 0,
  clients: 0,
  selectedStream: null,
  streams: {},
  lastError: null,
  lastFfmpeg: null,
  startedAt: null,
};

let ws = null;
let reconnectTimer = null;
let autoStopTimer = null;
const decoders = new Map();
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
  state.frames = 0;
  state.selectedStream = null;
  state.streams = {};
  state.lastFfmpeg = null;
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

function streamKey(codec, width, height, fps) {
  return `${codec || 'video'}:${width || '?'}x${height || '?'}:${fps || '?'}fps`;
}

function inputFormat(codec) {
  const value = String(codec || '').toUpperCase();
  if (value.includes('265') || value.includes('HEVC')) return 'hevc';
  if (value.includes('264') || value.includes('AVC')) return 'h264';
  return 'hevc';
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

      if (code === 'device_livestream_already_running') {
        console.warn('Eufy meldt dat de livestream al draait; viewer blijft luisteren.');
        state.eufyRunning = true;
        return;
      }

      if (code === 'device_livestream_not_running' && !state.active) return;
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

  if (event.event !== 'livestream video data' || !state.active) return;

  const buffer = getBuffer(event.buffer);
  if (!buffer?.length) return;

  const metadata = event.metadata || {};
  const codec = metadata.videoCodec || state.codec || 'H265';
  const width = Number(metadata.videoWidth || state.width || 0);
  const height = Number(metadata.videoHeight || state.height || 0);
  const fps = Number(metadata.videoFPS || state.fps || 15);

  state.codec = codec;
  state.width = width || state.width;
  state.height = height || state.height;
  state.fps = fps || state.fps;
  state.inputBytes += buffer.length;

  const key = streamKey(codec, width, height, fps);
  let stats = state.streams[key];
  if (!stats) {
    stats = state.streams[key] = {
      codec,
      width,
      height,
      fps,
      chunks: 0,
      bytes: 0,
      frames: 0,
      droppedChunks: 0,
      ffmpegRunning: false,
      lastFfmpeg: null,
    };
    console.log(`Nieuwe videobron: ${key}`);
  }

  stats.chunks++;
  stats.bytes += buffer.length;
  feedDecoder(key, codec, fps, buffer);
}

function startDecoder(key, codec, fps) {
  const existing = decoders.get(key);
  if (existing?.process && !existing.process.killed) return existing;

  const outputFps = Math.max(1, Math.min(15, config.mjpegFps));
  const quality = Math.max(2, Math.min(31, config.mjpegQuality));
  const inputFps = Math.max(1, Math.min(30, Number(fps) || 15));
  const format = inputFormat(codec);

  console.log(`FFmpeg bron starten: ${key}`);

  const child = spawn('ffmpeg', [
    '-hide_banner',
    '-loglevel', 'warning',
    '-fflags', '+genpts+discardcorrupt',
    '-f', format,
    '-r', String(inputFps),
    '-i', 'pipe:0',
    '-an',
    '-vf', `fps=${outputFps}`,
    '-q:v', String(quality),
    '-f', 'image2pipe',
    '-vcodec', 'mjpeg',
    'pipe:1',
  ], { stdio: ['pipe', 'pipe', 'pipe'] });

  const decoder = {
    key,
    process: child,
    stdin: child.stdin,
    jpegPending: Buffer.alloc(0),
    blocked: false,
    frames: 0,
    lastFrameAt: 0,
  };

  decoders.set(key, decoder);
  state.ffmpegRunning = true;
  if (state.streams[key]) state.streams[key].ffmpegRunning = true;

  child.stdin.on('drain', () => {
    decoder.blocked = false;
  });

  child.stdout.on('data', (chunk) => parseJpegOutput(decoder, chunk));

  child.stderr.on('data', (chunk) => {
    const text = chunk.toString().trim();
    if (!text) return;
    const clipped = text.slice(-1200);
    state.lastFfmpeg = `[${key}] ${clipped}`;
    if (state.streams[key]) state.streams[key].lastFfmpeg = clipped;
    console.warn(`[ffmpeg ${key}] ${text}`);
  });

  child.on('error', (error) => {
    setError(`FFmpeg kon bron ${key} niet starten: ${error.message}`);
  });

  child.on('exit', (code, signal) => {
    console.log(`FFmpeg bron gestopt: ${key} (code=${code}, signal=${signal})`);
    if (state.streams[key]) state.streams[key].ffmpegRunning = false;
    decoder.process = null;
    decoder.stdin = null;
    state.ffmpegRunning = [...decoders.values()].some((d) => d.process && !d.process.killed);
  });

  return decoder;
}

function feedDecoder(key, codec, fps, buffer) {
  const decoder = startDecoder(key, codec, fps);
  if (!decoder.stdin || decoder.stdin.destroyed) return;

  if (decoder.blocked) {
    if (state.streams[key]) state.streams[key].droppedChunks++;
    return;
  }

  try {
    if (!decoder.stdin.write(buffer)) decoder.blocked = true;
  } catch (error) {
    if (state.streams[key]) state.streams[key].lastFfmpeg = error.message;
  }
}

function parseJpegOutput(decoder, chunk) {
  decoder.jpegPending = Buffer.concat([decoder.jpegPending, chunk]);

  while (true) {
    const soi = decoder.jpegPending.indexOf(Buffer.from([0xff, 0xd8]));
    if (soi < 0) {
      if (decoder.jpegPending.length > 2 * 1024 * 1024) decoder.jpegPending = Buffer.alloc(0);
      return;
    }

    if (soi > 0) decoder.jpegPending = decoder.jpegPending.subarray(soi);

    const eoi = decoder.jpegPending.indexOf(Buffer.from([0xff, 0xd9]), 2);
    if (eoi < 0) return;

    const frame = decoder.jpegPending.subarray(0, eoi + 2);
    decoder.jpegPending = decoder.jpegPending.subarray(eoi + 2);

    const now = Date.now();
    decoder.frames++;
    decoder.lastFrameAt = now;
    state.frames++;
    if (state.streams[decoder.key]) state.streams[decoder.key].frames++;

    const selected = state.selectedStream ? decoders.get(state.selectedStream) : null;
    if (!state.selectedStream || !selected?.lastFrameAt || now - selected.lastFrameAt > 2500) {
      if (state.selectedStream !== decoder.key) {
        console.log(`Actieve videobron: ${decoder.key}`);
      }
      state.selectedStream = decoder.key;
    }

    if (state.selectedStream === decoder.key) broadcastJpeg(frame);
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

function stopDecoders() {
  for (const decoder of decoders.values()) {
    if (decoder.stdin && !decoder.stdin.destroyed) {
      try { decoder.stdin.end(); } catch {}
    }

    if (decoder.process && !decoder.process.killed) {
      try { decoder.process.kill('SIGTERM'); } catch {}
      const processToKill = decoder.process;
      setTimeout(() => {
        if (processToKill && !processToKill.killed) {
          try { processToKill.kill('SIGKILL'); } catch {}
        }
      }, 1200);
    }
  }

  decoders.clear();
  state.ffmpegRunning = false;
}

async function startViewer() {
  if (!config.serial) throw new Error('EUFY_SERIAL ontbreekt in .env');
  if (!state.wsConnected || !state.listening) throw new Error('eufy-security-ws is nog niet klaar');
  if (state.active) return;

  stopDecoders();
  clearCounters();
  state.active = true;
  state.startedAt = new Date().toISOString();
  state.lastError = null;

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
  stopDecoders();
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
