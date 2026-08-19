import fs from 'node:fs';
import path from 'node:path';

const C = {
  dev: process.env.EUFY_SERIAL || '',
  ws: process.env.EUFY_WS_URL || 'ws://127.0.0.1:3000',
  data: process.env.DATA_DIR || '/data',
  pollMs: Math.max(60_000, Number(process.env.BATTERY_POLL_MS || 900_000)),
  lowPercent: Math.max(1, Math.min(99, Number(process.env.BATTERY_LOW_PERCENT || 20))),
  criticalPercent: Math.max(1, Math.min(99, Number(process.env.BATTERY_CRITICAL_PERCENT || 10))),
};

const statusFile = path.join(C.data, 'battery-status.json');
const historyFile = path.join(C.data, 'battery-history.json');
const startedAt = new Date().toISOString();

let ws = null;
let reconnectTimer = null;
let pollTimer = null;
let queryTimer = null;
let pendingQueryId = null;
let stopping = false;
let listening = false;

let history = [];
let status = {
  processStartedAt: startedAt,
  connected: false,
  listening: false,
  available: false,
  batteryPercent: null,
  batteryTemperature: null,
  chargingStatus: null,
  wifiSignalLevel: null,
  lastReadAt: null,
  lastChangedAt: null,
  source: null,
  health: 'unknown',
  trend24h: null,
  samples: 0,
  consecutiveFailures: 0,
  lastError: null,
};

function atomicWrite(file, value) {
  fs.mkdirSync(C.data, { recursive: true });
  const tmp = `${file}.tmp`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
    fs.renameSync(tmp, file);
  } catch (error) {
    try { fs.unlinkSync(tmp); } catch {}
    console.warn(`[battery] Opslaan mislukt: ${error.message}`);
  }
}

function loadHistory() {
  try {
    const saved = JSON.parse(fs.readFileSync(historyFile, 'utf8'));
    if (Array.isArray(saved)) history = saved.filter(x => x && Number.isFinite(Number(x.percent)) && x.at);
  } catch {}
}

function unwrap(value) {
  if (value && typeof value === 'object' && !Array.isArray(value) && 'value' in value) return value.value;
  return value;
}

function numberOrNull(value) {
  const n = Number(unwrap(value));
  return Number.isFinite(n) ? n : null;
}

function healthFor(percent) {
  if (!Number.isFinite(percent)) return 'unknown';
  if (percent <= C.criticalPercent) return 'critical';
  if (percent <= C.lowPercent) return 'low';
  return 'good';
}

function computeTrend() {
  if (!Number.isFinite(status.batteryPercent) || !status.lastReadAt || history.length < 2) return null;
  const now = new Date(status.lastReadAt).getTime();
  const target = now - 24 * 60 * 60 * 1000;
  let best = null;
  let bestDistance = Infinity;
  for (const sample of history) {
    const t = new Date(sample.at).getTime();
    if (!Number.isFinite(t) || t > now - 2 * 60 * 60 * 1000) continue;
    const distance = Math.abs(t - target);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = sample;
    }
  }
  if (!best || bestDistance > 12 * 60 * 60 * 1000) return null;
  return Math.round((status.batteryPercent - Number(best.percent)) * 10) / 10;
}

function writeStatus() {
  status.connected = Boolean(ws && ws.readyState === 1);
  status.listening = Boolean(listening);
  status.available = Number.isFinite(status.batteryPercent);
  status.health = healthFor(status.batteryPercent);
  status.samples = history.length;
  status.trend24h = computeTrend();
  atomicWrite(statusFile, { ...status, updatedAt: new Date().toISOString() });
}

function addHistory(percent, at) {
  if (!Number.isFinite(percent)) return;
  const timestamp = at || new Date().toISOString();
  const last = history.at(-1);
  const lastMs = last?.at ? new Date(last.at).getTime() : 0;
  const nowMs = new Date(timestamp).getTime();

  // Maximaal één periodieke sample per 10 minuten, maar een echte procentwijziging
  // wordt altijd vastgelegd. Zo blijft de geschiedenis klein en bruikbaar.
  if (last && Number(last.percent) === percent && nowMs - lastMs < 10 * 60 * 1000) return;

  history.push({ at: timestamp, percent });
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  history = history.filter(sample => new Date(sample.at).getTime() >= cutoff).slice(-3000);
  atomicWrite(historyFile, history);
}

