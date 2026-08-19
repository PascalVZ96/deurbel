import fs from 'node:fs';
import path from 'node:path';

const C = {
  dev: process.env.EUFY_SERIAL || '',
  station: process.env.EUFY_STATION_SERIAL || '',
  ws: process.env.EUFY_WS_URL || 'ws://127.0.0.1:3000',
  data: process.env.DATA_DIR || '/data',
  pollMs: Math.max(60_000, Number(process.env.BATTERY_POLL_MS || 300_000)),
  chargingPollMs: Math.max(60_000, Number(process.env.BATTERY_CHARGING_POLL_MS || 120_000)),
  p2pMinMs: Math.max(300_000, Number(process.env.BATTERY_P2P_MIN_MS || 900_000)),
  p2pChargingMinMs: Math.max(120_000, Number(process.env.BATTERY_P2P_CHARGING_MIN_MS || 300_000)),
  lowPercent: Math.max(1, Math.min(99, Number(process.env.BATTERY_LOW_PERCENT || 20))),
  criticalPercent: Math.max(1, Math.min(99, Number(process.env.BATTERY_CRITICAL_PERCENT || 10))),
};

const statusFile = path.join(C.data, 'battery-status.json');
const historyFile = path.join(C.data, 'battery-history.json');
const startedAt = new Date().toISOString();

let ws = null;
let reconnectTimer = null;
let pollTimer = null;
let p2pTimer = null;
let cloudTimer = null;
let queryTimer = null;
let pendingP2PId = null;
let pendingCloudId = null;
let pendingQueryId = null;
let pendingQuerySource = null;
let stopping = false;
let listening = false;
let p2pWindowUntil = 0;

