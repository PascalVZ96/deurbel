import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const cfg = {
  enabled:/^(1|true|yes|on)$/i.test(
    String(process.env.FRIGATE_FALLBACK_ENABLED || '1')
  ),

  frigate:String(
    process.env.FRIGATE_URL || 'http://127.0.0.1:5000'
  ).replace(/\/+$/,''),

  apiKey:
    process.env.GEMINI_API_KEY ||
    process.env.FRIGATE_GEMINI_API_KEY ||
    '',

  model:String(
    process.env.FRIGATE_FALLBACK_MODEL ||
    process.env.GEMINI_MODEL ||
    'gemini-3.6-flash'
  ),

  delaySeconds:Math.max(
    30,
    Number(
      process.env.FRIGATE_FALLBACK_DELAY_SECONDS ||
      90
    )
  ),

  pollMs:Math.max(
    10000,
    Number(
      process.env.FRIGATE_FALLBACK_POLL_MS ||
      30000
    )
  ),

  maxAgeMinutes:Math.max(
    10,
    Number(
      process.env.FRIGATE_FALLBACK_MAX_AGE_MINUTES ||
      60
    )
  ),

  dataDir:process.env.DATA_DIR || '/data',
};

const stateFile=
  path.join(
    cfg.dataDir,
    'frigate-genai-fallback.json'
  );

const workDir=
  path.join(
    cfg.dataDir,
    'frigate-genai-fallback-work'
  );

const thumbsDir=
  path.join(
    cfg.dataDir,
    'frigate-genai-fallback-thumbs'
  );

fs.mkdirSync(cfg.dataDir,{recursive:true});
fs.mkdirSync(workDir,{recursive:true});
fs.mkdirSync(thumbsDir,{recursive:true});


function loadState(){
  try{
    const d=JSON.parse(
      fs.readFileSync(
        stateFile,
        'utf8'
      )
    );

    d.items ||= {};

    return d;

  }catch{
    return {
      version:1,
      items:{},
      totalGenerated:0,
      lastRunAt:null,
      lastError:null
    };
  }
}


let state=loadState();
let busy=false;



function cooldownActive(){
  if(!state.cooldownUntil){
    return false;
  }

  const until =
    new Date(state.cooldownUntil).getTime();

  if(!Number.isFinite(until)){
    state.cooldownUntil=null;
    return false;
  }

  if(Date.now() >= until){
    state.cooldownUntil=null;
    saveState();
    return false;
  }

  return true;
}

function setCooldown(minutes, reason){
  const ms =
    Math.max(1,Number(minutes || 60)) *
    60 *
    1000;

  state.cooldownUntil =
    new Date(Date.now()+ms).toISOString();

  state.lastError=reason || null;

  saveState();

  console.warn(
    `[genai-fallback] Gemini cooldown tot ${state.cooldownUntil}`
  );
}

function saveState(){
  const tmp=stateFile+'.tmp';

  fs.writeFileSync(
    tmp,
    JSON.stringify(state,null,2)
  );

  fs.renameSync(tmp,stateFile);
}


function epoch(value){
  if(value === null || value === undefined){
    return 0;
  }

  const n=Number(value);

  if(Number.isFinite(n)){
    return n > 1000000000000
      ? n / 1000
      : n;
  }

  const parsed=
    new Date(value).getTime();

  return Number.isFinite(parsed)
    ? parsed / 1000
    : 0;
}


function hasDescription(review){
  const m=
    review?.data?.metadata;

  return Boolean(
    m &&
    (
      m.title ||
      m.scene ||
      m.shortSummary ||
      m.short_summary
    )
  );
}


async function getReviews(camera){
  const url=
    cfg.frigate +
    '/api/review?cameras=' +
    encodeURIComponent(camera) +
    '&limit=30';

  const response=
    await fetch(
      url,
      {
        cache:'no-store',
        signal:AbortSignal.timeout(10000)
      }
    );

  if(!response.ok){
    throw new Error(
      `Frigate reviews HTTP ${response.status}`
    );
  }

  const d=await response.json();

  return Array.isArray(d)
    ? d
    : Array.isArray(d?.reviews)
      ? d.reviews
      : [];
}


