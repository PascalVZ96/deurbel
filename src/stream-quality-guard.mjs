const serial = process.env.EUFY_SERIAL || '';
const wsUrl = process.env.EUFY_WS_URL || 'ws://127.0.0.1:3000';
const quality = Number(process.env.FORCE_STREAMING_QUALITY || 1); // 1 = Low / Low Encoding
const cooldownMs = Number(process.env.QUALITY_GUARD_COOLDOWN_MS || 10000);

let ws = null;
let reconnectTimer = null;
let handlingH265 = false;
let lastH265FixAt = 0;
let lastCodec = null;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function send(command, data = {}, messageId = `${command}-${Date.now()}`) {
  if (!ws || ws.readyState !== 1) throw new Error('Geen verbinding met eufy-security-ws');
  ws.send(JSON.stringify({ messageId, command, ...data }));
}

function forceLowEncoding() {
  if (!serial || !ws || ws.readyState !== 1) return;
  send('device.set_property', {
    serialNumber: serial,
    name: 'videoStreamingQuality',
    value: quality,
  }, `quality-low-${Date.now()}`);
  console.log(`[quality] videoStreamingQuality => ${quality} (Low / Low Encoding)`);

  // Status-led uit laten. Nachtzicht blijft ongemoeid zodat opnames in het donker bruikbaar blijven.
  send('device.set_property', {
    serialNumber: serial,
    name: 'statusLed',
    value: false,
  }, `quality-led-${Date.now()}`);
}

async function handleH265() {
  const now = Date.now();
  if (handlingH265 || now - lastH265FixAt < cooldownMs) return;
  handlingH265 = true;
  lastH265FixAt = now;
  console.warn('[quality] H265 gedetecteerd. Low Encoding opnieuw instellen en stream laten herstarten.');

  try {
    forceLowEncoding();
    await sleep(700);
    // Alleen stoppen: de viewer ziet het stop-event en start via zijn eigen herstelpad opnieuw.
    send('device.stop_livestream', { serialNumber: serial }, `quality-stop-${Date.now()}`);
  } catch (error) {
    console.warn(`[quality] H265-herstel gaf fout: ${error.message}`);
  } finally {
    handlingH265 = false;
  }
}

function handleMessage(data) {
  if (data.type === 'result') {
    if (data.messageId === 'quality-start-listening' && data.success !== false) {
      console.log('[quality] Eufy events actief; Low Encoding wordt afgedwongen.');
      forceLowEncoding();
    }
    if (String(data.messageId || '').startsWith('quality-low-') && data.success === false) {
      console.warn(`[quality] videoStreamingQuality instellen mislukt: ${data.errorCode || 'onbekend'}`);
    }
    if (String(data.messageId || '').startsWith('quality-led-') && data.success === false) {
      console.warn(`[quality] statusLed uitschakelen mislukt: ${data.errorCode || 'onbekend'}`);
    }
    return;
  }

  if (data.type !== 'event' || !data.event) return;
  const event = data.event;
  if (event.source !== 'device' || event.serialNumber !== serial) return;
  if (event.event !== 'livestream video data') return;

  const codec = String(event.metadata?.videoCodec || '').toUpperCase();
  if (!codec) return;

  if (codec !== lastCodec) {
    lastCodec = codec;
    console.log(`[quality] Codec ontvangen: ${codec}`);
  }

  if (codec.includes('265') || codec.includes('HEVC')) {
    handleH265().catch((error) => console.warn(`[quality] ${error.message}`));
  }
}

function connect() {
  if (!serial) {
    console.warn('[quality] EUFY_SERIAL ontbreekt; quality guard uitgeschakeld.');
    return;
  }
  if (ws && (ws.readyState === 0 || ws.readyState === 1)) return;

  console.log(`[quality] Verbinden met ${wsUrl} ...`);
  ws = new WebSocket(wsUrl);

  ws.addEventListener('open', () => {
    console.log('[quality] Verbonden met eufy-security-ws');
    try {
      send('set_api_schema', { schemaVersion: 21 }, 'quality-schema');
      send('start_listening', {}, 'quality-start-listening');
    } catch (error) {
      console.warn(`[quality] ${error.message}`);
    }
  });

  ws.addEventListener('message', (message) => {
    try {
      const raw = typeof message.data === 'string' ? message.data : message.data.toString();
      handleMessage(JSON.parse(raw));
    } catch {}
  });

  ws.addEventListener('close', () => {
    console.warn('[quality] WebSocket verbroken; opnieuw verbinden...');
    ws = null;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connect, 3000);
  });

  ws.addEventListener('error', () => {});
}

connect();

// Houd dit hulpproces actief.
setInterval(() => {}, 60000);
