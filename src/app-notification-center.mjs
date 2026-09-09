import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const previousReadFileSync = fs.readFileSync.bind(fs);
const previousCreateServer = http.createServer.bind(http);
const dataDir = process.env.DATA_DIR || '/data';
const notificationStateFile = path.join(dataDir,'notification-state.json');

function envEnabled(name, fallback='1'){
  return /^(1|true|yes|on)$/i.test(String(process.env[name] ?? fallback));
}

function notificationStatus(){
  let state = null;
  try{ state = JSON.parse(fs.readFileSync(notificationStateFile,'utf8')); }catch{}
  const configured = Boolean(String(process.env.NTFY_TOPIC || '').trim());
  const enabled = envEnabled('NOTIFY_ENABLED','1') && configured;
  return {
    enabled,
    configured,
    initialized:Boolean(state?.initialized),
    sent:Number(state?.sent || 0),
    lastSentAt:state?.lastSentAt || null,
    lastError:state?.lastError || null,
    sources:{
      eufy:envEnabled('NOTIFY_EUFY','1'),
      lsc:envEnabled('NOTIFY_LSC','1'),
      petfeeder:envEnabled('NOTIFY_PETFEEDER','1')
    }
  };
}

const manifest = JSON.stringify({
  id:'/',
  name:'Pascal Security Center',
  short_name:'Security',
  description:'Camera’s, AI-meldingen, Spooky-statistieken en opnames in één Security Center.',
  start_url:'/',
  scope:'/',
  display:'standalone',
  orientation:'any',
  background_color:'#090d12',
  theme_color:'#090d12',
  icons:[
    {src:'/pwa/icon-192.png',sizes:'192x192',type:'image/png',purpose:'any'},
    {src:'/pwa/icon-512.png',sizes:'512x512',type:'image/png',purpose:'any'},
    {src:'/pwa/icon-512.png',sizes:'512x512',type:'image/png',purpose:'maskable'}
  ],
  shortcuts:[
    {name:'Camera’s',short_name:'Camera’s',url:'/#cameras'},
    {name:'AI-meldingen',short_name:'AI',url:'/#aiHistory'},
    {name:'Spooky',short_name:'Spooky',url:'/#spooky'},
    {name:'Opnames',short_name:'Opnames',url:'/#recordingsSection'}
  ]
},null,2);