function applyProperties(properties, source = 'query') {
  if (!properties || typeof properties !== 'object') throw new Error('device.get_properties gaf geen properties terug');

  const battery = numberOrNull(properties.battery);
  const temperature = numberOrNull(properties.batteryTemperature);
  const charging = numberOrNull(properties.chargingStatus);
  const wifi = numberOrNull(properties.wifiSignalLevel);

  if (battery === null || battery < 0 || battery > 100) {
    throw new Error(`battery-property ontbreekt of is ongeldig (${String(unwrap(properties.battery))})`);
  }

  const previous = status.batteryPercent;
  const now = new Date().toISOString();
  status.batteryPercent = battery;
  status.batteryTemperature = temperature;
  status.chargingStatus = charging;
  status.wifiSignalLevel = wifi;
  status.lastReadAt = now;
  status.source = source;
  status.consecutiveFailures = 0;
  status.lastError = null;
  if (previous !== battery) status.lastChangedAt = now;

  addHistory(battery, now);
  writeStatus();

  if (previous !== battery) {
    console.log(`[battery] Deurbelaccu: ${battery}%${temperature !== null ? ` · ${temperature}°C` : ''}.`);
  }
}

function applyPropertyEvent(event) {
  const name = String(event.name || '');
  if (!['battery', 'batteryTemperature', 'chargingStatus', 'wifiSignalLevel'].includes(name)) return false;

  const now = new Date().toISOString();
  const value = numberOrNull(event.value);
  if (value === null) return false;

  if (name === 'battery') {
    if (value < 0 || value > 100) return false;
    const previous = status.batteryPercent;
    status.batteryPercent = value;
    status.lastReadAt = now;
    status.source = 'property-event';
    status.consecutiveFailures = 0;
    status.lastError = null;
    if (previous !== value) {
      status.lastChangedAt = now;
      console.log(`[battery] Accu gewijzigd: ${previous ?? '?'}% -> ${value}%.`);
    }
    addHistory(value, now);
  } else if (name === 'batteryTemperature') status.batteryTemperature = value;
  else if (name === 'chargingStatus') status.chargingStatus = value;
  else if (name === 'wifiSignalLevel') status.wifiSignalLevel = value;

  writeStatus();
  return true;
}

function send(command, extra = {}, messageId = `${command}-${Date.now()}`) {
  if (!ws || ws.readyState !== 1) throw new Error('WebSocket niet verbonden');
  ws.send(JSON.stringify({ messageId, command, ...extra }));
}

function schedulePoll(delay = C.pollMs) {
  if (stopping) return;
  if (pollTimer) clearTimeout(pollTimer);
  pollTimer = setTimeout(() => {
    pollTimer = null;
    queryBattery();
  }, delay);
  pollTimer.unref?.();
}

function queryBattery() {
  if (stopping || !listening || !ws || ws.readyState !== 1 || pendingQueryId) {
    schedulePoll(Math.min(C.pollMs, 30_000));
    return;
  }

  const id = `battery-properties-${Date.now()}`;
  pendingQueryId = id;
  try {
    send('device.get_properties', { serialNumber: C.dev }, id);
    queryTimer = setTimeout(() => {
      if (pendingQueryId !== id) return;
      pendingQueryId = null;
      queryTimer = null;
      status.consecutiveFailures++;
      status.lastError = 'device.get_properties timeout';
      writeStatus();
      console.warn(`[battery] Eigenschappen opvragen timeout (${status.consecutiveFailures}).`);
      schedulePoll(Math.min(C.pollMs, 60_000));
    }, 15_000);
    queryTimer.unref?.();
  } catch (error) {
    pendingQueryId = null;
    status.consecutiveFailures++;
    status.lastError = error.message;
    writeStatus();
    schedulePoll(Math.min(C.pollMs, 60_000));
  }
}

