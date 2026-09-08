import fs from 'node:fs';
import http from 'node:http';

const previousReadFileSync = fs.readFileSync.bind(fs);
const previousCreateServer = http.createServer.bind(http);

const manifest = JSON.stringify({
  id:'/',
  name:'Pascal Security Center',
  short_name:'Security',
  description:'Camera’s, AI-meldingen en opnames in één Security Center.',
  start_url:'/',
  scope:'/',
  display:'standalone',
  orientation:'any',
  background_color:'#090d12',
  theme_color:'#090d12',
  icons:[
    {src:'/pwa/icon.svg',sizes:'any',type:'image/svg+xml',purpose:'any maskable'}
  ],
  shortcuts:[
    {name:'Camera’s',short_name:'Camera’s',url:'/#cameras',icons:[{src:'/pwa/icon.svg',sizes:'any',type:'image/svg+xml'}]},
    {name:'AI-meldingen',short_name:'AI',url:'/#aiHistory',icons:[{src:'/pwa/icon.svg',sizes:'any',type:'image/svg+xml'}]},
    {name:'Opnames',short_name:'Opnames',url:'/#recordingsSection',icons:[{src:'/pwa/icon.svg',sizes:'any',type:'image/svg+xml'}]}
  ]
},null,2);

const iconSvg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#26466c"/>
      <stop offset="1" stop-color="#101b2a"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" rx="118" fill="#090d12"/>
  <path d="M256 64 414 126v112c0 107-62 170-158 210C160 408 98 345 98 238V126L256 64Z" fill="url(#g)" stroke="#6d9bd1" stroke-width="18"/>
  <rect x="158" y="190" width="196" height="142" rx="34" fill="#eef4fb"/>
  <circle cx="256" cy="261" r="45" fill="#142235"/>
  <circle cx="256" cy="261" r="21" fill="#78a8dd"/>
  <rect x="198" y="164" width="78" height="36" rx="18" fill="#eef4fb"/>
</svg>`;

const serviceWorker = String.raw`
const OFFLINE_HTML = '<!doctype html><html lang="nl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#090d12"><title>Security Center offline</title><style>*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:#090d12;color:#eef4fb;font-family:system-ui,-apple-system,sans-serif}.card{width:min(100%,420px);padding:26px;border-radius:22px;background:#111720;border:1px solid #26303d;text-align:center}.icon{font-size:42px}.title{font-size:24px;font-weight:800;margin:14px 0 8px}.text{color:#9aa8ba;line-height:1.55}.retry{margin-top:20px;min-height:44px;padding:10px 16px;border:0;border-radius:12px;background:#eef4fb;color:#111820;font:inherit;font-weight:800}</style></head><body><main class="card"><div class="icon">🔒</div><div class="title">Security Center is offline</div><div class="text">Er is nu geen verbinding met je server. Camera’s, opnames en AI-data worden bewust niet offline opgeslagen.</div><button class="retry" onclick="location.reload()">Opnieuw proberen</button></main></body></html>';

