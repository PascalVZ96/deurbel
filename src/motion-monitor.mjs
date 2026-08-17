const config = {
  serial: process.env.EUFY_SERIAL || '',
  wsUrl: process.env.EUFY_WS_URL || 'ws://127.0.0.1:3000',
  triggerUrl: process.env.SECURITY_TRIGGER_URL || 'http://127.0.0.1:8090/api/trigger',
  cooldownMs: Math.max(1000, Number(process.env.MOTION_TRIGGER_COOLDOWN_MS || 3000)),
};

let ws = null;
let reconnectTimer = null;
let lastTriggerAt = 0;
let triggerInFlight = false;

function send(command, data = {}, messageId = `${command}-${Date.now()}`) {
  if (!ws || ws.readyState !== 1) throw new Error('Geen verbinding met eufy-security-ws');
  ws.send(JSON.stringify({ messageId, command, ...data }));
}

function truthy(value) {
  return value === true || value === 1 || value === '1' || value === 'true';
}

function triggerSource(eventName) {
  if (eventName.includes('person')) return 'eufy-person';
  return 'eufy-motion';
}

async function triggerSecurity(source, eventName) {
  const now = Date.now();
  if (triggerInFlight || now - lastTriggerAt < config.cooldownMs) return;

  lastTriggerAt = now;
  triggerInFlight = true;

  try {
    const separator = config.triggerUrl.includes('?') ? '&' : '?';
    const url = `${config.triggerUrl}${separator}source=${encodeURIComponent(source)}`;
    const response = await fetch(url, { method:'POST', cache:'no-store' });
    let data = {};
    try { data = await response.json(); } catch {}

    if (response.ok) {
      console.log(`[motion] ${eventName} => beveiliging getriggerd (${data.started ? 'opname gestart' : data.extended ? 'opname verlengd' : 'ok'})`);
      return;
    }

    if (response.status === 409 && String(data.error || '').toLowerCase().includes('beveiliging staat uit')) {
      console.log(`[motion] ${eventName} gezien; beveiliging staat uit, dus geen opname.`);
      return;
    }

    console.warn(`[motion] Trigger geweigerd: HTTP ${response.status} ${data.error || ''}`.trim());
  } catch (error) {
    console.warn(`[motion] Trigger naar beveiligingsdashboard mislukt: ${error.message}`);
  } finally {
    triggerInFlight = false;
  }
}

function handleEvent(message) {
  if (message?.type !== 'event' || !message.event) return;
  const event = message.event;
  if (event.source !== 'device' || event.serialNumber !== config.serial) return;

  const directEvents = new Set([
    'motion detected',
    'person detected',
    'stranger person detected',
  ]);

  if (directEvents.has(event.event) && truthy(event.state)) {
    console.log(`[motion] Eufy event: ${event.event}`);
    void triggerSecurity(triggerSource(event.event), event.event);
    return;
  }

  // Sommige versies geven dezelfde detectie als property change door.
  if (event.event === 'property changed') {
    const name = String(event.name || '');
    if ((name === 'motionDetected' || name === 'personDetected') && truthy(event.value)) {
      const eventName = name === 'personDetected' ? 'person detected (property)' : 'motion detected (property)';
      console.log(`[motion] Eufy property: ${name}=true`);
      void triggerSecurity(triggerSource(eventName), eventName);
    }
  }
}

function connect() {
  if (!config.serial) {
    console.error('[motion] EUFY_SERIAL ontbreekt; automatische bewegingstrigger is uitgeschakeld.');
    return;
  }

  if (ws && (ws.readyState === 0 || ws.readyState === 1)) return;

  console.log(`[motion] Verbinden met ${config.wsUrl} ...`);
  ws = new WebSocket(config.wsUrl);

  ws.addEventListener('open', () => {
    console.log('[motion] Verbonden met eufy-security-ws');
    try {
      send('set_api_schema', { schemaVersion:21 }, 'motion-schema');
      send('start_listening', {}, 'motion-start-listening');
    } catch (error) {
      console.warn(`[motion] Start luisteren mislukt: ${error.message}`);
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

    if (data?.type === 'result' && data.messageId === 'motion-start-listening') {
      if (data.success === false) console.warn(`[motion] Eufy events activeren mislukt: ${data.errorCode || 'onbekend'}`);
      else console.log('[motion] Automatische Eufy-bewegingsdetectie actief.');
      return;
    }

    handleEvent(data);
  });

  ws.addEventListener('close', () => {
    console.warn('[motion] WebSocket verbroken; over 3s opnieuw verbinden.');
    ws = null;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connect, 3000);
  });

  ws.addEventListener('error', () => {
    console.warn('[motion] WebSocket-fout met eufy-security-ws');
  });
}

console.log(`[motion] Automatische trigger: Eufy beweging/persoon -> ${config.triggerUrl}`);
console.log(`[motion] Cooldown tussen dubbele events: ${config.cooldownMs}ms`);
connect();

process.on('SIGTERM', () => {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  try { ws?.close(); } catch {}
  process.exit(0);
});

process.on('SIGINT', () => {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  try { ws?.close(); } catch {}
  process.exit(0);
});