function runFfmpeg(args){
  const r=spawnSync(
    '/usr/bin/ffmpeg',
    args,
    {
      encoding:'utf8',
      maxBuffer:8*1024*1024
    }
  );

  if(r.error){
    throw r.error;
  }

  if(r.status !== 0){
    throw new Error(
      String(
        r.stderr ||
        r.stdout ||
        'FFmpeg mislukt'
      ).slice(-2500)
    );
  }
}


async function downloadClip(
  camera,
  start,
  end,
  out
){
  /*
   * Kleine marge rond de review zodat begin/einde
   * van de handeling niet verloren gaat.
   */
  const clipStart=
    Math.max(0,start-1);

  const clipEnd=
    end+1;

  const url=
    cfg.frigate +
    '/api/' +
    encodeURIComponent(camera) +
    '/start/' +
    encodeURIComponent(clipStart) +
    '/end/' +
    encodeURIComponent(clipEnd) +
    '/clip.mp4';

  const response=
    await fetch(
      url,
      {
        cache:'no-store',
        signal:AbortSignal.timeout(60000)
      }
    );

  if(!response.ok){
    const text=
      await response.text();

    throw new Error(
      `Frigate clip HTTP ${response.status}: ` +
      text.slice(0,300)
    );
  }

  const data=
    Buffer.from(
      await response.arrayBuffer()
    );

  if(data.length < 5000){
    throw new Error(
      `Frigate clip te klein (${data.length} bytes)`
    );
  }

  fs.writeFileSync(out,data);
}


function extractFrames(
  review,
  clip
){
  const start=
    epoch(review.start_time);

  const end=
    epoch(review.end_time);

  const duration=
    Math.max(
      2,
      end-start+2
    );

  const percentages=[
    0.05,
    0.15,
    0.25,
    0.35,
    0.45,
    0.55,
    0.65,
    0.75,
    0.85,
    0.95
  ];

  const safe=
    String(review.id)
      .replace(
        /[^A-Za-z0-9_.-]/g,
        '_'
      );

  const frames=[];

  for(
    let i=0;
    i<percentages.length;
    i++
  ){
    const at=
      Math.max(
        0.2,
        Math.min(
          duration-0.2,
          duration*percentages[i]
        )
      );

    const file=
      path.join(
        workDir,
        `${safe}-${i}.jpg`
      );

    try{
      fs.unlinkSync(file);
    }catch{}

    runFfmpeg([
      '-hide_banner',
      '-loglevel','error',
      '-ss',String(at),
      '-i',clip,
      '-frames:v','1',
      '-vf','scale=-2:480',
      '-q:v','4',
      '-y',
      file
    ]);

    if(
      fs.existsSync(file) &&
      fs.statSync(file).size > 1500
    ){
      frames.push({
        file,
        at,
        data:
          fs.readFileSync(file)
            .toString('base64')
      });
    }
  }

  if(frames.length < 2){
    throw new Error(
      'Te weinig bruikbare frames uit opname'
    );
  }

  return frames;
}