self.addEventListener('install', event => {
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if(request.method !== 'GET') return;

  const url = new URL(request.url);
  if(url.origin !== self.location.origin) return;

  if(request.mode === 'navigate'){
    event.respondWith(
      fetch(request).catch(() => new Response(OFFLINE_HTML,{
        status:503,
        headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}
      }))
    );
  }
});
`;

const headInjection = String.raw`
<link rel="manifest" href="/pwa/manifest.webmanifest">
<link rel="icon" href="/pwa/icon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/pwa/icon.svg">
<meta name="application-name" content="Security Center">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="Security">
<style id="security-mobile-pwa-style">
.mobile-nav{display:none}
.pwa-install{
  display:none;
  appearance:none;
  min-height:38px;
  padding:7px 11px;
  border-radius:999px;
  border:1px solid var(--line);
  background:#171e28;
  color:#d9e2ee;
  font:inherit;
  font-size:.76rem;
  font-weight:760;
  cursor:pointer;
  white-space:nowrap;
}
.pwa-install.show{display:inline-flex;align-items:center;gap:6px}
html[data-theme="light"] .pwa-install{background:#fff;border-color:#d5e0ea;color:#34516b}

@media(max-width:760px){
  html{scroll-padding-top:76px}
  body{padding-bottom:calc(82px + env(safe-area-inset-bottom,0px))}
  .shell{
    width:100%;
    padding:12px 12px calc(82px + env(safe-area-inset-bottom,0px));
  }
  .topbar{
    margin:-12px -12px 12px;
    padding:calc(9px + env(safe-area-inset-top,0px)) 12px 9px;
    gap:8px;
  }
  .brand{gap:9px}
  .brand-icon{width:36px;height:36px;border-radius:11px;font-size:17px}
  .brand-title{font-size:15px}
  .brand-sub{display:none}
  .top-actions{gap:6px;flex-wrap:nowrap}
  .top-actions .badge{display:none}
  .top-actions .theme-toggle,
  .top-actions .pwa-install,
  .top-actions .security-session{flex:0 0 auto}
  .theme-toggle{min-height:36px}
  .security-session{min-height:36px}
  .security-logout{min-height:27px}
  .nav{display:none!important}
  .hero{grid-template-columns:1fr!important;gap:10px}
  .hero-main{min-height:0;padding:17px;gap:16px}
  .hero-side{padding:15px}
  h1{font-size:clamp(26px,8vw,36px)}
  h2{font-size:20px}
  .hero-desc{font-size:13px}
  .controls{display:grid;grid-template-columns:1fr 1fr;gap:8px}
  .controls .btn{width:100%;min-height:46px}
  .health-grid{gap:8px}
  .health{padding:11px}
  .section{scroll-margin-top:78px;margin-top:14px}
  .section-head{align-items:flex-start;margin-bottom:9px}
  .section-head p{font-size:11px}
  .metrics{gap:8px}
  .live-layout,
  .camera-grid,
  .storage-grid{
    grid-template-columns:1fr!important;
  }
  .camera-grid{gap:10px}
  .live-side{padding:14px}
  .ai-panel{padding:14px}
  .ai-top{gap:10px}
  .ai-icon{width:42px;height:42px;border-radius:13px}
  .ai-title{font-size:17px}
  .ai-summary{font-size:13px}
  .storage{padding:14px}
  .storage-grid{gap:7px}
  .recordings-panel{padding:12px}
  .recording-toolbar{align-items:stretch}
  .recording-toolbar,.filters,.history-searchbar,.ai-history-toolbar{width:100%}
  .filters{display:grid;grid-template-columns:1fr 1fr}
  input[type=search],select{min-width:0;width:100%;min-height:44px}
  .recording-grid{grid-template-columns:1fr!important;padding:9px}
  .ai-history-list{grid-template-columns:1fr!important}
  .ai-history-item{border-radius:15px}
  .history-searchbar{display:grid!important;grid-template-columns:1fr;gap:8px}
  .history-searchbar label{width:100%}
  .history-searchbar .btn{width:100%;min-height:44px}
  .ai-history-toolbar{gap:7px;overflow-x:auto;padding-bottom:3px;scrollbar-width:none}
  .ai-history-toolbar::-webkit-scrollbar{display:none}
  .ai-history-filter{flex:0 0 auto;min-height:40px}
  .history-pagination{gap:8px}
  .history-pagination .btn{min-height:42px;padding-inline:11px}
  .modal{padding:0!important;align-items:flex-end!important}
  .modal-card{width:100%!important;max-height:92dvh;border-radius:20px 20px 0 0!important;border-bottom:0!important}
  .modal-actions{padding-bottom:calc(12px + env(safe-area-inset-bottom,0px))}
  .btn,.icon-btn,.text-btn{touch-action:manipulation}

  .mobile-nav{
    position:fixed;
    z-index:90;
    left:8px;
    right:8px;
    bottom:calc(8px + env(safe-area-inset-bottom,0px));
    display:grid;
    grid-template-columns:repeat(5,minmax(0,1fr));
    gap:4px;
    min-height:64px;
    padding:6px;
    border:1px solid rgba(66,82,103,.82);
    border-radius:20px;
    background:rgba(12,18,26,.94);
    box-shadow:0 14px 45px rgba(0,0,0,.38);
    backdrop-filter:blur(20px);
  }
  .mobile-nav a{
    min-width:0;
    min-height:52px;
    display:flex;
    flex-direction:column;
    align-items:center;
    justify-content:center;
    gap:3px;
    padding:5px 2px;
    border-radius:14px;
    color:#8695a8;
    text-decoration:none;
    font-size:10px;
    font-weight:720;
    line-height:1.05;
    -webkit-tap-highlight-color:transparent;
  }
  .mobile-nav a .mobile-nav-icon{font-size:19px;line-height:1}
  .mobile-nav a.active,
  .mobile-nav a[aria-current="page"]{
    color:#eff6ff;
    background:#1d2d42;
    box-shadow:inset 0 0 0 1px #345276;
  }
  html[data-theme="light"] .mobile-nav{
    background:rgba(255,255,255,.96);
    border-color:#d7e1ea;
    box-shadow:0 12px 38px rgba(45,66,88,.16);
  }
  html[data-theme="light"] .mobile-nav a{color:#718296}
  html[data-theme="light"] .mobile-nav a.active,
  html[data-theme="light"] .mobile-nav a[aria-current="page"]{
    color:#164a73;
    background:#e4f0fa;
    box-shadow:inset 0 0 0 1px #c6dceb;
  }
}

@media(max-width:430px){
  .controls{grid-template-columns:1fr}
  #view-overview .metrics{grid-template-columns:1fr 1fr!important}
  .metric-value{font-size:1.3rem!important}
  .health-grid{grid-template-columns:1fr 1fr}
  .top-actions .pwa-install .pwa-install-label{display:none}
  .pwa-install{width:36px;padding:0;justify-content:center}
  .mobile-nav a{font-size:9px}
}

@media(display-mode:standalone){
  .topbar{user-select:none}
}
</style>
`;

const bodyInjection = String.raw`
<nav id="mobileNav" class="mobile-nav" aria-label="Mobiele navigatie">
  <a href="#overview" data-mobile-view="overview"><span class="mobile-nav-icon" aria-hidden="true">⌂</span><span>Overzicht</span></a>
  <a href="#cameras" data-mobile-view="cameras"><span class="mobile-nav-icon" aria-hidden="true">◉</span><span>Camera’s</span></a>
  <a href="#aiHistory" data-mobile-view="alerts"><span class="mobile-nav-icon" aria-hidden="true">✦</span><span>Meldingen</span></a>
  <a href="#recordingsSection" data-mobile-view="recordings"><span class="mobile-nav-icon" aria-hidden="true">▶</span><span>Opnames</span></a>
  <a href="#system" data-mobile-view="system"><span class="mobile-nav-icon" aria-hidden="true">⚙</span><span>Systeem</span></a>
</nav>
<script id="security-mobile-pwa-script">
(() => {
  const nav=document.getElementById('mobileNav');
  const links=[...nav.querySelectorAll('[data-mobile-view]')];
  const actions=document.querySelector('.top-actions');
  const standalone=window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone===true;
  if(standalone)document.documentElement.classList.add('pwa-standalone');

  function currentView(){
    const visible=document.querySelector('.app-view[data-view]:not([hidden])');
    if(visible?.dataset?.view)return visible.dataset.view;
    const hash=location.hash.slice(1);
    if(['cameras','live','eufyControls','petfeeder'].includes(hash))return 'cameras';
    if(['aiHistory','ai','eufyAi'].includes(hash))return 'alerts';
    if(['recordingsSection'].includes(hash))return 'recordings';
    if(['system','storage'].includes(hash))return 'system';
    return 'overview';
  }

  function syncNav(){
    const view=currentView();
    links.forEach(link=>{
      const active=link.dataset.mobileView===view;
      link.classList.toggle('active',active);
      if(active)link.setAttribute('aria-current','page');
      else link.removeAttribute('aria-current');
    });
  }

  new MutationObserver(syncNav).observe(document.body,{subtree:true,attributes:true,attributeFilter:['hidden']});
  window.addEventListener('hashchange',syncNav);
  syncNav();

  let deferredInstall=null;
  let installButton=null;

  function ensureInstallButton(){
    if(!actions || standalone)return null;
    if(installButton)return installButton;
    installButton=document.createElement('button');
    installButton.id='pwaInstallButton';
    installButton.type='button';
    installButton.className='pwa-install';
    installButton.innerHTML='<span aria-hidden="true">⇩</span><span class="pwa-install-label">Installeren</span>';
    installButton.title='Security Center installeren';
    actions.prepend(installButton);
    return installButton;
  }

  window.addEventListener('beforeinstallprompt',event=>{
    event.preventDefault();
    deferredInstall=event;
    const button=ensureInstallButton();
    button?.classList.add('show');
  });

  const isiOS=/iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
  if(isiOS && !standalone){
    const button=ensureInstallButton();
    button?.classList.add('show');
  }

  document.addEventListener('click',async event=>{
    const button=event.target.closest?.('#pwaInstallButton');
    if(!button)return;

    if(deferredInstall){
      deferredInstall.prompt();
      try{await deferredInstall.userChoice}catch{}
      deferredInstall=null;
      button.classList.remove('show');
      return;
    }

    if(isiOS){
      if(typeof toast==='function')toast('iPhone/iPad: tik op Deel en kies “Zet op beginscherm”.');
      else alert('Tik in Safari op Deel en kies “Zet op beginscherm”.');
    }
  });

  window.addEventListener('appinstalled',()=>{
    deferredInstall=null;
    installButton?.classList.remove('show');
    if(typeof toast==='function')toast('Security Center is geïnstalleerd.');
  });

  if('serviceWorker' in navigator && (location.protocol==='https:' || location.hostname==='localhost')){
    navigator.serviceWorker.register('/pwa/service-worker.js',{scope:'/'}).catch(error=>{
      console.warn('[pwa] Service worker niet geregistreerd:',error.message);
    });
  }
})();
</script>
`;

fs.readFileSync = function mobilePwaReadFileSync(file, options) {
  const data = previousReadFileSync(file, options);
  const normalized = String(file).replaceAll('\\', '/');
  if (!normalized.endsWith('/public/security.html')) return data;

  const encoding = typeof options === 'string' ? options : options?.encoding;
  const returnBuffer = !encoding && Buffer.isBuffer(data);
  let text = Buffer.isBuffer(data) ? data.toString('utf8') : String(data);

  text = text.replace(
    'width=device-width, initial-scale=1',
    'width=device-width, initial-scale=1, viewport-fit=cover'
  );

  if (!text.includes('rel="manifest" href="/pwa/manifest.webmanifest"')) {
    text = text.replace('</head>', headInjection + '\n</head>');
  }
  if (!text.includes('id="security-mobile-pwa-script"')) {
    text = text.replace('</body>', bodyInjection + '\n</body>');
  }

  return returnBuffer ? Buffer.from(text, 'utf8') : text;
};

function sendText(res,status,contentType,body,extraHeaders={}){
  const data=Buffer.from(body);
  res.writeHead(status,{
    'Content-Type':contentType,
    'Content-Length':data.length,
    'X-Content-Type-Options':'nosniff',
    ...extraHeaders,
  });
  res.end(data);
}

http.createServer = function mobilePwaCreateServer(options, listener){
  let serverOptions=options;
  let requestListener=listener;

  if(typeof options === 'function'){
    requestListener=options;
    serverOptions=undefined;
  }

  const wrapped=(req,res)=>{
    let pathname='';
    try{pathname=new URL(req.url,`http://${req.headers.host || 'localhost'}`).pathname}catch{}

    if(req.method==='GET' && pathname==='/pwa/manifest.webmanifest'){
      sendText(res,200,'application/manifest+json; charset=utf-8',manifest,{
        'Cache-Control':'no-cache'
      });
      return;
    }

    if(req.method==='GET' && pathname==='/pwa/icon.svg'){
      sendText(res,200,'image/svg+xml; charset=utf-8',iconSvg,{
        'Cache-Control':'public, max-age=86400'
      });
      return;
    }

    if(req.method==='GET' && pathname==='/pwa/service-worker.js'){
      sendText(res,200,'text/javascript; charset=utf-8',serviceWorker,{
        'Cache-Control':'no-store',
        'Service-Worker-Allowed':'/'
      });
      return;
    }

    return requestListener?.(req,res);
  };

  return serverOptions === undefined
    ? previousCreateServer(wrapped)
    : previousCreateServer(serverOptions,wrapped);
};
