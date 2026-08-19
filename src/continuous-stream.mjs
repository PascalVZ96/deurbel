const viewerPort = Number(process.env.VIEWER_PORT || 8092);
const viewer = `http://127.0.0.1:${viewerPort}`;
const checkEveryMs = Math.max(2000, Number(process.env.CONTINUOUS_STREAM_CHECK_MS || 5000));

let starting = false;
let lastWaitLogAt = 0;

async function getStatus() {
  const response = await fetch(`${viewer}/api/status`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`viewer status HTTP ${response.status}`);
  return response.json();
}

async function startStream() {
  if (starting) return;
  starting = true;
  try {
    const response = await fetch(`${viewer}/api/start`, { method: 'POST', cache: 'no-store' });
    const text = await response.text();
    if (!response.ok) throw new Error(`/api/start HTTP ${response.status}: ${text}`);
    console.log('[continuous] 24/7-stream gestart.');
  } finally {
    starting = false;
  }
}

async function ensureContinuousStream() {
  let status;
  try {
    status = await getStatus();
  } catch (error) {
    const now = Date.now();
    if (now - lastWaitLogAt > 30000) {
      lastWaitLogAt = now;
      console.warn(`[continuous] Viewer nog niet bereikbaar: ${error.message}`);
    }
    return;
  }

  if (!status.wsConnected || !status.listening || !status.serialConfigured) {
    const now = Date.now();
    if (now - lastWaitLogAt > 30000) {
      lastWaitLogAt = now;
      console.log('[continuous] Wacht op eufy-security-ws voordat de 24/7-stream wordt gestart.');
    }
    return;
  }

  if (status.active) return;

  try {
    await startStream();
  } catch (error) {
    console.warn(`[continuous] Startpoging mislukt: ${error.message}`);
  }
}

console.log(`[continuous] 24/7-modus actief · controle elke ${Math.round(checkEveryMs / 1000)}s.`);
console.log('[continuous] De bestaande stream-supervisor bewaakt vastgelopen beeld; deze monitor zorgt dat de stream nooit bewust uit blijft.');

setInterval(() => {
  ensureContinuousStream().catch(error => console.warn('[continuous]', error.message));
}, checkEveryMs);

setTimeout(() => {
  ensureContinuousStream().catch(error => console.warn('[continuous]', error.message));
}, 1500);