function promptFor(review){
  const objects=
    Array.isArray(
      review?.data?.objects
    )
      ? review.data.objects.join(', ')
      : '';

  if(review.camera === 'petfeeder'){
    return `
Je analyseert chronologische camerabeelden van een automatische kattenvoerbak.

Gedetecteerde objecten: ${objects || 'onbekend'}.

Het belangrijkste doel is bepalen wat de kat BIJ DE VOERBAK doet.

Maak duidelijk onderscheid tussen ETEN en ONDERZOEKEN.

Gebruik "Kat eet uit de voerbak" wanneer:
- de kop gedurende meerdere opeenvolgende beelden boven, in of direct bij de voeropening blijft;
- de kat langere tijd vrijwel op dezelfde plaats voor de voerbak blijft;
- de lichaamshouding overeenkomt met een normale voerhouding.

Het is NIET noodzakelijk dat afzonderlijke brokjes, kauwbewegingen of de bek zichtbaar zijn.
Wanneer de voerhouding meerdere opeenvolgende beelden aanhoudt, mag dit als eten worden geclassificeerd.

Gebruik "Kat onderzoekt de voerbak" alleen wanneer:
- de kat slechts kort ruikt of kijkt;
- de kop maar kort bij de voeropening komt;
- de kat zonder langere voerhouding weer wegloopt.

Beschrijf ook wanneer zichtbaar:
- kat loopt naar de voerbak;
- kat wacht bij de voerbak;
- kat eet uit de voerbak;
- kat loopt weg van de voerbak;
- persoon vult of gebruikt de voerbak.

Als de kat gedurende het grootste deel van de gebeurtenis met de kop bij de voeropening blijft,
geef dan de voorkeur aan "Kat eet bij de voerbak" boven "Kat onderzoekt de voerbak".

Negeer televisiebeeld en irrelevante achtergrondactiviteit.

Doe geen aannames over honger, emoties, identiteit of intenties.

Geef UITSLUITEND JSON:
{
  "title": "korte Nederlandse titel",
  "shortSummary": "korte Nederlandse samenvatting",
  "scene": "chronologische Nederlandse beschrijving",
  "confidence": 0.0,
  "potential_threat_level": 0,
  "other_concerns": null
}

confidence is 0 tot 1.
potential_threat_level is 0 tot 3.
`.trim();
  }

  return `
Je analyseert chronologische camerabeelden uit een woonkamer.

Gedetecteerde objecten: ${objects || 'onbekend'}.

Beschrijf feitelijk wat gedurende de HELE gebeurtenis zichtbaar gebeurt.
Beschrijf daadwerkelijke handelingen, niet alleen dat er een persoon aanwezig is.

Voorbeelden:
- loopt door de woonkamer;
- zit of staat;
- draagt of verplaatst iets;
- speelt met een dier;
- danst of maakt herhaaldelijke dansbewegingen, maar alleen wanneer dat duidelijk uit meerdere beelden blijkt;
- komt binnen of verlaat het beeld.

Noem alleen wat werkelijk zichtbaar is.
Doe geen aannames over identiteit, emoties of intenties.

Geef UITSLUITEND JSON:
{
  "title": "korte Nederlandse titel",
  "shortSummary": "korte Nederlandse samenvatting",
  "scene": "chronologische Nederlandse beschrijving",
  "confidence": 0.0,
  "potential_threat_level": 0,
  "other_concerns": null
}

confidence is 0 tot 1.
potential_threat_level is 0 tot 3.
`.trim();
}


