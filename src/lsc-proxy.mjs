import http from 'node:http';
import { spawn } from 'node:child_process';

const config = {
  port: Number(process.env.LSC_PROXY_PORT || 8093),
  rtspUrl: String(process.env.LSC_RTSP_URL || '').trim(),
  fps: Math.max(1, Math.min(15, Number(process.env.LSC_MJPEG_FPS || 8))),
  quality: Math.max(2, Math.min(31, Number(process.env.LSC_MJPEG_QUALITY || 5))),
  idleStopSeconds: Math.max(0, Number(process.env.LSC_IDLE_STOP_SECONDS || 10)),
  restartDelayMs: Math.max(500, Number(process.env.LSC_RESTART_DELAY_MS || 2000)),
};

const clients = new Set();
let ffmpeg = null;
let restartTimer = null;
let idleTimer = null;
let jpegPending = Buffer.alloc(0);
let lastFrame = null;

const state = {
  configured: Boolean(config.rtspUrl),
  active: false,
  online: false,
  clients: 0,
  frames: 0,
  restartCount: 0,
  startedAt: null,
  lastFrameAt: 0,
  lastError: config.rtspUrl ? null : 'LSC_RTSP_URL is niet ingesteld',
  lastFfmpeg: null,
};

function publicState() {
  const ageMs = state.lastFrameAt ? Date.now() - state.lastFrameAt : null;
  const online = Boolean(ffmpeg && state.lastFrameAt && ageMs < 7000);
  return {
    ...state,
    active: Boolean(ffmpeg),
    online,
    clients: clients.size,
    ageSeconds: ageMs === null ? null : Math.round(ageMs / 1000),
    port: config.port,
    fps: config.fps,
    quality: config.quality,
  };
}

function clearRestartTimer() {
  if (!restartTimer) return;
  clearTimeout(restartTimer);
  restartTimer = null;
}

function clearIdleTimer() {
  if (!idleTimer) return;
  clearTimeout(idleTimer);
  idleTimer = null;
}

function stopFfmpeg(reason = 'stop') {
  clearRestartTimer();
  if (!ffmpeg) return;
  console.log(`[lsc] FFmpeg stoppen: ${reason}`);
  const child = ffmpeg;
  ffmpeg = null;
  state.active = false;
  state.online = false;
  jpegPending = Buffer.alloc(0);
  try { child.kill('SIGTERM'); } catch {}
  setTimeout(() => {
    if (!child.killed) {
      try { child.kill('SIGKILL'); } catch {}
    }
  }, 1500).unref();
}

function scheduleRestart() {
  if (!config.rtspUrl || clients.size === 0 || restartTimer || ffmpeg) return;
  restartTimer = setTimeout(() => {
    restartTimer = null;
    state.restartCount++;
    startFfmpeg();
  }, config.restartDelayMs);
  restartTimer.unref?.();
}

function writeFrame(client, frame) {
  if (!client || client.closed || client.blocked) return;
  const header = Buffer.from(
    `--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${frame.length}\r\n\r\n`,
  );
  try {
    const ok1 = client.res.write(header);
    const ok2 = client.res.write(frame);
    const ok3 = client.res.write('\r\n');
    if (!ok1 || !ok2 || !ok3) client.blocked = true;
  } catch {
    client.closed = true;
    clients.delete(client);
    state.clients = clients.size;
  }
}

function broadcastFrame(frame) {
  for (const client of clients) writeFrame(client, frame);
}

function parseJpeg(chunk) {
  jpegPending = Buffer.concat([jpegPending, chunk]);
  while (true) {
    const soi = jpegPending.indexOf(Buffer.from([0xff, 0xd8]));
    if (soi < 0) {
      if (jpegPending.length > 4 * 1024 * 1024) jpegPending = Buffer.alloc(0);
      return;
    }
    if (soi > 0) jpegPending = jpegPending.subarray(soi);
    const eoi = jpegPending.indexOf(Buffer.from([0xff, 0xd9]), 2);
    if (eoi < 0) return;

    const frame = Buffer.from(jpegPending.subarray(0, eoi + 2));
    jpegPending = jpegPending.subarray(eoi + 2);
    lastFrame = frame;
    state.frames++;
    state.lastFrameAt = Date.now();
    state.online = true;
    state.lastError = null;
    broadcastFrame(frame);
  }
}

