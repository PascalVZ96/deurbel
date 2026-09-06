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
    'http://192.168.178.23:8090'
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

  api: 'http://127.0.0.1:8090',
  dataDir: process.env.DATA_DIR || '/data',
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

    return d;

  }catch{
    return {
      initialized:false,
      seen:{},
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

    click:cfg.dashboard + '/#ai',

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

    click:cfg.dashboard + '/#petfeeder',

    tags:['cat','camera']
  };
}

function itemEufy(d){
  const a=d?.latest;

  if(!d?.available || !a?.recordingFile)return null;

  return {
    source:'eufy',
    id:String(a.recordingFile),

    title:
      clean(a.title,120) ||
      'Nieuwe voordeurgebeurtenis',

    message:
      clean(a.shortSummary || a.scene) ||
      'De Eufy-deurbel heeft een nieuwe gebeurtenis opgenomen.',

    threat:Number(
      a.potential_threat_level || 0
    ),

    click:cfg.dashboard + '/#eufyAi',

    tags:['door','camera']
  };
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
      getJson('/api/eufy/ai')
        .then(itemEufy)
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

    /*
     * Eerste start:
     * bestaande gebeurtenissen alleen onthouden,
     * dus géén oude pushmeldingen sturen.
     */
    if(!state.initialized){
      for(const item of items){
        state.seen[item.source]=item.id;
      }

      state.initialized=true;
      state.lastError=null;
      saveState();

      console.log(
        '[notify] Baseline opgeslagen; alleen nieuwe gebeurtenissen worden verstuurd.'
      );

      return;
    }

    for(const item of items){
      if(
        state.seen[item.source] === item.id
      ){
        continue;
      }

      try{
        await publish(item);

        state.seen[item.source]=item.id;
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
    `[notify] Actief · poll ${cfg.pollMs} ms · LSC=${cfg.lsc} · Eufy=${cfg.eufy} · PetFeeder=${cfg.petfeeder}`
  );

  await cycle();

  setInterval(
    ()=>{ void cycle(); },
    cfg.pollMs
  );
}