function parseGemini(text){
  let t=
    String(text || '')
      .trim()
      .replace(/^```json\s*/i,'')
      .replace(/^```\s*/i,'')
      .replace(/\s*```$/i,'')
      .trim();

  try{
    return JSON.parse(t);
  }catch{}

  const first=t.indexOf('{');
  const last=t.lastIndexOf('}');

  if(
    first >= 0 &&
    last > first
  ){
    return JSON.parse(
      t.slice(first,last+1)
    );
  }

  throw new Error(
    'Gemini antwoord bevat geen geldige JSON'
  );
}


function clamp(value,min,max){
  const n=Number(value);

  return Number.isFinite(n)
    ? Math.max(
        min,
        Math.min(max,n)
      )
    : null;
}


async function askGemini(
  review,
  frames
){
  const parts=[
    {
      text:promptFor(review)
    }
  ];

  frames.forEach(
    (frame,index)=>{
      parts.push({
        text:
          `Beeld ${index+1} van ${frames.length}, chronologisch:`
      });

      parts.push({
        inlineData:{
          mimeType:'image/jpeg',
          data:frame.data
        }
      });
    }
  );

  const response=
    await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(cfg.model)}:generateContent`,
      {
        method:'POST',

        headers:{
          'Content-Type':'application/json',
          'x-goog-api-key':cfg.apiKey
        },

        body:JSON.stringify({
          contents:[
            {
              role:'user',
              parts
            }
          ],

          generationConfig:{
            temperature:0.15,
            responseMimeType:'application/json'
          }
        }),

        signal:
          AbortSignal.timeout(90000)
      }
    );

  const body=
    await response.text();

  if(!response.ok){
    if(response.status === 429){
      const error = new Error(
        'Gemini HTTP 429: quota/rate-limit bereikt'
      );
      error.geminiRateLimited = true;
      throw error;
    }

    throw new Error(
      `Gemini HTTP ${response.status}: ` +
      body.slice(0,600)
    );
  }

  const d=JSON.parse(body);

  const text=
    (
      d.candidates?.[0]?.content?.parts ||
      []
    )
      .map(x=>x.text || '')
      .join('');

  const ai=parseGemini(text);

  return {
    title:
      String(
        ai.title ||
        'AI-gebeurtenis'
      ).slice(0,200),

    shortSummary:
      String(
        ai.shortSummary ||
        ''
      ).slice(0,1200),

    scene:
      String(
        ai.scene ||
        ''
      ).slice(0,5000),

    confidence:
      clamp(
        ai.confidence,
        0,
        1
      ),

    potential_threat_level:
      clamp(
        ai.potential_threat_level,
        0,
        3
      ),

    other_concerns:
      ai.other_concerns ?? null
  };
}


function cleanup(
  clip,
  frames
){
  try{
    fs.unlinkSync(clip);
  }catch{}

  for(const frame of frames || []){
    try{
      fs.unlinkSync(frame.file);
    }catch{}
  }
}


async function analyze(review){
  const id=String(review.id);

  const previous=
    state.items[id] || {};

  const attempts=
    Number(previous.attempts || 0)+1;

  state.items[id]={
    ...previous,
    reviewId:id,
    camera:review.camera,
    status:'processing',
    attempts,
    lastAttemptAt:
      new Date().toISOString()
  };

  saveState();

  console.log(
    `[genai-fallback] Analyse: ${review.camera} · ${id}`
  );

  const safe=
    id.replace(
      /[^A-Za-z0-9_.-]/g,
      '_'
    );

  const clip=
    path.join(
      workDir,
      `${safe}.mp4`
    );

  let frames=[];

  try{
    const start=
      epoch(review.start_time);

    const end=
      epoch(review.end_time);

    if(
      !start ||
      !end ||
      end <= start
    ){
      throw new Error(
        'Ongeldige review-tijden'
      );
    }

    await downloadClip(
      review.camera,
      start,
      end,
      clip
    );

    frames=
      extractFrames(
        review,
        clip
      );

    const ai=
      await askGemini(
        review,
        frames
      );

    const thumb=
      path.join(
        thumbsDir,
        `${safe}.jpg`
      );

    try{
      fs.copyFileSync(
        frames[
          Math.floor(
            frames.length/2
          )
        ].file,
        thumb
      );
    }catch{}

    state.items[id]={
      reviewId:id,
      camera:review.camera,
      createdAt:
        review.start_time ??
        null,

      endTime:
        review.end_time ??
        null,

      generatedAt:
        new Date().toISOString(),

      status:'done',
      attempts,

      fallback:true,

      objects:
        review?.data?.objects ||
        [],

      title:
        ai.title,

      shortSummary:
        ai.shortSummary,

      scene:
        ai.scene,

      confidence:
        ai.confidence,

      potential_threat_level:
        ai.potential_threat_level,

      other_concerns:
        ai.other_concerns
    };

    state.totalGenerated=
      Number(
        state.totalGenerated || 0
      )+1;

    state.lastError=null;
    state.lastRunAt=
      new Date().toISOString();

    saveState();

    console.log(
      `[genai-fallback] Klaar: ${review.camera} · ${ai.title}`
    );

  }catch(error){
    if(error.geminiRateLimited){
      setCooldown(
        60,
        'Gemini 429 - automatische cooldown'
      );
    }

    const attemptsNow=
      Number(
        state.items[id]?.attempts ||
        attempts
      );

    state.items[id]={
      ...state.items[id],

      status:'error',

      error:error.message,

      retryAt:
        new Date(
          Date.now() +
          15*60*1000
        ).toISOString(),

      attempts:attemptsNow
    };

    state.lastError=
      error.message;

    state.lastRunAt=
      new Date().toISOString();

    saveState();

    console.warn(
      `[genai-fallback] Mislukt ${id}: ${error.message}`
    );

  }finally{
    cleanup(
      clip,
      frames
    );
  }
}


