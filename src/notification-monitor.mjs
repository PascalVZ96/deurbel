import fs from 'node:fs';
import path from 'node:path';

const cfg = {
  enabled: /^(1|true|yes|on)$/i.test(
    String(process.env.NOTIFY_ENABLED || '1')
  ),

  server: String(
    process.env.NTFY_SERVER || 'https://ntfy.sh'
  ).replace(/\/+$/,''),

  topic: String(
    process.env.NTFY_TOPIC || ''
  ).trim(),

  dashboard: String(
    process.env.NOTIFY_DASHBOARD_URL ||
    'https://security.pascalvz.nl'
  ).replace(/\/+$/,''),

  pollMs: Math.max(
    3000,
    Number(process.env.NOTIFY_POLL_MS || 5000)
  ),

  lsc: /^(1|true|yes|on)$/i.test(
    String(process.env.NOTIFY_LSC || '1')
  ),

  eufy: /^(1|true|yes|on)$/i.test(
    String(process.env.NOTIFY_EUFY || '1')
  ),

  petfeeder: /^(1|true|yes|on)$/i.test(
    String(process.env.NOTIFY_PETFEEDER || '1')
  ),

  api: String(
    process.env.DASHBOARD_INTERNAL_URL ||
    'http://127.0.0.1:8091'
  ).replace(/\/+$/,''),
  dataDir: process.env.DATA_DIR || '/data',
  eufyNotifyStartAt:String(process.env.EUFY_NOTIFY_START_AT || '').trim(),
};

const stateFile =
  path.join(cfg.dataDir,'notification-state.json');

fs.mkdirSync(cfg.dataDir,{recursive:true});

function loadState(){
  try{
    const d=JSON.parse(
      fs.readFileSync(stateFile,'utf8')
    );

    d.seen ||= {};
    d.seenEufy ||= {};
    return d;

  }catch{
    return {
      initialized:false,
      seen:{},
      seenEufy:{},
      sent:0,
      lastSentAt:null,
      lastError:null
    };
  }
}

let state=loadState();
let busy=false;

function saveState(){
  const tmp=stateFile+'.tmp';

  fs.writeFileSync(
    tmp,
    JSON.stringify(state,null,2)
  );

  fs.renameSync(tmp,stateFile);
}

async function getJson(route){
  const response=await fetch(
    cfg.api + route,
    {
      cache:'no-store',
      signal:AbortSignal.timeout(8000)
    }
  );

  if(!response.ok){
    throw new Error(
      `${route} HTTP ${response.status}`
    );
  }

  return response.json();
}

function clean(text,max=360){
  const s=String(text || '')
    .replace(/\s+/g,' ')
    .trim();

  if(s.length <= max)return s;

  return s.slice(0,max-1)+'…';
}

function alertLink(historyId){
  return cfg.dashboard +
    '/?alert=' +
    encodeURIComponent(String(historyId || '')) +
    '#aiHistory';
}

