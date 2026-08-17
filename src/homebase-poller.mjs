import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const C = {
  dev: process.env.EUFY_SERIAL || '',
  hb: process.env.EUFY_STATION_SERIAL || 'T8030T2324151AF5',
  ws: process.env.EUFY_WS_URL || 'ws://127.0.0.1:3000',
  status: process.env.SECURITY_STATUS_URL || 'http://127.0.0.1:8090/api/status',
  rec: process.env.RECORDINGS_DIR || '/recordings',
  data: process.env.DATA_DIR || '/data',
  poll: Math.max(5000, Number(process.env.HOMEBASE_POLL_MS || 10000)),
  min: Number(process.env.STORAGE_MIN_BYTES || 2_000_000_000_000),
  tz: process.env.TZ || 'Europe/Amsterdam',
};
const stateFile = path.join(C.data, 'homebase-poller.json');
let ws, q, dl, pollTimer, reconnectTimer, running = false, stopping = false, baseline = false, last = '';

const send = (command, extra={}, messageId=`${command}-${Date.now()}`) => {
  if (!ws || ws.readyState !== 1) throw new Error('WebSocket niet verbonden');
  ws.send(JSON.stringify({ messageId, command, ...extra }));
};
const toBuf = v => {
  if (!v) return null;
  if (Array.isArray(v)) return Buffer.from(v);
  if (v?.data && Array.isArray(v.data)) return Buffer.from(v.data);
  if (typeof v === 'string') { try { return Buffer.from(v, 'base64'); } catch {} }
  return null;
};
const tokenFrom = r => /([0-9]{14})[.]zxvideo$/i.exec(String(r?.storage_path||''))?.[1] || '';
const stamp = t => `${t.slice(0,4)}-${t.slice(4,6)}-${t.slice(6,8)}_${t.slice(8,10)}-${t.slice(10,12)}-${t.slice(12,14)}`;
const tokenDate = t => new Date(+t.slice(0,4), +t.slice(4,6)-1, +t.slice(6,8), +t.slice(8,10), +t.slice(10,12), +t.slice(12,14));