function handle(data) {
  if (data.type === 'result' && data.messageId === 'battery-listen') {
    if (data.success === false) {
      status.lastError = data.error || data.errorCode || 'start_listening mislukt';
      writeStatus();
      return;
    }
    listening = true;
    status.listening = true;
    status.lastError = null;
    writeStatus();
    console.log('[battery] Eufy-events actief; accupercentage wordt direct opgevraagd.');
    queryBattery();
    return;
  }

  if (data.type === 'result' && pendingQueryId && data.messageId === pendingQueryId) {
    const id = pendingQueryId;
    pendingQueryId = null;
    if (queryTimer) clearTimeout(queryTimer);
    queryTimer = null;

    if (data.success === false) {
      status.consecutiveFailures++;
      status.lastError = data.error || data.errorCode || 'device.get_properties mislukt';
      writeStatus();
      console.warn(`[battery] Accu opvragen mislukt (${status.consecutiveFailures}): ${status.lastError}`);
      schedulePoll(Math.min(C.pollMs, 60_000));
      return;
    }

    try {
      applyProperties(data.properties || data.result?.properties || {}, 'device.get_properties');
    } catch (error) {
      status.consecutiveFailures++;
      status.lastError = error.message;
      writeStatus();
      console.warn(`[battery] Accuantwoord ${id} niet bruikbaar: ${error.message}`);
    }
    schedulePoll();
    return;
  }

  if (data.type !== 'event' || !data.event) return;
  const event = data.event;
  if (event.source !== 'device' || event.serialNumber !== C.dev) return;
  if (event.event === 'property changed') applyPropertyEvent(event);
}

function scheduleReconnect(delay = 3000) {
  if (stopping || reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, delay);
  reconnectTimer.unref?.();
}

function connect() {
  if (stopping || (ws && (ws.readyState === 0 || ws.readyState === 1))) return;
  if (!C.dev) {
    status.lastError = 'EUFY_SERIAL ontbreekt';
    writeStatus();
    console.error('[battery] EUFY_SERIAL ontbreekt.');
    return;
  }

  console.log(`[battery] Verbinden met ${C.ws} ...`);
  ws = new WebSocket(C.ws);

  ws.addEventListener('open', () => {
    listening = false;
    status.connected = true;
    status.listening = false;
    status.lastError = null;
    writeStatus();
    send('set_api_schema', { schemaVersion: 21 }, 'battery-schema');
    send('start_listening', {}, 'battery-listen');
  });

  ws.addEventListener('message', message => {
    try { handle(JSON.parse(typeof message.data === 'string' ? message.data : message.data.toString())); } catch {}
  });

  ws.addEventListener('close', () => {
    listening = false;
    status.connected = false;
    status.listening = false;
    status.lastError = 'WebSocket verbroken';
    writeStatus();
    if (pollTimer) clearTimeout(pollTimer);
    pollTimer = null;
    if (queryTimer) clearTimeout(queryTimer);
    queryTimer = null;
    pendingQueryId = null;
    ws = null;
    if (!stopping) scheduleReconnect();
  });

  ws.addEventListener('error', () => {
    if (!stopping) {
      status.lastError = 'WebSocket-fout';
      writeStatus();
    }
  });
}

function shutdown() {
  stopping = true;
  if (pollTimer) clearTimeout(pollTimer);
  if (reconnectTimer) clearTimeout(reconnectTimer);
  if (queryTimer) clearTimeout(queryTimer);
  status.connected = false;
  status.listening = false;
  writeStatus();
  try { ws?.close(); } catch {}
  process.exit(0);
}

fs.mkdirSync(C.data, { recursive: true });
loadHistory();
writeStatus();
console.log(`[battery] Smart battery monitor actief · interval ${Math.round(C.pollMs / 60000)} min · waarschuwing <=${C.lowPercent}% · kritiek <=${C.criticalPercent}%.`);
console.log('[battery] Alleen device-properties worden gelezen; hiervoor wordt GEEN livestream gestart.');
connect();
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