function itemLsc(d){
  if(!d?.reviewId)return null;

  let objects = d.objects;

  if(!Array.isArray(objects)){
    objects = objects ? [objects] : [];
  }

  objects = objects.map(x => String(x).toLowerCase());

  // Woonkamer alleen pushen bij een persoon.
  // Kat/hond blijft wel gewoon zichtbaar in Frigate en dashboard.
  if(!objects.includes('person')){
    return null;
  }

  const activityText = [
    d.title,
    d.shortSummary,
    d.scene
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  const noActivityPatterns = [
    'geen zichtbare activiteit',
    'geen activiteit',
    'geen beweging',
    'geen relevante activiteit',
    'niets te zien',
    'niets gebeurt',
    'rustig en onveranderd',
    'geen persoon zichtbaar',
    'geen zichtbare beweging'
  ];

  if(
    noActivityPatterns.some(
      phrase => activityText.includes(phrase)
    )
  ){
    console.log(
      `[notify] LSC overgeslagen: geen echte activiteit · ${d.reviewId}`
    );

    return null;
  }

  return {
    source:'lsc',
    id:String(d.reviewId),

    title:
      clean(d.title,120) ||
      'Nieuwe woonkamergebeurtenis',

    message:
      clean(d.shortSummary || d.scene) ||
      'Frigate heeft een nieuwe gebeurtenis gezien.',

    threat:Number(d.potentialThreatLevel || 0),

    click:alertLink('lsc:' + d.reviewId),

    tags:['house','camera']
  };
}

function itemPetFeeder(d){
  if(!d?.aiAvailable || !d.reviewId)return null;

  return {
    source:'petfeeder',
    id:String(d.reviewId),

    title:
      clean(d.title,120) ||
      'Nieuwe Pet Feeder-gebeurtenis',

    message:
      clean(d.shortSummary || d.scene) ||
      'Er is activiteit bij de voerbak gezien.',

    threat:Number(d.potentialThreatLevel || 0),

    click:alertLink('petfeeder:' + d.reviewId),

    tags:['cat','camera']
  };
}

function itemEufy(d){
  const a=d?.latest;

  if(!d?.available || !a?.recordingFile)return null;

  return {
    source:'eufy',
    id:String(a.recordingFile),
    analyzedAt:a.analyzedAt || null,

    title:
      clean(a.title,120) ||
      'Nieuwe voordeurgebeurtenis',

    message:
      clean(a.shortSummary || a.scene) ||
      'De Eufy-deurbel heeft een nieuwe gebeurtenis opgenomen.',

    threat:Number(
      a.potential_threat_level || 0
    ),

    click:alertLink('eufy:' + a.recordingFile),

    tags:['door','camera']
  };
}

// Unlike /api/eufy/ai (which only returns the latest result), this reads
// ALL completed analyses. Each recording gets a durable deduplication key.
function eufyCompletedItems(){
  let data;
  try{
    data=JSON.parse(
      fs.readFileSync(path.join(cfg.dataDir,'eufy-ai.json'),'utf8')
    );
  }catch(error){
    if(error.code === 'ENOENT') return [];
    throw error;
  }
  const after=Date.parse(cfg.eufyNotifyStartAt || '');
  return Object.values(data.items || {})
    .filter(item => item?.status === 'done' && item.recordingFile &&
      Number.isFinite(Date.parse(item.analyzedAt || '')))
    .filter(item => !Number.isFinite(after) ||
      Date.parse(item.analyzedAt) >= after)
    .sort((a,b) => Date.parse(a.analyzedAt)-Date.parse(b.analyzedAt))
    .map(item => itemEufy({available:true, latest:item}))
    .filter(Boolean);
}

function prettyTitle(item){
  if(item.source === 'eufy'){
    return '🚪 Eufy · ' + item.title;
  }

  if(item.source === 'petfeeder'){
    return '🐾 Pet Feeder · ' + item.title;
  }

  return '🏠 LSC · ' + item.title;
}

async function publish(item){
  const priority =
    item.threat >= 2
      ? 5
      : item.source === 'eufy'
        ? 4
        : 3;

  const payload={
    topic:cfg.topic,
    title:prettyTitle(item),
    message:item.message,
    priority,
    tags:item.tags,
    click:item.click
  };

  const response=await fetch(
    cfg.server,
    {
      method:'POST',
      headers:{
        'Content-Type':'application/json'
      },
      body:JSON.stringify(payload),
      signal:AbortSignal.timeout(12000)
    }
  );

  if(!response.ok){
    const text=await response.text();

    throw new Error(
      `ntfy HTTP ${response.status}: ` +
      text.slice(0,300)
    );
  }

  console.log(
    `[notify] Verstuurd: ${item.source} · ${item.title}`
  );

  state.sent=
    Number(state.sent || 0) + 1;

  state.lastSentAt=
    new Date().toISOString();

  state.lastError=null;
}

async function readItems(){
  const jobs=[];

  if(cfg.lsc){
    jobs.push(
      getJson('/api/lsc/ai')
        .then(itemLsc)
        .catch(error=>{
          console.warn(
            `[notify] LSC: ${error.message}`
          );
          return null;
        })
    );
  }

  if(cfg.eufy){
    jobs.push(
      Promise.resolve()
        .then(eufyCompletedItems)
        .catch(error=>{
          console.warn(
            `[notify] Eufy: ${error.message}`
          );
          return null;
        })
    );
  }

  if(cfg.petfeeder){
    jobs.push(
      getJson('/api/petfeeder/ai')
        .then(itemPetFeeder)
        .catch(error=>{
          console.warn(
            `[notify] Pet Feeder: ${error.message}`
          );
          return null;
        })
    );
  }

  return (await Promise.all(jobs))
    .flat()
    .filter(Boolean);
}

async function cycle(){
  if(
    busy ||
    !cfg.enabled ||
    !cfg.topic
  ){
    return;
  }

  busy=true;

  try{
    const items=await readItems();

    // A new topic gets a new baseline; do not replay detections from an old topic.
    if(state.topic !== cfg.topic){
      state.topic=cfg.topic;
      state.initialized=false;
      state.seen={};
      state.seenEufy={};
      state.eufyNotifyInitialized=false;
    }

    /*
     * Eerste start:
     * bestaande gebeurtenissen alleen onthouden,
     * dus géén oude pushmeldingen sturen.
     */
    if(!state.initialized){
      for(const item of items){
        if(item.source === 'eufy'){
          // Explicit activation timestamp means only completed analyses after
          // activation qualify. They may have finished before this process
          // started; preserve them for the next polling cycle.
          if(!cfg.eufyNotifyStartAt) state.seenEufy[item.id]=item.analyzedAt;
        }else{
          state.seen[item.source]=item.id;
        }
      }

      state.eufyNotifyInitialized=true;
      state.initialized=true;
      state.lastError=null;
      saveState();

      console.log(
        '[notify] Baseline opgeslagen; alleen nieuwe gebeurtenissen worden verstuurd.'
      );

      return;
    }

    // Migration: when Eufy notifications are enabled on an existing system,
    // do not push previously completed descriptions by accident.
    if(cfg.eufy && !state.eufyNotifyInitialized){
      if(!cfg.eufyNotifyStartAt){
        for(const item of items.filter(x=>x.source === 'eufy')){
          state.seenEufy[item.id]=item.analyzedAt;
        }
      }
      state.eufyNotifyInitialized=true;
      saveState();
    }

    for(const item of items){
      if(item.source === 'eufy'
        ? Boolean(state.seenEufy[item.id])
        : state.seen[item.source] === item.id
      ){
        continue;
      }

      try{
        await publish(item);

        if(item.source === 'eufy'){
          state.seenEufy[item.id]=item.analyzedAt || new Date().toISOString();
        }else{
          state.seen[item.source]=item.id;
        }
        saveState();

      }catch(error){
        state.lastError=error.message;
        saveState();

        console.warn(
          `[notify] Verzenden mislukt: ${error.message}`
        );
      }
    }

  }catch(error){
    state.lastError=error.message;
    saveState();

    console.warn(
      `[notify] Fout: ${error.message}`
    );

  }finally{
    busy=false;
  }
}

if(!cfg.topic){
  console.warn(
    '[notify] NTFY_TOPIC ontbreekt; meldingen uitgeschakeld.'
  );
}else{
  console.log(
    `[notify] Actief · dashboard ${cfg.dashboard} · poll ${cfg.pollMs} ms · LSC=${cfg.lsc} · Eufy=${cfg.eufy} · PetFeeder=${cfg.petfeeder}`
  );

  await cycle();

  setInterval(
    ()=>{ void cycle(); },
    cfg.pollMs
  );
}
