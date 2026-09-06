import fs from 'node:fs';
import path from 'node:path';

const FRIGATE=String(
  process.env.FRIGATE_URL ||
  'http://127.0.0.1:5000'
).replace(/\/+$/,'');

const DATA_DIR=
  process.env.DATA_DIR ||
  '/data';

const STATE_FILE=
  path.join(
    DATA_DIR,
    'local-car-events.json'
  );

const THUMB_DIR=
  path.join(
    DATA_DIR,
    'local-car-thumbs'
  );

const POLL_MS=20000;
const MAX_AGE=6*60*60;

fs.mkdirSync(DATA_DIR,{recursive:true});
fs.mkdirSync(THUMB_DIR,{recursive:true});


/*
 * Zelfde twee zones als in Frigate.
 */
const zones={

  inrit_buiten:[
    [0.039,0.925],
    [0.125,0.910],
    [0.183,0.966],
    [0.164,0.999],
    [0.078,0.999]
  ],

  inrit_binnen:[
    [0.245,0.842],
    [0.358,0.850],
    [0.379,0.895],
    [0.272,0.906]
  ]
};


function pointInPolygon(point,polygon){
  const [x,y]=point;

  let inside=false;

  for(
    let i=0,j=polygon.length-1;
    i<polygon.length;
    j=i++
  ){
    const [xi,yi]=polygon[i];
    const [xj,yj]=polygon[j];

    const intersect=
      (
        (yi > y) !== (yj > y)
      ) &&
      (
        x <
        (xj-xi) *
        (y-yi) /
        ((yj-yi) || 1e-12) +
        xi
      );

    if(intersect){
      inside=!inside;
    }
  }

  return inside;
}


function loadState(){
  try{
    const d=JSON.parse(
      fs.readFileSync(
        STATE_FILE,
        'utf8'
      )
    );

    d.items ||= {};

    return d;

  }catch{
    return {
      version:1,
      items:{}
    };
  }
}


let state=loadState();


function save(){
  const tmp=
    STATE_FILE+'.tmp';

  fs.writeFileSync(
    tmp,
    JSON.stringify(
      state,
      null,
      2
    )
  );

  fs.renameSync(
    tmp,
    STATE_FILE
  );
}


async function getEvents(){
  const r=await fetch(
    FRIGATE +
    '/api/events?camera=lsc&label=car&limit=50',
    {
      cache:'no-store',
      signal:AbortSignal.timeout(10000)
    }
  );

  if(!r.ok){
    throw new Error(
      `Frigate HTTP ${r.status}`
    );
  }

  return await r.json();
}


function classify(event){
  const pathData=
    event?.data?.path_data || [];

  let firstOutside=null;
  let firstInside=null;

  for(const item of pathData){
    if(
      !Array.isArray(item) ||
      !Array.isArray(item[0])
    ){
      continue;
    }

    const point=item[0];
    const ts=Number(item[1]);

    if(
      !firstOutside &&
      pointInPolygon(
        point,
        zones.inrit_buiten
      )
    ){
      firstOutside=ts;
    }

    if(
      !firstInside &&
      pointInPolygon(
        point,
        zones.inrit_binnen
      )
    ){
      firstInside=ts;
    }
  }

  if(
    !firstOutside ||
    !firstInside
  ){
    return null;
  }

  if(firstOutside < firstInside){
    return {
      direction:'arrival',
      title:'Auto komt aan',
      summary:
        'Een auto rijdt via de inrit de parkeerplaats op.',
      firstOutside,
      firstInside
    };
  }

  if(firstInside < firstOutside){
    return {
      direction:'departure',
      title:'Auto vertrekt',
      summary:
        'Een auto rijdt vanaf de parkeerplaats via de uitrit weg.',
      firstOutside,
      firstInside
    };
  }

  return null;
}


async function saveThumbnail(eventId){
  const file=
    path.join(
      THUMB_DIR,
      `${eventId}.jpg`
    );

  if(fs.existsSync(file)){
    return;
  }

  try{
    const r=await fetch(
      `${FRIGATE}/api/events/${encodeURIComponent(eventId)}/snapshot.jpg`,
      {
        cache:'no-store',
        signal:AbortSignal.timeout(10000)
      }
    );

    if(!r.ok){
      return;
    }

    const buffer=
      Buffer.from(
        await r.arrayBuffer()
      );

    if(buffer.length > 1000){
      fs.writeFileSync(
        file,
        buffer
      );
    }

  }catch{}
}


async function cycle(){
  try{
    const events=
      await getEvents();

    const now=
      Date.now()/1000;

    let changed=false;

    for(const event of events){

      if(
        !event?.id ||
        !event?.end_time
      ){
        continue;
      }

      if(
        now-Number(event.end_time) >
        MAX_AGE
      ){
        continue;
      }

      if(state.items[event.id]){
        continue;
      }

      const eventZones=
        event.zones || [];

      if(
        !eventZones.includes(
          'parkeerplaats'
        ) ||
        !eventZones.includes(
          'inrit_binnen'
        ) ||
        !eventZones.includes(
          'inrit_buiten'
        )
      ){
        continue;
      }

      const result=
        classify(event);

      if(!result){
        /*
         * Niet betrouwbaar genoeg.
         * Geen gok maken.
         */
        state.items[event.id]={
          eventId:event.id,
          status:'ignored',
          reason:
            'richting niet betrouwbaar vastgesteld',
          createdAt:
            event.start_time,
          endTime:
            event.end_time
        };

        changed=true;
        continue;
      }

      const item={
        eventId:event.id,

        status:'done',

        camera:'lsc',

        direction:
          result.direction,

        title:
          result.title,

        shortSummary:
          result.summary,

        scene:
          result.summary,

        createdAt:
          event.start_time,

        endTime:
          event.end_time,

        detectedAt:
          new Date().toISOString(),

        zones:
          eventZones,

        objects:[
          'car'
        ],

        local:true,

        googleAiUsed:false,

        cost:0
      };

      state.items[event.id]=item;

      await saveThumbnail(
        event.id
      );

      changed=true;

      console.log(
        `[local-car] ${result.title} · ${event.id}`
      );
    }


    /*
     * Maximaal 250 entries bewaren.
     */
    const entries=
      Object.entries(
        state.items
      )
      .sort(
        (a,b)=>
          Number(
            b[1].createdAt || 0
          ) -
          Number(
            a[1].createdAt || 0
          )
      );

    if(entries.length > 250){
      state.items=
        Object.fromEntries(
          entries.slice(0,250)
        );

      changed=true;
    }


    if(changed){
      save();
    }

  }catch(error){
    console.warn(
      `[local-car] ${error.message}`
    );
  }
}


console.log(
  '[local-car] Lokale parkeerplaatsdetectie actief · Gemini €0'
);

await cycle();

setInterval(
  ()=>{ void cycle(); },
  POLL_MS
);