const injection = String.raw`
<style id="app-notification-center-style">
#securityAppCenter{margin-top:16px;padding:18px;border:1px solid var(--line);border-radius:18px;background:var(--panel);box-shadow:var(--shadow)}
#securityAppCenter .app-center-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:13px}
#securityAppCenter .app-center-title{font-size:16px;font-weight:830;letter-spacing:-.02em}
#securityAppCenter .app-center-sub{margin-top:3px;color:var(--muted);font-size:11px;line-height:1.45}
#securityAppCenter .app-center-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:9px}
#securityAppCenter .app-center-item{min-width:0;padding:12px;border:1px solid var(--soft);border-radius:13px;background:#0d141c}
#securityAppCenter .app-center-label{font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;font-weight:760}
#securityAppCenter .app-center-value{margin-top:5px;font-size:15px;font-weight:820;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#securityAppCenter .app-center-note{margin-top:11px;color:var(--muted);font-size:11px;line-height:1.5}
#securityAppCenter .app-center-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:13px;padding-top:13px;border-top:1px solid var(--soft)}
html[data-theme="light"] #securityAppCenter{background:#fff;border-color:#dbe4ed;box-shadow:var(--shadow)}
html[data-theme="light"] #securityAppCenter .app-center-item{background:#f7f9fc;border-color:#e1e8ef}
html[data-theme="light"] #securityAppCenter .app-center-value{color:#172333}
@media(max-width:900px){#securityAppCenter .app-center-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:520px){#securityAppCenter{padding:14px}#securityAppCenter .app-center-grid{grid-template-columns:1fr 1fr;gap:7px}#securityAppCenter .app-center-actions{display:grid;grid-template-columns:1fr}#securityAppCenter .app-center-actions .btn{width:100%}}
</style>
<script id="app-notification-center-script">
(() => {
  let installEvent = null;
  let busy = false;

  window.addEventListener('beforeinstallprompt',event => {
    event.preventDefault();
    installEvent = event;
    refresh();
  });
  window.addEventListener('appinstalled',() => {installEvent=null;refresh();});

  function fmtDate(value){
    if(!value)return 'Nog niet';
    const d=new Date(value);
    if(Number.isNaN(d.getTime()))return 'Onbekend';
    return d.toLocaleDateString('nl-NL',{day:'2-digit',month:'2-digit'})+' · '+d.toLocaleTimeString('nl-NL',{hour:'2-digit',minute:'2-digit'});
  }

  function setText(id,value){const el=document.getElementById(id);if(el)el.textContent=value;}

  function ensurePanel(){
    if(document.getElementById('securityAppCenter'))return true;
    const view=document.getElementById('view-system');
    if(!view)return false;
    const section=document.createElement('section');
    section.id='securityAppCenter';
    section.innerHTML=
      '<div class="app-center-head"><div><div class="app-center-title">📱 App & meldingen</div><div class="app-center-sub">PWA-installatie, service worker en ntfy-status op één plek.</div></div><span id="appCenterBadge" class="badge">Controleren…</span></div>'+
      '<div class="app-center-grid">'+
        '<div class="app-center-item"><div class="app-center-label">Appmodus</div><div id="appCenterMode" class="app-center-value">-</div></div>'+
        '<div class="app-center-item"><div class="app-center-label">Service worker</div><div id="appCenterSw" class="app-center-value">-</div></div>'+
        '<div class="app-center-item"><div class="app-center-label">Ntfy meldingen</div><div id="appCenterNotify" class="app-center-value">-</div></div>'+
        '<div class="app-center-item"><div class="app-center-label">Laatste melding</div><div id="appCenterLast" class="app-center-value">-</div></div>'+
      '</div>'+
      '<div id="appCenterNote" class="app-center-note">Status laden…</div>'+
      '<div class="app-center-actions"><button id="appCenterInstall" type="button" class="btn primary">Installeren</button><button id="appCenterDiag" type="button" class="btn dark">PWA-diagnose</button><button id="appCenterRefresh" type="button" class="btn dark">Status vernieuwen</button></div>';
    view.appendChild(section);
    document.getElementById('appCenterInstall').onclick=install;
    document.getElementById('appCenterDiag').onclick=()=>{location.href='/?pwa=diag#pwa-diagnose';};
    document.getElementById('appCenterRefresh').onclick=()=>refresh();
    return true;
  }

  async function pwaState(){
    const standalone=!!(window.matchMedia?.('(display-mode: standalone)').matches||navigator.standalone===true);
    let active=false;
    let controlled=Boolean(navigator.serviceWorker?.controller);
    if('serviceWorker' in navigator){
      try{
        const regs=await navigator.serviceWorker.getRegistrations();
        active=regs.some(reg=>reg.scope===location.origin+'/'&&Boolean(reg.active));
      }catch{}
    }
    return {standalone,active,controlled};
  }

  async function install(){
    if(installEvent){
      const event=installEvent;
      installEvent=null;
      try{await event.prompt();await event.userChoice;}catch{}
      refresh();
      return;
    }
    location.href='/?pwa=diag#pwa-diagnose';
  }

  async function refresh(){
    if(busy||document.hidden||!ensurePanel())return;
    busy=true;
    try{
      const [pwa,response]=await Promise.all([
        pwaState(),
        fetch('/api/app/status',{cache:'no-store'}).then(r=>{if(!r.ok)throw new Error('HTTP '+r.status);return r.json();})
      ]);
      const n=response?.notifications||{};
      setText('appCenterMode',pwa.standalone?'Geïnstalleerd':'Browser');
      setText('appCenterSw',pwa.active&&pwa.controlled?'Actief':'Niet volledig actief');
      setText('appCenterNotify',n.enabled?(n.lastError?'Actief · fout':'Actief'):'Uitgeschakeld');
      setText('appCenterLast',fmtDate(n.lastSentAt));
      const sources=[];
      if(n.sources?.eufy)sources.push('Eufy');
      if(n.sources?.lsc)sources.push('LSC');
      if(n.sources?.petfeeder)sources.push('Pet Feeder');
      setText('appCenterNote',(n.enabled?'Meldingen actief voor '+sources.join(', ')+'. ':'Ntfy is niet volledig geconfigureerd. ')+(n.lastError?'Laatste fout: '+n.lastError:'Verstuurd sinds start: '+Number(n.sent||0)+'.'));
      const badge=document.getElementById('appCenterBadge');
      if(badge){
        const ok=pwa.active&&n.enabled&&!n.lastError;
        badge.className='badge '+(ok?'good':n.lastError?'warn':'');
        badge.textContent=ok?'App + meldingen gereed':n.lastError?'Meldingfout':'Controle nodig';
      }
      const install=document.getElementById('appCenterInstall');
      if(install){
        if(pwa.standalone){install.disabled=true;install.textContent='Al geïnstalleerd';}
        else{install.disabled=false;install.textContent=installEvent?'Security Center installeren':'Installatie controleren';}
      }
    }catch(error){
      setText('appCenterNote','Status kon tijdelijk niet worden geladen: '+error.message);
      const badge=document.getElementById('appCenterBadge');
      if(badge){badge.className='badge warn';badge.textContent='Niet bereikbaar';}
    }finally{busy=false;}
  }

  ensurePanel();
  refresh();
  window.addEventListener('security:viewchange',()=>refresh());
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
  setInterval(refresh,30000);
})();
</script>`;

fs.readFileSync = function appNotificationCenterReadFileSync(file, options){
  const data = previousReadFileSync(file, options);
  const normalized = String(file).replaceAll('\\','/');
  if(!normalized.endsWith('/public/security.html')) return data;
  const encoding = typeof options === 'string' ? options : options?.encoding;
  const returnBuffer = !encoding && Buffer.isBuffer(data);
  let text = Buffer.isBuffer(data) ? data.toString('utf8') : String(data);
  if(!text.includes('id="app-notification-center-style"')) text=text.replace('</body>',injection+'\n</body>');
  return returnBuffer ? Buffer.from(text,'utf8') : text;
};

http.createServer = function appNotificationCenterCreateServer(...args){
  let listener = null;
  if(typeof args[0] === 'function') listener=args[0];
  else if(typeof args[1] === 'function') listener=args[1];
  if(!listener) return previousCreateServer(...args);
  const wrapped = (req,res) => {
    let pathname='';
    try{pathname=new URL(req.url,`http://${req.headers.host||'localhost'}`).pathname}catch{}
    if(req.method==='GET' && pathname==='/api/app/status'){
      const body=JSON.stringify({available:true,notifications:notificationStatus()});
      res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});
      res.end(body);
      return;
    }
    if(req.method==='GET' && pathname==='/pwa/manifest.webmanifest'){
      res.writeHead(200,{'Content-Type':'application/manifest+json; charset=utf-8','Cache-Control':'no-cache'});
      res.end(manifest);
      return;
    }
    return listener(req,res);
  };
  if(typeof args[0] === 'function') return previousCreateServer(wrapped);
  return previousCreateServer(args[0],wrapped);
};
