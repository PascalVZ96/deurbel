import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const C = {
  dev: process.env.EUFY_SERIAL || '',
  hb: process.env.EUFY_STATION_SERIAL || 'T8030T2324151AF5',
  ws: process.env.EUFY_WS_URL || 'ws://127.0.0.1:3000',
  status: process.env.SECURITY_STATUS_URL || 'http://127.0.0.1:8090/api/status',
  rec: process.env.RECORDINGS_DIR || '/recordings',
  data: process.env.DATA_DIR || '/data',
  poll: Math.max(5000, Number(process.env.HOMEBASE_POLL_MS || 5000)),
  min: Number(process.env.STORAGE_MIN_BYTES || 2_000_000_000_000),
};

const stateFile = path.join(C.data, 'homebase-poller.json');
const statusFile = path.join(C.data, 'homebase-status.json');
let ws = null;
let query = null;
let download = null;
let pollTimer = null;
let reconnectTimer = null;
let running = false;
let stopping = false;
let listening = false;
let state = { eventCount: null, cropPath: '', token: '' };
let status = {
  connected: false,
  listening: false,
  lastCheckAt: null,
  lastSuccessAt: null,
  lastImportAt: null,
  lastImportedFile: null,
  lastError: null,
  eventCount: null,
  token: '',
};
let lastStatusWrite = 0;

const send = (command, extra = {}, messageId = `${command}-${Date.now()}`) => {
  if (!ws || ws.readyState !== 1) throw new Error('WebSocket niet verbonden');
  ws.send(JSON.stringify({ messageId, command, ...extra }));
};

const toBuf = value => {
  if (!value) return null;
  if (Buffer.isBuffer(value)) return value;
  if (Array.isArray(value)) return Buffer.from(value);
  if (value?.data && Array.isArray(value.data)) return Buffer.from(value.data);
  if (typeof value === 'string') {
    try { return Buffer.from(value, 'base64'); } catch {}
  }
  return null;
};

const stamp = token => `${token.slice(0,4)}-${token.slice(4,6)}-${token.slice(6,8)}_${token.slice(8,10)}-${token.slice(10,12)}-${token.slice(12,14)}`;
const tokenDate = token => new Date(+token.slice(0,4), +token.slice(4,6)-1, +token.slice(6,8), +token.slice(8,10), +token.slice(10,12), +token.slice(12,14));

function nextDay(day) {
  const date = new Date(Date.UTC(+day.slice(0,4), +day.slice(4,6)-1, +day.slice(6,8)+1));
  return `${date.getUTCFullYear()}${String(date.getUTCMonth()+1).padStart(2,'0')}${String(date.getUTCDate()).padStart(2,'0')}`;
}

function diskOk() {
  fs.accessSync(C.rec, fs.constants.R_OK | fs.constants.W_OK);
  const stat = fs.statfsSync(C.rec, { bigint: true });
  return Number(stat.blocks * stat.bsize) >= C.min;
}

function loadState() {
  try {
    const saved = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    if (Number.isFinite(Number(saved.eventCount)) && saved.cropPath) {
      state = {
        eventCount: Number(saved.eventCount),
        cropPath: String(saved.cropPath),
        token: String(saved.token || ''),
      };
      status.eventCount = state.eventCount;
      status.token = state.token;
      console.log(`[homebase] Vorige positie: event_count=${state.eventCount}${state.token ? ` (${state.token})` : ''}.`);
    }
  } catch {}
}

function loadStatus() {
  try {
    const saved = JSON.parse(fs.readFileSync(statusFile, 'utf8'));
    status.lastImportAt = saved.lastImportAt || null;
    status.lastImportedFile = saved.lastImportedFile || null;
  } catch {}
}

function writeStatus(force = false) {
  const now = Date.now();
  if (!force && now - lastStatusWrite < 30000) return;
  lastStatusWrite = now;
  status.connected = Boolean(ws && ws.readyState === 1);
  status.listening = Boolean(listening);
  status.eventCount = state.eventCount;
  status.token = state.token;
  fs.mkdirSync(C.data, { recursive: true });
  const tmp = `${statusFile}.tmp`;
  try {
    fs.writeFileSync(tmp, JSON.stringify({ ...status, updatedAt: new Date().toISOString() }, null, 2));
    fs.renameSync(tmp, statusFile);
  } catch (error) {
    try { fs.unlinkSync(tmp); } catch {}
    console.warn(`[homebase] Status opslaan mislukt: ${error.message}`);
  }
}