let history = [];
let status = {
  processStartedAt: startedAt,
  connected: false,
  listening: false,
  available: false,
  batteryPercent: null,
  batteryTemperature: null,
  chargingStatus: null,
  charging: false,
  wifiSignalLevel: null,
  lastReadAt: null,
  lastChangedAt: null,

  dataQuality: 'unknown',
  lastP2PRequestAt: null,
  lastP2PReadAt: null,
  lastP2PUpdateAt: null,
  lastP2PError: null,

  lastCloudRefreshAt: null,
  lastCloudRefreshError: null,
  legacyBatteryPercent: null,

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
    if (Array.isArray(saved)) {
      history = saved.filter(x => x && Number.isFinite(Number(x.percent)) && x.at);
    }
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

function isChargingStatus(value) {
  const n = Number(value);
  return n === 1 || n === 4;
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
  status.charging = isChargingStatus(status.chargingStatus);
  atomicWrite(statusFile, { ...status, updatedAt: new Date().toISOString() });
}

function addHistory(percent, at) {
  if (!Number.isFinite(percent)) return;
  const timestamp = at || new Date().toISOString();
  const last = history.at(-1);
  const lastMs = last?.at ? new Date(last.at).getTime() : 0;
  const nowMs = new Date(timestamp).getTime();

  if (last && Number(last.percent) === percent && nowMs - lastMs < 10 * 60 * 1000) return;

  history.push({ at: timestamp, percent });
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  history = history.filter(sample => new Date(sample.at).getTime() >= cutoff).slice(-3000);
  atomicWrite(historyFile, history);
}

function trustedP2PRecently() {
  const t = status.lastP2PReadAt ? new Date(status.lastP2PReadAt).getTime() : 0;
  return t > 0 && Date.now() - t < Math.max(C.p2pMinMs * 2, 60 * 60 * 1000);
}

function applyProperties(properties, source = 'query') {
  if (!properties || typeof properties !== 'object') {
    throw new Error('device.get_properties gaf geen properties terug');
  }

  const battery = numberOrNull(properties.battery);
  const temperature = numberOrNull(properties.batteryTemperature);
  const charging = numberOrNull(properties.chargingStatus);
  const wifi = numberOrNull(properties.wifiSignalLevel);

  if (battery === null || battery < 0 || battery > 100) {
    throw new Error(`battery-property ontbreekt of is ongeldig (${String(unwrap(properties.battery))})`);
  }

  const now = new Date().toISOString();
  const fromP2P = source.startsWith('p2p-');
  const fromLegacy = source.startsWith('legacy-');

  if (fromLegacy && trustedP2PRecently() && Number.isFinite(status.batteryPercent)) {
    status.legacyBatteryPercent = battery;
    status.lastCloudRefreshAt = now;
    status.source = source;
    status.lastError = null;
    status.consecutiveFailures = 0;
    writeStatus();
    if (battery !== status.batteryPercent) {
      console.log(`[battery] Legacy Eufy meldt ${battery}%, maar recente P2P-meting ${status.batteryPercent}% blijft leidend.`);
    }
    return;
  }

  const previous = status.batteryPercent;
  const previousCharging = status.charging;

  status.batteryPercent = battery;
  status.batteryTemperature = temperature;
  status.chargingStatus = charging;
  status.charging = isChargingStatus(charging);
  status.wifiSignalLevel = wifi;
  status.lastReadAt = now;
  status.source = source;
  status.consecutiveFailures = 0;
  status.lastError = null;
  if (previous !== battery) status.lastChangedAt = now;

  if (fromP2P) {
    status.lastP2PReadAt = now;
    status.lastP2PError = null;
    status.dataQuality = 'p2p';
  } else if (fromLegacy) {
    status.lastCloudRefreshAt = now;
    status.legacyBatteryPercent = battery;
    status.dataQuality = 'legacy-cloud';
  }

  addHistory(battery, now);
  writeStatus();

  if (previous !== battery || previousCharging !== status.charging) {
    const quality = fromP2P ? 'P2P' : fromLegacy ? 'legacy cloud' : source;
    console.log(`[battery] Deurbelaccu: ${battery}%${status.charging ? ' · opladen' : ''}${temperature !== null ? ` · ${temperature}°C` : ''} · bron ${quality}.`);
  }
}

function applyPropertyEvent(event) {
  const name = String(event.name || '');
  if (!['battery', 'batteryTemperature', 'chargingStatus', 'wifiSignalLevel'].includes(name)) return false;

  const now = new Date().toISOString();
  const value = numberOrNull(event.value);
  if (value === null) return false;

  const duringP2P = Date.now() <= p2pWindowUntil;
  if (name === 'battery') {
    if (value < 0 || value > 100) return false;
    const previous = status.batteryPercent;
    status.batteryPercent = value;
    status.lastReadAt = now;
    status.source = duringP2P ? 'p2p-property-event' : 'property-event';
    status.consecutiveFailures = 0;
    status.lastError = null;

    if (duringP2P) {
      status.lastP2PUpdateAt = now;
      status.lastP2PReadAt = now;
      status.lastP2PError = null;
      status.dataQuality = 'p2p';
    }

    if (previous !== value) {
      status.lastChangedAt = now;
      console.log(`[battery] Accu gewijzigd: ${previous ?? '?'}% -> ${value}%${duringP2P ? ' via P2P' : ''}.`);
    }
    addHistory(value, now);
  } else if (name === 'batteryTemperature') {
    status.batteryTemperature = value;
    if (duringP2P) status.lastP2PUpdateAt = now;
  } else if (name === 'chargingStatus') {
    const wasCharging = status.charging;
    status.chargingStatus = value;
    status.charging = isChargingStatus(value);
    if (duringP2P) {
      status.lastP2PUpdateAt = now;
      status.dataQuality = 'p2p';
    }
    if (wasCharging !== status.charging) {
      console.log(`[battery] Laadstatus: ${status.charging ? 'opladen' : `niet opladen (raw ${value})`}${duringP2P ? ' via P2P' : ''}.`);
    }
  } else if (name === 'wifiSignalLevel') {
    status.wifiSignalLevel = value;
  }

  writeStatus();
  return true;
}

function send(command, extra = {}, messageId = `${command}-${Date.now()}`) {
  if (!ws || ws.readyState !== 1) throw new Error('WebSocket niet verbonden');
  ws.send(JSON.stringify({ messageId, command, ...extra }));
}

function nextPollDelay() {
  return status.charging ? C.chargingPollMs : C.pollMs;
}

function p2pMinDelay() {
  return status.charging ? C.p2pChargingMinMs : C.p2pMinMs;
}

function p2pDue() {
  const t = status.lastP2PRequestAt ? new Date(status.lastP2PRequestAt).getTime() : 0;
  return !t || Date.now() - t >= p2pMinDelay();
}

function schedulePoll(delay = nextPollDelay()) {
  if (stopping) return;
  if (pollTimer) clearTimeout(pollTimer);
  pollTimer = setTimeout(() => {
    pollTimer = null;
    pollBattery();
  }, delay);
  pollTimer.unref?.();
}

function clearP2PTimer() {
  if (p2pTimer) clearTimeout(p2pTimer);
  p2pTimer = null;
}

function clearCloudTimer() {
  if (cloudTimer) clearTimeout(cloudTimer);
  cloudTimer = null;
}

function clearQueryTimer() {
  if (queryTimer) clearTimeout(queryTimer);
  queryTimer = null;
}

function queryProperties(source) {
  if (stopping || !listening || !ws || ws.readyState !== 1 || pendingQueryId) {
    schedulePoll(Math.min(nextPollDelay(), 30_000));
    return;
  }

  const id = `battery-properties-${Date.now()}`;
  pendingQueryId = id;
  pendingQuerySource = source;

  try {
    send('device.get_properties', { serialNumber: C.dev }, id);
    queryTimer = setTimeout(() => {
      if (pendingQueryId !== id) return;
      pendingQueryId = null;
      pendingQuerySource = null;
      queryTimer = null;

      if (source.startsWith('p2p-')) {
        status.lastP2PError = 'device.get_properties timeout na P2P refresh';
      } else {
        status.lastCloudRefreshError = 'device.get_properties timeout';
      }

      if (!Number.isFinite(status.batteryPercent)) {
        status.consecutiveFailures++;
        status.lastError = 'device.get_properties timeout';
      }
      writeStatus();
      schedulePoll(Math.min(nextPollDelay(), 60_000));
    }, 15_000);
    queryTimer.unref?.();
  } catch (error) {
    pendingQueryId = null;
    pendingQuerySource = null;
    if (!Number.isFinite(status.batteryPercent)) {
      status.consecutiveFailures++;
      status.lastError = error.message;
    }
    if (source.startsWith('p2p-')) status.lastP2PError = error.message;
    else status.lastCloudRefreshError = error.message;
    writeStatus();
    schedulePoll(Math.min(nextPollDelay(), 60_000));
  }
}

function requestLegacyCloudFallback(reason) {
  if (stopping || !listening || !ws || ws.readyState !== 1 || pendingCloudId || pendingQueryId) {
    schedulePoll(Math.min(nextPollDelay(), 30_000));
    return;
  }

  const id = `battery-cloud-${Date.now()}`;
  pendingCloudId = id;
  try {
    send('driver.poll_refresh', {}, id);
    cloudTimer = setTimeout(() => {
      if (pendingCloudId !== id) return;
      pendingCloudId = null;
      cloudTimer = null;
      status.lastCloudRefreshError = `driver.poll_refresh timeout (${reason})`;
      writeStatus();
      if (!Number.isFinite(status.batteryPercent)) queryProperties('legacy-cache-after-timeout');
      else schedulePoll();
    }, 30_000);
    cloudTimer.unref?.();
  } catch (error) {
    pendingCloudId = null;
    status.lastCloudRefreshError = error.message;
    writeStatus();
    if (!Number.isFinite(status.batteryPercent)) queryProperties('legacy-cache-after-error');
    else schedulePoll();
  }
}

function requestP2PRefresh() {
  if (!C.station) {
    status.lastP2PError = 'EUFY_STATION_SERIAL ontbreekt';
    writeStatus();
    requestLegacyCloudFallback('geen HomeBase serienummer');
    return;
  }

  if (stopping || !listening || !ws || ws.readyState !== 1 || pendingP2PId || pendingQueryId) {
    schedulePoll(Math.min(nextPollDelay(), 30_000));
    return;
  }

  const id = `battery-p2p-${Date.now()}`;
  pendingP2PId = id;
  status.lastP2PRequestAt = new Date().toISOString();
  status.lastP2PError = null;
  p2pWindowUntil = Date.now() + 12_000;
  writeStatus();

  try {
    send('station.get_camera_info', { serialNumber: C.station }, id);
    p2pTimer = setTimeout(() => {
      if (pendingP2PId !== id) return;
      pendingP2PId = null;
      p2pTimer = null;
      status.lastP2PError = 'station.get_camera_info timeout';
      writeStatus();
      console.warn('[battery] P2P camera-info timeout; legacy cloud alleen als fallback.');
      if (!Number.isFinite(status.batteryPercent)) requestLegacyCloudFallback('P2P timeout');
      else schedulePoll();
    }, 15_000);
    p2pTimer.unref?.();
  } catch (error) {
    pendingP2PId = null;
    status.lastP2PError = error.message;
    writeStatus();
    if (!Number.isFinite(status.batteryPercent)) requestLegacyCloudFallback('P2P send-fout');
    else schedulePoll();
  }
}

function pollBattery() {
  if (stopping || !listening || !ws || ws.readyState !== 1) {
    schedulePoll(30_000);
    return;
  }

  if (p2pDue()) {
    requestP2PRefresh();
    return;
  }

  // We houden een recente P2P-waarde vast en laten de bekende achterlopende
  // legacy-cloudwaarde die niet overschrijven.
  schedulePoll();
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
    console.log('[battery] Eufy-events actief; directe HomeBase P2P-meting is nu de primaire accubron.');
    pollBattery();
    return;
  }

  if (data.type === 'result' && pendingP2PId && data.messageId === pendingP2PId) {
    pendingP2PId = null;
    clearP2PTimer();

    if (data.success === false) {
      status.lastP2PError = data.error || data.errorCode || 'station.get_camera_info mislukt';
      writeStatus();
      console.warn(`[battery] P2P camera-info mislukt: ${status.lastP2PError}`);
      if (!Number.isFinite(status.batteryPercent)) requestLegacyCloudFallback('P2P fout');
      else schedulePoll();
      return;
    }

    // get_camera_info is async: de HomeBase verwerkt eerst de P2P-camera-info.
    // Daarna lezen we de door eufy-security-client bijgewerkte device-properties.
    setTimeout(() => queryProperties('p2p-camera-info'), 1800).unref?.();
    return;
  }

  if (data.type === 'result' && pendingCloudId && data.messageId === pendingCloudId) {
    pendingCloudId = null;
    clearCloudTimer();

    if (data.success === false) {
      status.lastCloudRefreshError = data.error || data.errorCode || 'driver.poll_refresh mislukt';
      writeStatus();
      if (!Number.isFinite(status.batteryPercent)) queryProperties('legacy-cache-after-error');
      else schedulePoll();
      return;
    }

    status.lastCloudRefreshAt = new Date().toISOString();
    status.lastCloudRefreshError = null;
    writeStatus();
    setTimeout(() => queryProperties('legacy-cloud-refresh'), 350).unref?.();
    return;
  }

  if (data.type === 'result' && pendingQueryId && data.messageId === pendingQueryId) {
    const id = pendingQueryId;
    const source = pendingQuerySource || 'query';
    pendingQueryId = null;
    pendingQuerySource = null;
    clearQueryTimer();

    if (data.success === false) {
      const errorText = data.error || data.errorCode || 'device.get_properties mislukt';
      if (source.startsWith('p2p-')) status.lastP2PError = errorText;
      else status.lastCloudRefreshError = errorText;

      if (!Number.isFinite(status.batteryPercent)) {
        status.consecutiveFailures++;
        status.lastError = errorText;
      }
      writeStatus();

      if (source.startsWith('p2p-') && !Number.isFinite(status.batteryPercent)) {
        requestLegacyCloudFallback('P2P property-query fout');
      } else {
        schedulePoll(Math.min(nextPollDelay(), 60_000));
      }
      return;
    }

    try {
      applyProperties(data.properties || data.result?.properties || {}, source);
    } catch (error) {
      if (source.startsWith('p2p-')) status.lastP2PError = error.message;
      else status.lastCloudRefreshError = error.message;

      if (!Number.isFinite(status.batteryPercent)) {
        status.consecutiveFailures++;
        status.lastError = error.message;
      }
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
    try {
      handle(JSON.parse(typeof message.data === 'string' ? message.data : message.data.toString()));
    } catch {}
  });

  ws.addEventListener('close', () => {
    listening = false;
    status.connected = false;
    status.listening = false;
    status.lastError = 'WebSocket verbroken';
    writeStatus();

    if (pollTimer) clearTimeout(pollTimer);
    pollTimer = null;
    clearP2PTimer();
    clearCloudTimer();
    clearQueryTimer();
    pendingP2PId = null;
    pendingCloudId = null;
    pendingQueryId = null;
    pendingQuerySource = null;
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
  clearP2PTimer();
  clearCloudTimer();
  clearQueryTimer();
  status.connected = false;
  status.listening = false;
  writeStatus();
  try { ws?.close(); } catch {}
  process.exit(0);
}

fs.mkdirSync(C.data, { recursive: true });
loadHistory();
writeStatus();
console.log(`[battery] Smart battery monitor actief · controlecyclus normaal ${Math.round(C.pollMs / 60000)} min · tijdens opladen ${Math.round(C.chargingPollMs / 60000)} min.`);
console.log(`[battery] Directe HomeBase P2P-camera-info is primair · P2P minimaal elke ${Math.round(C.p2pMinMs / 60000)} min, tijdens opladen ${Math.round(C.p2pChargingMinMs / 60000)} min.`);
console.log('[battery] Legacy Eufy Cloud wordt alleen fallback en mag een recente P2P-meting niet overschrijven.');
console.log('[battery] Hiervoor wordt GEEN livestream gestart.');
connect();
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