function candidate(reviews){
  const now=
    Date.now()/1000;

  const maxAge=
    cfg.maxAgeMinutes*60;

  return reviews
    .filter(review=>{
      if(!review?.id)return false;

      /*
       * LSC: Gemini-fallback alleen voor personen.
       * Auto's/fietsen/etc. blijven lokale Frigate-detecties
       * en veroorzaken geen betaalde Gemini-call.
       */
      if(review.camera === 'lsc'){
        const objects =
          Array.isArray(review?.data?.objects)
            ? review.data.objects.map(x => String(x).toLowerCase())
            : [];

        if(!objects.includes('person')){
          return false;
        }
      }

      if(hasDescription(review)){
        return false;
      }

      const end=
        epoch(review.end_time);

      if(!end)return false;

      const age=
        now-end;

      if(age < cfg.delaySeconds){
        return false;
      }

      if(age > maxAge){
        return false;
      }

      const item=
        state.items[
          String(review.id)
        ];

      if(!item){
        return true;
      }

      if(item.status === 'done'){
        return false;
      }

      if(
        Number(item.attempts || 0) >= 3
      ){
        return false;
      }

      if(
        item.status === 'error' &&
        item.retryAt
      ){
        return (
          new Date(
            item.retryAt
          ).getTime()
          <= Date.now()
        );
      }

      if(
        item.status === 'processing'
      ){
        const last=
          new Date(
            item.lastAttemptAt || 0
          ).getTime();

        return (
          Date.now()-last >
          15*60*1000
        );
      }

      return true;
    })
    .sort(
      (a,b)=>
        epoch(b.end_time) -
        epoch(a.end_time)
    )[0] || null;
}


async function cycle(){
  if(
    busy ||
    !cfg.enabled
  ){
    return;
  }

  busy=true;

  try{
    if(cooldownActive()){
      return;
    }

    if(!cfg.apiKey){
      state.lastError=
        'Gemini API-key ontbreekt';

      saveState();

      console.warn(
        '[genai-fallback] Gemini API-key ontbreekt.'
      );

      return;
    }

    const [
      lsc,
      petfeeder
    ] = await Promise.all([
      getReviews('lsc'),
      getReviews('petfeeder')
    ]);

    const review=
      candidate([
        ...lsc,
        ...petfeeder
      ]);

    state.lastRunAt=
      new Date().toISOString();

    if(!review){
      state.lastError=null;
      saveState();
      return;
    }

    await analyze(review);

  }catch(error){
    state.lastError=
      error.message;

    state.lastRunAt=
      new Date().toISOString();

    saveState();

    console.warn(
      `[genai-fallback] Cycle: ${error.message}`
    );

  }finally{
    busy=false;
  }
}


console.log(
  `[genai-fallback] Actief · ${cfg.model} · fallback na ${cfg.delaySeconds}s · maximaal ${cfg.maxAgeMinutes} min oud`
);

await cycle();

setInterval(
  ()=>{ void cycle(); },
  cfg.pollMs
);