function dayToken() {
  const o = {};
  for (const p of new Intl.DateTimeFormat('en-GB',{timeZone:C.tz,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()))
    if (p.type !== 'literal') o[p.type] = p.value;
  return `${o.year}${o.month}${o.day}`;
}
function nextDay(t) {
  const d = new Date(Date.UTC(+t.slice(0,4),+t.slice(4,6)-1,+t.slice(6,8)+1));
  return `${d.getUTCFullYear()}${String(d.getUTCMonth()+1).padStart(2,'0')}${String(d.getUTCDate()).padStart(2,'0')}`;
}
function rows(a) {
  return (Array.isArray(a)?a:[]).filter(r=>r?.device_sn===C.dev&&String(r?.storage_path||'').endsWith('.zxvideo'))
    .map(r=>({r,t:tokenFrom(r)})).filter(x=>x.t).sort((a,b)=>a.t.localeCompare(b.t));
}
function diskOk() {
  fs.accessSync(C.rec, fs.constants.R_OK|fs.constants.W_OK);
  const s=fs.statfsSync(C.rec,{bigint:true});
  return Number(s.blocks*s.bsize)>=C.min;
}
function loadState() {
  try { const s=JSON.parse(fs.readFileSync(stateFile,'utf8')); if (/^[0-9]{14}$/.test(s.last||'')) { last=s.last; baseline=true; console.log(`[homebase] Vorige positie: ${last}.`); } } catch {}
}
function saveState() {
  fs.mkdirSync(C.data,{recursive:true});
  const tmp=`${stateFile}.tmp`; fs.writeFileSync(tmp,JSON.stringify({last,updatedAt:new Date().toISOString()},null,2)); fs.renameSync(tmp,stateFile);
}
function advance(t) { if (t && (!last || t>last)) { last=t; saveState(); } }
async function securityOn() {
  const r=await fetch(C.status,{cache:'no-store'}); if(!r.ok) throw new Error(`dashboard HTTP ${r.status}`); return Boolean((await r.json())?.security?.securityEnabled);
}
function queryToday() {
  if(q) return Promise.reject(new Error('query bezig'));
  const d=dayToken(), id=`hbq-${Date.now()}`;
  return new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>{if(q?.id===id)q=null;reject(new Error('query timeout'));},20000);
    q={id,resolve,reject,timeout};
    try { send('station.database_query_by_date',{serialNumber:C.hb,serialNumbers:[C.dev],startDate:d,endDate:nextDay(d)},id); }
    catch(e){clearTimeout(timeout);q=null;reject(e);}
  });
}
function finishStream(s){return new Promise((res,rej)=>{s.once('close',res);s.once('error',rej);s.end();});}
function downloadRecord(r,vf,af){
  if(dl) return Promise.reject(new Error('download bezig'));
  const video=fs.createWriteStream(vf), audio=fs.createWriteStream(af), id=`hbd-${Date.now()}`;
  return new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>{if(dl?.id===id)dl=null;video.destroy();audio.destroy();reject(new Error('download timeout'));},120000);
    dl={id,video,audio,timeout,resolve,reject,vc:0,ac:0,vb:0,vm:null,am:null};
    try { send('device.start_download',{serialNumber:C.dev,path:r.storage_path,cipherId:Number(r.cipher_id||0)},id); }
    catch(e){clearTimeout(timeout);dl=null;video.destroy();audio.destroy();reject(e);}
  });
}
function ff(args){const r=spawnSync('ffmpeg',args,{encoding:'utf8'});if(r.status!==0)throw new Error((r.stderr||'ffmpeg mislukt').trim());}
function convert(d,vf,af,out,jpg){
  const fmt=/265|HEVC/i.test(String(d.vm?.videoCodec||''))?'hevc':'h264', fps=Math.max(1,Number(d.vm?.videoFPS||15));
  const input=['-hide_banner','-loglevel','warning','-fflags','+genpts','-r',String(fps),'-f',fmt,'-i',vf];
  const enc=['-c:v','libx264','-preset','veryfast','-crf','23','-pix_fmt','yuv420p'];
  let ok=false;
  if(d.ac>0&&/AAC/i.test(String(d.am?.audioCodec||''))) try{ff([...input,'-f','aac','-i',af,...enc,'-c:a','aac','-b:a','96k','-shortest','-movflags','+faststart','-y',out]);ok=true;}catch(e){console.warn(`[homebase] Audio mislukt; zonder audio: ${e.message}`);}
  if(!ok)ff([...input,'-an',...enc,'-movflags','+faststart','-y',out]);
  ff(['-hide_banner','-loglevel','error','-ss','1','-i',out,'-frames:v','1','-q:v','3','-y',jpg]);
}
async function importOne(x){
  if(!diskOk())throw new Error('/recordings staat niet op de grote HDD');
  const {r,t}=x, base=`motion_${stamp(t)}_eufy-original`, out=path.join(C.rec,`${base}.mp4`), jpg=path.join(C.rec,`${base}.jpg`), vf=path.join(C.rec,`.${base}.video`), af=path.join(C.rec,`.${base}.audio`);
  if(fs.existsSync(out)&&fs.statSync(out).size>0){console.log(`[homebase] Bestaat al: ${path.basename(out)}`);return;}
  for(const f of [out,jpg,vf,af])try{fs.unlinkSync(f);}catch{}
  try{
    console.log(`[homebase] Nieuw record ${r.record_id||'?'} (${t}); livestream blijft uit.`);
    console.log(`[homebase] Download: ${r.storage_path}`);
    const d=await downloadRecord(r,vf,af); if(!d.vc||!d.vb)throw new Error('geen videodata');
    console.log(`[homebase] Ontvangen: ${d.vc} videochunks / ${d.ac} audiochunks.`);
    convert(d,vf,af,out,jpg); const dt=tokenDate(t); try{fs.utimesSync(out,dt,dt);fs.utimesSync(jpg,dt,dt);}catch{}
    console.log(`[homebase] Opgeslagen: ${path.basename(out)} (${Math.round(fs.statSync(out).size/1024)} KB).`);
  } finally { for(const f of [vf,af])try{fs.unlinkSync(f);}catch{} }
}
async function poll(){
  if(running||stopping||!ws||ws.readyState!==1)return; running=true;
  try{
    const list=rows(await queryToday()), newest=list.at(-1)?.t||'';
    if(!baseline){last=newest;baseline=true;if(newest)saveState();console.log(newest?`[homebase] Startpositie: ${newest}.`:'[homebase] Startpositie leeg.');return;}
    if(!await securityOn()){if(newest&&(!last||newest>last)){advance(newest);console.log(`[homebase] Beveiliging uit; bijgewerkt tot ${newest} zonder import.`);}return;}
    if(!diskOk())throw new Error('/recordings staat niet op de grote HDD');
    const pending=list.filter(x=>!last||x.t>last); if(!pending.length)return;
    console.log(`[homebase] ${pending.length} nieuwe HomeBase-opname(s) gevonden.`);
    for(const x of pending){try{await importOne(x);advance(x.t);}catch(e){console.warn(`[homebase] Import ${x.t} mislukt: ${e.message}`);break;}}
  }catch(e){console.warn(`[homebase] Controle mislukt: ${e.message}`);}finally{running=false;}
}
async function finishDownload(){const d=dl;if(!d)return;dl=null;clearTimeout(d.timeout);try{await Promise.all([finishStream(d.video),finishStream(d.audio)]);d.resolve(d);}catch(e){d.reject(e);}}
function handle(data){
  if(q){
    if(data.type==='result'&&data.messageId===q.id&&data.success===false){const z=q;q=null;clearTimeout(z.timeout);z.reject(new Error(data.error||data.errorCode||'query geweigerd'));}
    else if(data.type==='event'&&data.event?.source==='station'&&data.event.serialNumber===C.hb&&data.event.event==='database query by date'){const z=q;q=null;clearTimeout(z.timeout);Number(data.event.returnCode)===0?z.resolve(data.event.data||[]):z.reject(new Error(`database returnCode ${data.event.returnCode}`));}
  }
  if(!dl)return;
  if(data.type==='result'&&data.messageId===dl.id&&data.success===false){const d=dl;dl=null;clearTimeout(d.timeout);d.video.destroy();d.audio.destroy();d.reject(new Error(data.error||data.errorCode||'download geweigerd'));return;}
  const e=data.event;if(data.type!=='event'||e?.source!=='device'||e.serialNumber!==C.dev||!dl)return;
  if(e.event==='download started')console.log('[homebase] HomeBase-download gestart.');
  if(e.event==='download video data'){const b=toBuf(e.buffer);if(b?.length){dl.video.write(b);dl.vc++;dl.vb+=b.length;dl.vm||=e.metadata;}}
  if(e.event==='download audio data'){const b=toBuf(e.buffer);if(b?.length){dl.audio.write(b);dl.ac++;dl.am||=e.metadata;}}
  if(e.event==='download finished')void finishDownload();
}
function stopActive(reason){if(q){const z=q;q=null;clearTimeout(z.timeout);z.reject(new Error(reason));}if(dl){const d=dl;dl=null;clearTimeout(d.timeout);d.video.destroy();d.audio.destroy();d.reject(new Error(reason));}}
function schedule(delay=C.poll){if(stopping)return;if(pollTimer)clearTimeout(pollTimer);pollTimer=setTimeout(async()=>{pollTimer=null;await poll();schedule();},delay);}
function connect(){
  if(!C.dev||!C.hb){console.error('[homebase] EUFY_SERIAL of EUFY_STATION_SERIAL ontbreekt.');return;}
  ws=new WebSocket(C.ws);
  ws.addEventListener('open',()=>{console.log(`[homebase] Verbonden. Deurbel ${C.dev} via HomeBase ${C.hb}.`);send('set_api_schema',{schemaVersion:21},'hb-schema');send('start_listening',{},'hb-listen');schedule(1500);});
  ws.addEventListener('message',m=>{try{handle(JSON.parse(typeof m.data==='string'?m.data:m.data.toString()));}catch{}});
  ws.addEventListener('close',()=>{stopActive('WebSocket verbroken');if(pollTimer)clearTimeout(pollTimer);pollTimer=null;ws=null;if(stopping)return;console.warn('[homebase] WebSocket verbroken; over 3s opnieuw.');reconnectTimer=setTimeout(connect,3000);});
  ws.addEventListener('error',()=>{if(!stopping)console.warn('[homebase] WebSocket-fout.');});
}
function shutdown(){stopping=true;if(pollTimer)clearTimeout(pollTimer);if(reconnectTimer)clearTimeout(reconnectTimer);stopActive('monitor stopt');try{ws?.close();}catch{}process.exit(0);}

fs.mkdirSync(C.data,{recursive:true});loadState();
console.log('[homebase] HomeBase-database is de bron; push-events zijn niet nodig.');
console.log(`[homebase] Controle elke ${Math.round(C.poll/1000)}s; automatische route start GEEN livestream.`);
connect();process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);