function startFfmpeg() {
  clearIdleTimer();
  clearRestartTimer();
  if (ffmpeg || !config.rtspUrl) return;

  console.log(`[lsc] RTSP openen voor ${clients.size} client(s).`);
  state.startedAt = new Date().toISOString();
  state.active = true;
  state.lastError = null;
  jpegPending = Buffer.alloc(0);

  const child = spawn('/usr/bin/ffmpeg', [
    '-hide_banner',
    '-loglevel', 'warning',
    '-rtsp_transport', 'tcp',
    '-fflags', 'nobuffer',
    '-flags', 'low_delay',
    '-probesize', '32768',
    '-analyzeduration', '0',
    '-i', config.rtspUrl,
    '-map', '0:v:0',
    '-an',
    '-vf', `fps=${config.fps}`,
    '-q:v', String(config.quality),
    '-f', 'image2pipe',
    '-vcodec', 'mjpeg',
    'pipe:1',
  ], { stdio: ['ignore', 'pipe', 'pipe'] });

  ffmpeg = child;

  child.stdout.on('data', parseJpeg);
  child.stderr.on('data', chunk => {
    const text = chunk.toString().trim();
    if (!text) return;
    if (text.includes('deprecated pixel format used')) return;
    state.lastFfmpeg = text.slice(-1600);
  });

  child.on('error', error => {
    state.lastError = `FFmpeg kon niet starten: ${error.message}`;
    console.warn(`[lsc] ${state.lastError}`);
  });

  child.on('exit', (code, signal) => {
    if (ffmpeg === child) ffmpeg = null;
    state.active = false;
    state.online = false;
    if (clients.size > 0) {
      state.lastError = `RTSP-stream stopte (code=${code}, signal=${signal || '-'}); opnieuw verbinden…`;
      console.warn(`[lsc] ${state.lastError}`);
      scheduleRestart();
    } else {
      console.log(`[lsc] RTSP-stream gestopt (code=${code}, signal=${signal || '-'}).`);
    }
  });
}

function onClientCountChanged() {
  state.clients = clients.size;
  if (clients.size > 0) {
    clearIdleTimer();
    startFfmpeg();
    return;
  }

  if (!ffmpeg) return;
  if (config.idleStopSeconds <= 0) {
    stopFfmpeg('geen kijkers');
    return;
  }
  clearIdleTimer();
  idleTimer = setTimeout(() => {
    idleTimer = null;
    if (clients.size === 0) stopFfmpeg('geen kijkers');
  }, config.idleStopSeconds * 1000);
  idleTimer.unref?.();
}

const page = Buffer.from(`<!doctype html>
<html lang="nl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>LSC camera test</title>
<style>
:root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;background:#090d12;color:#eef3f8;font-family:system-ui,sans-serif}.wrap{width:min(1100px,100%);margin:auto;padding:20px}.card{background:#111720;border:1px solid #26303d;border-radius:18px;overflow:hidden}.head{display:flex;justify-content:space-between;gap:12px;align-items:center;padding:14px 16px}.status{font-size:13px;color:#9ca9b9}.good{color:#7ee2a8}.bad{color:#ff8998}img{display:block;width:100%;aspect-ratio:16/9;object-fit:contain;background:#000}.meta{padding:14px 16px;color:#9ca9b9;font-size:13px;line-height:1.5}code{color:#dce7f5}</style>
</head>
<body><div class="wrap"><div class="card"><div class="head"><strong>LSC Smart Connect 1080P</strong><span id="status" class="status">Verbinden…</span></div><img src="/stream.mjpg" alt="LSC livebeeld"><div class="meta">RTSP wordt lokaal via FFmpeg naar MJPEG omgezet. Status: <code>/api/status</code> · snapshot: <code>/snapshot.jpg</code></div></div></div><script>async function tick(){try{const r=await fetch('/api/status',{cache:'no-store'}),s=await r.json(),e=document.getElementById('status');e.textContent=s.online?'● Online · '+s.frames+' frames':s.active?'● Verbinden…':'● Wacht op kijker';e.className='status '+(s.online?'good':s.lastError?'bad':'')}catch{}}tick();setInterval(tick,1500)</script></body></html>`);

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (req.method === 'GET' && url.pathname === '/') {
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Length': page.length,
      'Cache-Control': 'no-store',
    });
    res.end(page);
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/status') {
    const body = Buffer.from(JSON.stringify(publicState()));
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': body.length,
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(body);
    return;
  }

  if (req.method === 'GET' && url.pathname === '/snapshot.jpg') {
    if (!lastFrame) {
      res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end('Nog geen frame beschikbaar');
      return;
    }
    res.writeHead(200, {
      'Content-Type': 'image/jpeg',
      'Content-Length': lastFrame.length,
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(lastFrame);
    return;
  }

  if (req.method === 'GET' && url.pathname === '/stream.mjpg') {
    if (!config.rtspUrl) {
      res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('LSC_RTSP_URL is niet ingesteld');
      return;
    }

    res.writeHead(200, {
      'Content-Type': 'multipart/x-mixed-replace; boundary=frame',
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      'Pragma': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
      'Access-Control-Allow-Origin': '*',
    });

    const client = { res, blocked: false, closed: false };
    clients.add(client);
    onClientCountChanged();
    res.on('drain', () => { client.blocked = false; });
    if (lastFrame) writeFrame(client, lastFrame);

    req.on('close', () => {
      client.closed = true;
      clients.delete(client);
      onClientCountChanged();
    });
    return;
  }

  if (url.pathname === '/favicon.ico') {
    res.writeHead(204);
    res.end();
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Not found');
});

server.listen(config.port, '0.0.0.0', () => {
  console.log(`[lsc] Proxy: http://0.0.0.0:${config.port}`);
  if (config.rtspUrl) {
    console.log(`[lsc] Camera geconfigureerd · ${config.fps} fps MJPEG · idle-stop ${config.idleStopSeconds}s`);
  } else {
    console.warn('[lsc] LSC_RTSP_URL ontbreekt; proxy wacht op configuratie.');
  }
});

function shutdown() {
  clearIdleTimer();
  clearRestartTimer();
  stopFfmpeg('shutdown');
  try { server.close(); } catch {}
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
