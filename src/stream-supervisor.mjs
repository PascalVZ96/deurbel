const viewerPort = Number(process.env.VIEWER_PORT || 8092);
const viewer = `http://127.0.0.1:${viewerPort}`;
const checkEveryMs = Number(process.env.SUPERVISOR_CHECK_MS || 3000);
const unhealthyForMs = Number(process.env.SUPERVISOR_UNHEALTHY_MS || 15000);
const restartDelayMs = Number(process.env.SUPERVISOR_RESTART_DELAY_MS || 1500);

let unhealthySince = 0;
let restarting = false;
let restartCount = 0;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function getStatus() {
  const response = await fetch(`${viewer}/api/status`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`viewer status HTTP ${response.status}`);
  return response.json();
}

async function command(path) {
  const response = await fetch(`${viewer}${path}`, { method: 'POST', cache: 'no-store' });
  const text = await response.text();
  if (!response.ok) throw new Error(`${path} HTTP ${response.status}: ${text}`);
}

async function restartStream(reason) {
  if (restarting) return;
  restarting = true;
  restartCount++;
  console.warn(`[supervisor] Herstart #${restartCount}: ${reason}`);

  try {
    try { await command('/api/stop'); } catch (error) {
      console.warn(`[supervisor] Stop gaf fout: ${error.message}`);
    }

    await sleep(restartDelayMs);
    await command('/api/start');
    unhealthySince = Date.now();
  } catch (error) {
    console.error(`[supervisor] Herstart mislukt: ${error.message}`);
  } finally {
    restarting = false;
  }
}

async function check() {
  if (restarting) return;

  let status;
  try {
    status = await getStatus();
  } catch (error) {
    console.warn(`[supervisor] Viewer niet bereikbaar: ${error.message}`);
    unhealthySince = 0;
    return;
  }

  if (!status.active) {
    unhealthySince = 0;
    return;
  }

  if (status.streamHealthy) {
    unhealthySince = 0;
    return;
  }

  if (!unhealthySince) unhealthySince = Date.now();
  if (Date.now() - unhealthySince < unhealthyForMs) return;

  const reason = !status.lastFrameAt || Number(status.frames || 0) === 0
    ? 'wel videodata maar geen decodeerbare frames'
    : 'geen nieuwe liveframes meer';

  await restartStream(reason);
}

console.log(`[supervisor] Actief: controle elke ${checkEveryMs}ms, herstel na ${unhealthyForMs}ms ongezond beeld`);

// NIET unref-en: deze interval houdt het supervisorproces bewust actief.
setInterval(() => {
  check().catch((error) => console.error('[supervisor]', error));
}, checkEveryMs);

setTimeout(() => {
  check().catch((error) => console.error('[supervisor]', error));
}, 1000);
