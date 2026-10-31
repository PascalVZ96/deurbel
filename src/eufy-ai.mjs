import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const cfg = {
  recordingsDir: process.env.RECORDINGS_DIR || '/recordings',
  dataDir: process.env.DATA_DIR || '/data',
  apiKey: process.env.GEMINI_API_KEY || process.env.FRIGATE_GEMINI_API_KEY || '',
  model: process.env.GEMINI_MODEL || 'gemini-3.6-flash',
  pollMs: Math.max(5000, Number(process.env.EUFY_AI_POLL_MS || 5000)),
  retryMs: Math.max(60000, Number(process.env.EUFY_AI_RETRY_MS || 900000)),
  maxFrames: Math.max(3, Math.min(8, Number(process.env.EUFY_AI_MAX_FRAMES || 6))),
  maxPerDay: Math.max(1, Math.min(10, Number(process.env.EUFY_AI_MAX_PER_DAY || 5))),
};

const stateFile = path.join(cfg.dataDir, 'eufy-ai.json');
const workDir = path.join(cfg.dataDir, 'eufy-ai-work');
const manualRequestFile = path.join(cfg.dataDir, 'eufy-ai-manual-request.json');
const manualResultFile = path.join(cfg.dataDir, 'eufy-ai-manual-result.json');

fs.mkdirSync(cfg.dataDir, { recursive:true });
fs.mkdirSync(workDir, { recursive:true });

function defaultState() {
  return {
    version:1,
    initialized:false,
    enabled:true,
    model:cfg.model,
    lastRunAt:null,
    lastError:null,
    items:{},
  };
}

function loadState() {
  try {
    const s = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    s.items ||= {};
    s.model = cfg.model;
    return s;
  } catch {
    return defaultState();
  }
}

let state = loadState();
let busy = false;

function saveState() {
  state.model = cfg.model;
  const tmp = stateFile + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, stateFile);
}

