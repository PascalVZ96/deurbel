import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';

const dataDir = process.env.DATA_DIR || '/data';
const frigateUrl = String(
  process.env.FRIGATE_URL || 'http://127.0.0.1:5000'
).replace(/\/+$/, '');
const pollMs = Math.max(5000, Number(process.env.SPOOKY_LOGBOOK_POLL_MS || 15000));
const logbookFile = path.join(dataDir, 'spooky-logbook.json');
const fallbackFile = path.join(dataDir, 'frigate-genai-fallback.json');

fs.mkdirSync(dataDir, { recursive:true });

function emptyState(){
  return {
    version:1,
    createdAt:new Date().toISOString(),
    updatedAt:null,
    lastPollAt:null,
    lastSuccessAt:null,
    lastError:null,
    events:[]
  };
}

function loadState(){
  try {
    const parsed = JSON.parse(fs.readFileSync(logbookFile, 'utf8'));
    parsed.version ||= 1;
    parsed.events = Array.isArray(parsed.events) ? parsed.events : [];
    return parsed;
  } catch {
    return emptyState();
  }
}

let state = loadState();
let busy = false;

function saveState(){
  const tmp = logbookFile + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, logbookFile);
}

function loadFallback(){
  try {
    const parsed = JSON.parse(fs.readFileSync(fallbackFile, 'utf8'));
    return parsed?.items || parsed || {};
  } catch {
    return {};
  }
}

function hasAiText(meta){
  return Boolean(
    meta?.title ||
    meta?.scene ||
    meta?.shortSummary ||
    meta?.short_summary
  );
}

function metadataForReview(review, fallback){
  const native = review?.data?.metadata || {};
  if (hasAiText(native)) return native;

  const item = fallback?.[review?.id];
  if (item?.status === 'done' && hasAiText(item)) return item;

  return native;
}

function allText(meta){
  return [
    meta?.title,
    meta?.shortSummary,
    meta?.short_summary,
    meta?.scene
  ].filter(Boolean).join(' ');
}

function isSpooky(meta){
  return /\bspooky\b/i.test(allText(meta));
}

function isEating(meta){
  return /\beet\b|\beten\b|\bgegeten\b|eetmoment|voerhouding/i.test(allText(meta));
}

function normalizeObjects(review){
  const objects = review?.data?.objects ?? review?.objects ?? [];
  if (Array.isArray(objects)) return objects.map(String);
  return objects ? [String(objects)] : [];
}

function normalizeEvent(review, meta, previous){
  const now = new Date().toISOString();
  return {
    reviewId:String(review.id),
    startTime:review?.start_time ?? review?.startTime ?? previous?.startTime ?? null,
    endTime:review?.end_time ?? review?.endTime ?? previous?.endTime ?? null,
    title:meta?.title || previous?.title || null,
    shortSummary:meta?.shortSummary ?? meta?.short_summary ?? previous?.shortSummary ?? null,
    scene:meta?.scene || previous?.scene || null,
    confidence:meta?.confidence ?? previous?.confidence ?? null,
    potentialThreatLevel:
      meta?.potential_threat_level ??
      meta?.potentialThreatLevel ??
      previous?.potentialThreatLevel ??
      null,
    objects:normalizeObjects(review),
    eating:isEating(meta),
    firstSeenAt:previous?.firstSeenAt || now,
    updatedAt:now
  };
}

function sameEvent(a, b){
  const keys = [
    'startTime','endTime','title','shortSummary','scene','confidence',
    'potentialThreatLevel','eating'
  ];

  return keys.every(key => JSON.stringify(a?.[key]) === JSON.stringify(b?.[key])) &&
    JSON.stringify(a?.objects || []) === JSON.stringify(b?.objects || []);
}

async function fetchReviews(){
  const response = await fetch(
    frigateUrl + '/api/review?cameras=petfeeder&limit=100',
    {
      cache:'no-store',
      signal:AbortSignal.timeout(10000)
    }
  );

  if (!response.ok) {
    throw new Error(`Frigate HTTP ${response.status}`);
  }

  const raw = await response.json();
  return Array.isArray(raw)
    ? raw
    : Array.isArray(raw?.reviews)
      ? raw.reviews
      : [];
}

async function collect(){
  if (busy) return;
  busy = true;
  state.lastPollAt = new Date().toISOString();

  try {
    const reviews = await fetchReviews();
    const fallback = loadFallback();
    const byId = new Map(
      state.events.map(event => [String(event.reviewId), event])
    );

    let changed = false;
    let added = 0;
    let updated = 0;

    for (const review of reviews) {
      if (!review?.id) continue;

      const meta = metadataForReview(review, fallback);
      if (!hasAiText(meta) || !isSpooky(meta)) continue;

      const id = String(review.id);
      const previous = byId.get(id);
      const next = normalizeEvent(review, meta, previous);

      if (!previous) {
        byId.set(id, next);
        changed = true;
        added++;
        continue;
      }

      if (!sameEvent(previous, next)) {
        byId.set(id, next);
        changed = true;
        updated++;
      }
    }

    if (changed) {
      state.events = [...byId.values()].sort((a,b) => {
        const aa = Number(a.startTime || 0);
        const bb = Number(b.startTime || 0);
        return bb - aa;
      });
      state.updatedAt = new Date().toISOString();
    }

    state.lastSuccessAt = new Date().toISOString();
    state.lastError = null;
    saveState();

    if (added || updated) {
      console.log(
        `[spooky-logbook] ${added} nieuw, ${updated} bijgewerkt · totaal ${state.events.length}`
      );
    }
  } catch (error) {
    state.lastError = error.message;
    try { saveState(); } catch {}
    console.warn(`[spooky-logbook] ${error.message}`);
  } finally {
    busy = false;
  }
}

function publicSnapshot(){
  return {
    available:true,
    version:state.version,
    count:state.events.length,
    createdAt:state.createdAt,
    updatedAt:state.updatedAt,
    lastPollAt:state.lastPollAt,
    lastSuccessAt:state.lastSuccessAt,
    lastError:state.lastError,
    events:state.events
  };
}

const previousCreateServer = http.createServer.bind(http);

http.createServer = function spookyLogbookCreateServer(options, requestListener) {
  let actualOptions = options;
  let actualListener = requestListener;

  if (typeof options === 'function') {
    actualListener = options;
    actualOptions = undefined;
  }

  const wrapped = async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

      if (req.method === 'GET' && url.pathname === '/api/spooky/logbook') {
        const body = JSON.stringify(publicSnapshot());
        res.writeHead(200, {
          'Content-Type':'application/json; charset=utf-8',
          'Content-Length':Buffer.byteLength(body),
          'Cache-Control':'no-store'
        });
        res.end(body);
        return;
      }
    } catch {}

    return actualListener(req, res);
  };

  return actualOptions === undefined
    ? previousCreateServer(wrapped)
    : previousCreateServer(actualOptions, wrapped);
};

console.log(
  `[spooky-logbook] Actief · ${state.events.length} opgeslagen gebeurtenissen · poll ${pollMs} ms`
);

void collect();
setInterval(() => { void collect(); }, pollMs).unref();