function saveState(next) {
  state = {
    eventCount: Number(next.eventCount),
    cropPath: String(next.cropPath || ''),
    token: String(next.token || ''),
  };
  status.eventCount = state.eventCount;
  status.token = state.token;
  fs.mkdirSync(C.data, { recursive: true });
  const tmp = `${stateFile}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ ...state, updatedAt: new Date().toISOString() }, null, 2));
  fs.renameSync(tmp, stateFile);
  writeStatus(true);
}

async function securityOn() {
  const response = await fetch(C.status, { cache: 'no-store' });
  if (!response.ok) throw new Error(`dashboard HTTP ${response.status}`);
  return Boolean((await response.json())?.security?.securityEnabled);
}

function queryLatest() {
  if (query) return Promise.reject(new Error('query bezig'));
  const id = `hbl-${Date.now()}`;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      if (query?.id === id) query = null;
      reject(new Error('latest-query timeout'));
    }, 20000);
    query = { id, event:'database query latest', resolve, reject, timeout };
    try {
      send('station.database_query_latest_info', { serialNumber: C.hb }, id);
    } catch (error) {
      clearTimeout(timeout);
      query = null;
      reject(error);
    }
  });
}

function queryByDate(startDate, endDate) {
  if (query) return Promise.reject(new Error('query bezig'));
  const id = `hbb-${Date.now()}`;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      if (query?.id === id) query = null;
      reject(new Error('backfill-query timeout'));
    }, 45000);
    query = { id, event:'database query by date', resolve, reject, timeout };
    try {
      send('station.database_query_by_date', {
        serialNumber: C.hb,
        serialNumbers: [C.dev],
        startDate,
        endDate,
      }, id);
    } catch (error) {
      clearTimeout(timeout);
      query = null;
      reject(error);
    }
  });
}

function latestForDoorbell(data) {
  const row = (Array.isArray(data) ? data : []).find(item => item?.device_sn === C.dev);
  if (!row) return null;

  const cropPath = String(row.crop_local_path || '');
  const match = /\/([0-9]{14})\/snapshort[.]jpg$/i.exec(cropPath);
  if (!match) throw new Error(`onbekend HomeBase-pad: ${cropPath || '(leeg)'}`);

  const token = match[1];
  const storagePath = `${path.posix.dirname(cropPath)}/${token}.zxvideo`;
  const eventCount = Number(row.event_count);
  if (!Number.isFinite(eventCount)) throw new Error('HomeBase event_count ontbreekt');

  return { eventCount, cropPath, token, storagePath, cipherId:0, recordId:null };
}

function recordsFromDatabase(data, afterToken, throughToken) {
  const seen = new Set();
  return (Array.isArray(data) ? data : [])
    .filter(row => row?.device_sn === C.dev)
    .map(row => {
      const storagePath = String(row.storage_path || '');
      const match = /([0-9]{14})[.]zxvideo$/i.exec(storagePath);
      if (!match) return null;
      return {
        eventCount:null,
        cropPath:'',
        token:match[1],
        storagePath,
        cipherId:Number(row.cipher_id || 0),
        recordId:row.record_id ?? null,
      };
    })
    .filter(record => record && (!afterToken || record.token > afterToken) && (!throughToken || record.token <= throughToken))
    .filter(record => {
      if (seen.has(record.token)) return false;
      seen.add(record.token);
      return true;
    })
    .sort((a,b) => a.token.localeCompare(b.token));
}

function finishStream(stream) {
  return new Promise((resolve, reject) => {
    stream.once('close', resolve);
    stream.once('error', reject);
    stream.end();
  });
}

function downloadRecord(record, videoFile, audioFile) {
  if (download) return Promise.reject(new Error('download bezig'));
  const video = fs.createWriteStream(videoFile);
  const audio = fs.createWriteStream(audioFile);
  const id = `hbd-${Date.now()}`;

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      if (download?.id === id) download = null;
      video.destroy();
      audio.destroy();
      reject(new Error('download timeout'));
    }, 120000);

    download = {
      id, video, audio, timeout, resolve, reject,
      vc: 0, ac: 0, vb: 0, ab: 0, vm: null, am: null,
    };

    try {
      send('device.start_download', {
        serialNumber: C.dev,
        path: record.storagePath,
        cipherId: Number(record.cipherId || 0),
      }, id);
    } catch (error) {
      clearTimeout(timeout);
      download = null;
      video.destroy();
      audio.destroy();
      reject(error);
    }
  });
}

function ff(args) {
  const result = spawnSync('ffmpeg', args, { encoding: 'utf8' });
  if (result.status !== 0) throw new Error((result.stderr || 'ffmpeg mislukt').trim());
}

function convert(data, videoFile, audioFile, output, thumb) {
  const format = /265|HEVC/i.test(String(data.vm?.videoCodec || '')) ? 'hevc' : 'h264';
  const fps = Math.max(1, Number(data.vm?.videoFPS || 15));
  const input = ['-hide_banner', '-loglevel', 'warning', '-fflags', '+genpts', '-r', String(fps), '-f', format, '-i', videoFile];
  const encode = ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p'];
  let withAudio = false;

  if (data.ac > 0 && /AAC/i.test(String(data.am?.audioCodec || ''))) {
    try {
      ff([...input, '-f', 'aac', '-i', audioFile, ...encode, '-c:a', 'aac', '-b:a', '96k', '-shortest', '-movflags', '+faststart', '-y', output]);
      withAudio = true;
    } catch (error) {
      console.warn(`[homebase] Audio mislukt; probeer zonder audio: ${error.message}`);
    }
  }

  if (!withAudio) ff([...input, '-an', ...encode, '-movflags', '+faststart', '-y', output]);
  ff(['-hide_banner', '-loglevel', 'error', '-ss', '1', '-i', output, '-frames:v', '1', '-q:v', '3', '-y', thumb]);
}

async function importRecord(record) {
  if (!diskOk()) throw new Error('/recordings staat niet op de grote HDD');

  const base = `motion_${stamp(record.token)}_eufy-original`;
  const output = path.join(C.rec, `${base}.mp4`);
  const thumb = path.join(C.rec, `${base}.jpg`);
  const videoFile = path.join(C.rec, `.${base}.video`);
  const audioFile = path.join(C.rec, `.${base}.audio`);

  if (fs.existsSync(output) && fs.statSync(output).size > 0) {
    console.log(`[homebase] Bestaat al: ${path.basename(output)}`);
    return path.basename(output);
  }

  for (const file of [output, thumb, videoFile, audioFile]) {
    try { fs.unlinkSync(file); } catch {}
  }

  try {
    const idText = record.recordId != null ? `record_id=${record.recordId}` : `event_count=${record.eventCount ?? '?'}`;
    console.log(`[homebase] Nieuwe HomeBase-opname: ${idText} (${record.token}); livestream blijft uit.`);
    console.log(`[homebase] Download: ${record.storagePath}`);
    const data = await downloadRecord(record, videoFile, audioFile);
    if (!data.vc || !data.vb) throw new Error('download bevat geen videodata');
    console.log(`[homebase] Ontvangen: ${data.vc} videochunks / ${data.ac} audiochunks.`);
    convert(data, videoFile, audioFile, output, thumb);
    const when = tokenDate(record.token);
    try { fs.utimesSync(output, when, when); } catch {}
    try { fs.utimesSync(thumb, when, when); } catch {}
    const file = path.basename(output);
    console.log(`[homebase] Opgeslagen: ${file} (${Math.round(fs.statSync(output).size / 1024)} KB).`);
    return file;
  } finally {
    for (const file of [videoFile, audioFile]) {
      try { fs.unlinkSync(file); } catch {}
    }
  }
}

async function importChanged(latest, delta) {
  let lastImportedFile = null;

  if (delta > 1) {
    const startDate = /^[0-9]{14}$/.test(state.token) ? state.token.slice(0,8) : latest.token.slice(0,8);
    const endDate = nextDay(latest.token.slice(0,8));
    console.warn(`[homebase] event_count sprong met ${delta}; backfill ${startDate} -> ${endDate} wordt geprobeerd.`);

    try {
      const records = recordsFromDatabase(await queryByDate(startDate, endDate), state.token, latest.token);
      if (records.length) {
        console.log(`[homebase] Backfill vond ${records.length} gemiste/nieuwe opname(s).`);
        for (const record of records) lastImportedFile = await importRecord(record);
      } else {
        console.warn('[homebase] Backfill gaf geen passende .zxvideo-records; nieuwste opname wordt veiliggesteld.');
      }
    } catch (error) {
      console.warn(`[homebase] Backfill-query mislukt: ${error.message}; nieuwste opname wordt veiliggesteld.`);
    }
  }

  const latestAlreadyHandled = fs.existsSync(path.join(C.rec, `motion_${stamp(latest.token)}_eufy-original.mp4`));
  if (!latestAlreadyHandled) lastImportedFile = await importRecord(latest);
  else if (!lastImportedFile) lastImportedFile = `motion_${stamp(latest.token)}_eufy-original.mp4`;

  return lastImportedFile;
}

async function poll() {
  if (running || stopping || !listening || !ws || ws.readyState !== 1) return;
  running = true;
  status.lastCheckAt = new Date().toISOString();

  try {
    const latest = latestForDoorbell(await queryLatest());
    status.lastSuccessAt = new Date().toISOString();
    status.lastError = null;
    writeStatus();

    if (!latest) {
      status.lastError = 'Deurbel ontbreekt in database query latest';
      writeStatus(true);
      console.warn('[homebase] Deurbel ontbreekt in database query latest.');
      return;
    }

    if (state.eventCount === null) {
      saveState(latest);
      console.log(`[homebase] Startpositie: event_count=${latest.eventCount} (${latest.token}).`);
      return;
    }

    if (latest.eventCount < state.eventCount) {
      saveState(latest);
      console.warn(`[homebase] event_count is teruggelopen; nieuwe startpositie ${latest.eventCount} (${latest.token}).`);
      return;
    }

    const changed = latest.eventCount > state.eventCount || latest.cropPath !== state.cropPath;
    if (!changed) return;

    const delta = latest.eventCount - state.eventCount;
    if (!await securityOn()) {
      saveState(latest);
      console.log(`[homebase] Beveiliging uit; positie bijgewerkt naar event_count=${latest.eventCount} zonder import.`);
      return;
    }

    const importedFile = await importChanged(latest, delta);
    status.lastImportAt = new Date().toISOString();
    status.lastImportedFile = importedFile;
    saveState(latest);
    writeStatus(true);
  } catch (error) {
    status.lastError = error.message;
    writeStatus(true);
    console.warn(`[homebase] Controle mislukt: ${error.message}`);
  } finally {
    running = false;
  }
}

async function finishDownload() {
  const current = download;
  if (!current) return;
  download = null;
  clearTimeout(current.timeout);
  try {
    await Promise.all([finishStream(current.video), finishStream(current.audio)]);
    current.resolve(current);
  } catch (error) {
    current.reject(error);
  }
}

function handle(data) {
  if (data.type === 'result' && data.messageId === 'hb-listen') {
    if (data.success === false) {
      status.lastError = data.error || data.errorCode || 'start_listening mislukt';
      writeStatus(true);
      console.warn(`[homebase] start_listening mislukt: ${status.lastError}`);
    } else if (!listening) {
      listening = true;
      status.listening = true;
      status.lastError = null;
      writeStatus(true);
      console.log('[homebase] Luisteren actief; latest-info polling gestart.');
      schedule(1000);
    }
  }

  if (query) {
    if (data.type === 'result' && data.messageId === query.id && data.success === false) {
      const current = query;
      query = null;
      clearTimeout(current.timeout);
      current.reject(new Error(data.error || data.errorCode || 'database-query geweigerd'));
    } else if (
      data.type === 'event' &&
      data.event?.source === 'station' &&
      data.event.serialNumber === C.hb &&
      data.event.event === query.event
    ) {
      const current = query;
      query = null;
      clearTimeout(current.timeout);
      Number(data.event.returnCode) === 0
        ? current.resolve(data.event.data || [])
        : current.reject(new Error(`database returnCode ${data.event.returnCode}`));
    }
  }

  if (!download) return;

  if (data.type === 'result' && data.messageId === download.id && data.success === false) {
    const current = download;
    download = null;
    clearTimeout(current.timeout);
    current.video.destroy();
    current.audio.destroy();
    current.reject(new Error(data.error || data.errorCode || 'download geweigerd'));
    return;
  }

  const event = data.event;
  if (data.type !== 'event' || event?.source !== 'device' || event.serialNumber !== C.dev || !download) return;

  if (event.event === 'download started') console.log('[homebase] HomeBase-download gestart.');
  if (event.event === 'download video data') {
    const buffer = toBuf(event.buffer);
    if (buffer?.length) {
      download.video.write(buffer);
      download.vc++;
      download.vb += buffer.length;
      download.vm ||= event.metadata;
    }
  }
  if (event.event === 'download audio data') {
    const buffer = toBuf(event.buffer);
    if (buffer?.length) {
      download.audio.write(buffer);
      download.ac++;
      download.ab += buffer.length;
      download.am ||= event.metadata;
    }
  }
  if (event.event === 'download finished') void finishDownload();
}

function stopActive(reason) {
  if (query) {
    const current = query;
    query = null;
    clearTimeout(current.timeout);
    current.reject(new Error(reason));
  }
  if (download) {
    const current = download;
    download = null;
    clearTimeout(current.timeout);
    current.video.destroy();
    current.audio.destroy();
    current.reject(new Error(reason));
  }
}

function schedule(delay = C.poll) {
  if (stopping) return;
  if (pollTimer) clearTimeout(pollTimer);
  pollTimer = setTimeout(async () => {
    pollTimer = null;
    await poll();
    schedule();
  }, delay);
}

function connect() {
  if (!C.dev || !C.hb) {
    status.lastError = 'EUFY_SERIAL of EUFY_STATION_SERIAL ontbreekt';
    writeStatus(true);
    console.error('[homebase] EUFY_SERIAL of EUFY_STATION_SERIAL ontbreekt.');
    return;
  }

  ws = new WebSocket(C.ws);
  ws.addEventListener('open', () => {
    listening = false;
    status.connected = true;
    status.listening = false;
    status.lastError = null;
    writeStatus(true);
    console.log(`[homebase] Verbonden. Deurbel ${C.dev} via HomeBase ${C.hb}.`);
    send('set_api_schema', { schemaVersion: 21 }, 'hb-schema');
    send('start_listening', {}, 'hb-listen');
  });
  ws.addEventListener('message', message => {
    try {
      handle(JSON.parse(typeof message.data === 'string' ? message.data : message.data.toString()));
    } catch {}
  });
  ws.addEventListener('close', () => {
    listening = false;
    status.connected = false;
    status.listening = false;
    status.lastError = 'WebSocket verbroken';
    writeStatus(true);
    stopActive('WebSocket verbroken');
    if (pollTimer) clearTimeout(pollTimer);
    pollTimer = null;
    ws = null;
    if (stopping) return;
    console.warn('[homebase] WebSocket verbroken; over 3s opnieuw.');
    reconnectTimer = setTimeout(connect, 3000);
  });
  ws.addEventListener('error', () => {
    if (!stopping) {
      status.lastError = 'WebSocket-fout';
      writeStatus(true);
      console.warn('[homebase] WebSocket-fout.');
    }
  });
}

function shutdown() {
  stopping = true;
  status.connected = false;
  status.listening = false;
  writeStatus(true);
  if (pollTimer) clearTimeout(pollTimer);
  if (reconnectTimer) clearTimeout(reconnectTimer);
  stopActive('monitor stopt');
  try { ws?.close(); } catch {}
  process.exit(0);
}

fs.mkdirSync(C.data, { recursive: true });
loadState();
loadStatus();
writeStatus(true);
console.log('[homebase] HomeBase latest-info is de bron; zware dagquery draait alleen als backfill nodig is.');
console.log(`[homebase] Controle elke ${Math.round(C.poll / 1000)}s; automatische route start GEEN livestream.`);
connect();
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