function listClips() {
  try {
    return fs.readdirSync(cfg.recordingsDir)
      .filter(name => /_eufy-original[.]mp4$/i.test(name))
      .map(name => {
        const file = path.join(cfg.recordingsDir, name);
        try {
          const stat = fs.statSync(file);
          return stat.size > 0 ? {
            name,
            file,
            size:stat.size,
            mtimeMs:stat.mtimeMs,
            createdAt:stat.mtime.toISOString(),
          } : null;
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .sort((a,b) => a.mtimeMs - b.mtimeMs);
  } catch {
    return [];
  }
}

function command(program, args) {
  const r = spawnSync(program, args, {
    encoding:'utf8',
    maxBuffer:10 * 1024 * 1024,
  });

  if (r.error) throw r.error;

  if (r.status !== 0) {
    throw new Error(
      (r.stderr || r.stdout || `${program} mislukt`).trim().slice(-2000)
    );
  }

  return (r.stdout || '').trim();
}

function getDuration(file) {
  const text = command('ffprobe', [
    '-v','error',
    '-show_entries','format=duration',
    '-of','default=noprint_wrappers=1:nokey=1',
    file,
  ]);

  const duration = Number(text);

  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error('Kon videoduur niet bepalen');
  }

  return duration;
}

function frameTimes(duration) {
  const last = Math.max(0.2, duration - 0.5);

  const candidates = [
    Math.min(0.7, duration * 0.08),
    duration * 0.20,
    duration * 0.40,
    duration * 0.60,
    duration * 0.80,
    last,
  ];

  const unique = [];

  for (const t of candidates) {
    const n = Math.max(0, Math.min(duration - 0.05, t));
    if (!unique.some(x => Math.abs(x - n) < 0.25)) unique.push(n);
  }

  return unique.slice(0, cfg.maxFrames);
}

function extractFrames(clip) {
  const duration = getDuration(clip.file);
  const times = frameTimes(duration);
  const safe = clip.name.replace(/[^A-Za-z0-9_-]/g, '_');
  const frames = [];

  for (let i = 0; i < times.length; i++) {
    const out = path.join(workDir, `${safe}-${i}.jpg`);

    try { fs.unlinkSync(out); } catch {}

    command('ffmpeg', [
      '-hide_banner',
      '-loglevel','error',
      '-ss',String(times[i]),
      '-i',clip.file,
      '-frames:v','1',
      '-vf','scale=960:-2',
      '-q:v','4',
      '-y',out,
    ]);

    if (fs.existsSync(out) && fs.statSync(out).size > 1000) {
      frames.push({
        file:out,
        time:times[i],
        data:fs.readFileSync(out).toString('base64'),
      });
    }
  }

  if (!frames.length) {
    throw new Error('Geen bruikbare videoframes gevonden');
  }

  return { duration, frames };
}

function cleanJsonText(text) {
  let t = String(text || '').trim();

  t = t
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  try {
    return JSON.parse(t);
  } catch {}

  const first = t.indexOf('{');
  const last = t.lastIndexOf('}');

  if (first >= 0 && last > first) {
    return JSON.parse(t.slice(first, last + 1));
  }

  throw new Error('Gemini gaf geen geldige JSON terug');
}

function clamp(value, min, max) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : null;
}

async function askGemini(clip, sampled) {
  const parts = [{
    text:
`Je analyseert beelden van een Eufy-videodeurbel bij een voordeur.
De beelden staan chronologisch en komen uit één bewegingsopname.

Beschrijf in het Nederlands feitelijk wat er gedurende de opname gebeurt.
Let bijvoorbeeld op:
- iemand die aankomt of wegloopt;
- aanbellen of voor de deur wachten als dit echt zichtbaar is;
- pakketjes of voorwerpen die worden gedragen, neergezet of meegenomen;
- meerdere personen;
- dieren of voertuigen als die relevant zijn.

Identificeer geen personen en doe geen aannames over intenties, emoties of identiteit.
Beschrijf alleen wat daadwerkelijk zichtbaar is.

Geef uitsluitend JSON met exact deze velden:
{
  "title": "korte titel",
  "shortSummary": "korte samenvatting",
  "scene": "volledige chronologische beschrijving",
  "confidence": 0.0,
  "potential_threat_level": 0,
  "other_concerns": null
}

confidence is 0 tot 1.
potential_threat_level is 0 tot 3, waarbij 0 normale activiteit is.`
  }];

  sampled.frames.forEach((frame, index) => {
    parts.push({
      text:`Beeld ${index + 1} rond ${frame.time.toFixed(1)} seconden:`
    });

    parts.push({
      inlineData:{
        mimeType:'image/jpeg',
        data:frame.data,
      }
    });
  });

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${cfg.model}:generateContent`,
    {
      method:'POST',
      headers:{
        'Content-Type':'application/json',
        'x-goog-api-key':cfg.apiKey,
      },
      body:JSON.stringify({
        contents:[{
          role:'user',
          parts,
        }],
        generationConfig:{
          temperature:0.2,
          responseMimeType:'application/json',
        },
      }),
      signal:AbortSignal.timeout(90000),
    }
  );

  const body = await response.text();

  if (!response.ok) {
    throw new Error(
      `Gemini HTTP ${response.status}: ${body.slice(0,600)}`
    );
  }

  const result = JSON.parse(body);
  const text = (result.candidates?.[0]?.content?.parts || [])
    .map(p => p.text || '')
    .join('');

  const ai = cleanJsonText(text);

  return {
    title:String(ai.title || 'Gebeurtenis bij voordeur').slice(0,200),
    shortSummary:String(ai.shortSummary || '').slice(0,1000),
    scene:String(ai.scene || '').slice(0,4000),
    confidence:clamp(ai.confidence, 0, 1),
    potential_threat_level:clamp(ai.potential_threat_level, 0, 3),
    other_concerns:ai.other_concerns ?? null,
  };
}

function cleanupFrames(sampled) {
  for (const frame of sampled?.frames || []) {
    try { fs.unlinkSync(frame.file); } catch {}
  }
}

async function analyze(clip) {
  const old = state.items[clip.name] || {};
  const attempts = Number(old.attempts || 0) + 1;

  state.items[clip.name] = {
    ...old,
    recordingFile:clip.name,
    createdAt:clip.createdAt,
    status:'processing',
    attempts,
    lastAttemptAt:new Date().toISOString(),
  };

  saveState();

  console.log(`[eufy-ai] Analyse gestart: ${clip.name}`);

  let sampled;

  try {
    sampled = extractFrames(clip);
    // Reserve the API attempt before sending images; even failed calls count.
    state.apiCallsCount = Number(state.apiCallsCount || 0) + 1;
    saveState();
    const ai = await askGemini(clip, sampled);

    const jpg = clip.name.replace(/[.]mp4$/i, '.jpg');

    state.items[clip.name] = {
      recordingFile:clip.name,
      createdAt:clip.createdAt,
      analyzedAt:new Date().toISOString(),
      status:'done',
      attempts,
      durationSeconds:Math.round(sampled.duration * 10) / 10,
      frameCount:sampled.frames.length,
      videoUrl:`/recordings/${encodeURIComponent(clip.name)}`,
      thumbnailUrl:fs.existsSync(path.join(cfg.recordingsDir, jpg))
        ? `/recordings/${encodeURIComponent(jpg)}`
        : null,
      ...ai,
    };

    state.lastError = null;
    state.lastRunAt = new Date().toISOString();
    saveState();

    console.log(`[eufy-ai] Klaar: ${ai.title}`);
  } catch (error) {
    state.items[clip.name] = {
      ...state.items[clip.name],
      status:'error',
      error:error.message,
      nextRetryAt:new Date(Date.now() + cfg.retryMs).toISOString(),
    };

    state.lastError = error.message;
    state.lastRunAt = new Date().toISOString();
    saveState();

    console.warn(`[eufy-ai] Analyse mislukt: ${error.message}`);
  } finally {
    cleanupFrames(sampled);
  }
}


function writeManualResult(result) {
  const tmp = manualResultFile + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(result,null,2));
  fs.renameSync(tmp,manualResultFile);
}

// Deliberately separate from automatic detection of fresh recordings.
// One pre-existing HomeBase clip can be analyzed on explicit request only.
async function analyzeManualRequest(clips) {
  if (!fs.existsSync(manualRequestFile)) return false;

  let request;
  try {
    request = JSON.parse(fs.readFileSync(manualRequestFile,'utf8'));
  } catch (error) {
    console.warn('[eufy-ai] Handmatige aanvraag ongeldig: ' + error.message);
    try { fs.unlinkSync(manualRequestFile); } catch {}
    writeManualResult({ok:false,error:'Ongeldige handmatige aanvraag.'});
    return true;
  }

  const name = String(request?.file || '');
  const result = {
    file:name,
    requestedAt:request?.requestedAt || null,
    processedAt:new Date().toISOString(),
    ok:false, status:'rejected', title:null, error:null
  };

  // Consume the request BEFORE any network call. A restart must never
  // send the same historical clip again automatically.
  try { fs.unlinkSync(manualRequestFile); } catch {}

  const allowedName = /^motion_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}_eufy-original[.]mp4$/i.test(name);
  const clip = allowedName ? clips.find(item => item.name === name) : null;
  const previous = state.items[name];

  if (!clip) {
    result.error='Opname niet gevonden of ongeldige bestandsnaam.';
  } else if (previous?.status === 'done') {
    result.ok=true;
    result.status='already-done';
    result.title=previous.title || null;
  } else if (Number(state.apiCallsCount || 0) >= cfg.maxPerDay) {
    result.error='Daglimiet voor Gemini bereikt. Vraag later opnieuw aan.';
  } else if (Number(previous?.attempts || 0) >= 3) {
    result.error='Deze opname heeft al drie mislukte pogingen gehad.';
  } else {
    console.log('[eufy-ai] Eenmalige handmatige analyse aangevraagd: '+name);
    writeManualResult({...result,status:'processing'});
    await analyze(clip);
    const analyzed = state.items[name];
    result.ok = analyzed?.status === 'done';
    result.status = analyzed?.status || 'unknown';
    result.title = result.ok ? analyzed.title || null : null;
    result.error = result.ok ? null : analyzed?.error || 'Analyse niet geslaagd';
  }

  result.processedAt = new Date().toISOString();
  writeManualResult(result);
  console.log('[eufy-ai] Handmatige aanvraag '+(result.ok ? 'afgerond' : 'niet geslaagd')+
    ': '+name+(result.error ? ' · '+result.error : ''));
  return true;
}

async function tick() {
  if (busy) return;
  busy = true;

  try {
    state.enabled = true;
    state.model = cfg.model;

    if (!cfg.apiKey) {
      state.lastError = 'Gemini API-key ontbreekt';
      saveState();
      return;
    }

    const clips = listClips();

    // First activation creates a baseline of ALL existing clips, including the
    // latest one. Never upload previously recorded Eufy videos without a
    // separate, explicit backfill action.
    if (!state.activationBaselineAt) {
      state.activationBaselineAt = new Date().toISOString();
      for (const clip of clips) {
        if (!state.items[clip.name]) {
          state.items[clip.name] = {
            recordingFile:clip.name,
            createdAt:clip.createdAt,
            status:'skipped-existing',
          };
        }
      }
      state.initialized = true;
      saveState();
      console.log('[eufy-ai] Bestaande opnames overgeslagen; alleen nieuwe opnames worden geanalyseerd.');
      return;
    }

    if (!clips.length) return;

    const now = Date.now();
    const baseline = new Date(state.activationBaselineAt).getTime();
    const day = new Date().toISOString().slice(0,10);
    if (state.apiCallsDay !== day) {
      state.apiCallsDay = day;
      state.apiCallsCount = 0;
      saveState();
    }
    // Manual recovery gets priority over the normal fresh-clip queue.
    // It still consumes the same per-camera per-day Gemini quota.
    if (await analyzeManualRequest(clips)) return;
    if (Number(state.apiCallsCount || 0) >= cfg.maxPerDay) return;

    const candidate = clips.find(clip => {
      // A recording imported later with an old modification time is also skipped.
      if (!Number.isFinite(baseline) || clip.mtimeMs <= baseline) return false;
      const item = state.items[clip.name];

      if (!item) return true;
      if (item.status === 'done' || item.status === 'skipped-existing') return false;
      if (Number(item.attempts || 0) >= 3) return false;

      if (item.status === 'error' && item.nextRetryAt) {
        return new Date(item.nextRetryAt).getTime() <= now;
      }

      return item.status !== 'processing' ||
        new Date(item.lastAttemptAt || 0).getTime() < now - cfg.retryMs;
    });

    if (candidate) {
      await analyze(candidate);
    }
  } catch (error) {
    state.lastError = error.message;
    state.lastRunAt = new Date().toISOString();
    saveState();
    console.warn(`[eufy-ai] Fout: ${error.message}`);
  } finally {
    busy = false;
  }
}

console.log(
  `[eufy-ai] Actief · model ${cfg.model} · alleen nieuwe HomeBase-opnames · max ${cfg.maxPerDay} per dag`
);

await tick();
setInterval(() => { void tick(); }, cfg.pollMs);
