import fs from 'node:fs';

const previousReadFileSync = fs.readFileSync.bind(fs);

const themeHeadInjection = String.raw`
<style id="security-theme-style">
html[data-theme="light"]{
  color-scheme:light;
  --bg:#f4f7fa;
  --panel:#ffffff;
  --panel2:#f7f9fc;
  --line:#d7e0ea;
  --soft:#e7edf4;
  --text:#182331;
  --muted:#64748b;
  --muted2:#8795a7;
  --good:#168a55;
  --goodbg:#e9f8f0;
  --warn:#a56d00;
  --warnbg:#fff6dc;
  --danger:#c83d52;
  --dangerbg:#fff0f2;
  --shadow:0 14px 38px rgba(38,57,77,.08);
}

html[data-theme="light"] body{
  background:linear-gradient(180deg,#f7f9fc 0,#eef3f7 100%);
  color:var(--text);
}

html[data-theme="light"] .topbar{
  background:rgba(255,255,255,.92);
  border-bottom-color:#dce4ed;
}

html[data-theme="light"] .brand-icon,
html[data-theme="light"] .camera-overview-icon,
html[data-theme="light"] .ai-icon,
html[data-theme="light"] #petfeeder .pf-ai-icon,
html[data-theme="light"] .storage-icon{
  background:#edf4fb;
  border-color:#d1dfed;
  color:#315c84;
}

html[data-theme="light"] .brand-title,
html[data-theme="light"] h1,
html[data-theme="light"] h2,
html[data-theme="light"] .camera-overview-title,
html[data-theme="light"] .camera-overview-ai-title,
html[data-theme="light"] .ai-history-title,
html[data-theme="light"] .ai-title,
html[data-theme="light"] #petfeeder .pf-ai-title,
html[data-theme="light"] .recording-time,
html[data-theme="light"] .day-title{
  color:#172333;
}

html[data-theme="light"] .nav{
  background:#f8fafc;
  border-color:#d8e2ec;
}

html[data-theme="light"] .nav a{
  color:#52657a;
}

html[data-theme="light"] .nav a:hover{
  background:#edf3f8;
  color:#17324c;
}

html[data-theme="light"] .nav a[aria-current="page"]{
  background:#dcebf8;
  color:#153f63;
  box-shadow:inset 0 0 0 1px #bdd6eb;
}

html[data-theme="light"] .card,
html[data-theme="light"] .panel,
html[data-theme="light"] .metric,
html[data-theme="light"] .camera-card,
html[data-theme="light"] .recording-card,
html[data-theme="light"] .day-group,
html[data-theme="light"] .system-card,
html[data-theme="light"] .camera-overview-card,
html[data-theme="light"] .ai-history-item,
html[data-theme="light"] #recentAiList .overview-alert-item{
  background:#fff;
  border-color:#dbe4ed;
  box-shadow:var(--shadow);
}

html[data-theme="light"] #view-overview .metric{
  background:#fff;
}

html[data-theme="light"] .health,
html[data-theme="light"] .live-side,
html[data-theme="light"] .storage-stat,
html[data-theme="light"] .technical-item,
html[data-theme="light"] details.technical,
html[data-theme="light"] .recording-toolbar,
html[data-theme="light"] .day-head,
html[data-theme="light"] .camera-head,
html[data-theme="light"] .ai-scene,
html[data-theme="light"] #petfeeder .pf-ai-scene,
html[data-theme="light"] #cameraOverview .camera-overview-ai,
html[data-theme="light"] #recentAiList .overview-alert-body{
  background:#f7f9fc;
  border-color:#e1e8ef;
}

html[data-theme="light"] .camera-overview-state,
html[data-theme="light"] .ai-history-threat,
html[data-theme="light"] .ai-history-meta span,
html[data-theme="light"] .ai-meta span,
html[data-theme="light"] #petfeeder .pf-ai-meta span,
html[data-theme="light"] #recentAiList .overview-alert-tag{
  background:#f1f5f9;
  border-color:#dde5ed;
  color:#607287;
}

html[data-theme="light"] .badge{
  background:#f2f6fa;
  border-color:#d9e3ed;
  color:#52677c;
}

html[data-theme="light"] .good,
html[data-theme="light"] .camera-overview-state.good{
  background:#e9f8f0!important;
  border-color:#b9e5cb!important;
  color:#167244!important;
}

html[data-theme="light"] .warn,
html[data-theme="light"] .camera-overview-state.warn,
html[data-theme="light"] .ai-history-threat.warn,
html[data-theme="light"] #recentAiList .overview-alert-tag.warn{
  background:#fff6dc!important;
  border-color:#ead28c!important;
  color:#8b6308!important;
}

html[data-theme="light"] .danger,
html[data-theme="light"] .camera-overview-state.bad,
html[data-theme="light"] .ai-history-threat.danger,
html[data-theme="light"] #recentAiList .overview-alert-tag.danger{
  background:#fff0f2!important;
  border-color:#f0c5cc!important;
  color:#ad3346!important;
}

html[data-theme="light"] .dark,
html[data-theme="light"] .camera-overview-link,
html[data-theme="light"] .ai-history-open,
html[data-theme="light"] #recentAiList .overview-alert-open,
html[data-theme="light"] .icon-btn,
html[data-theme="light"] .text-btn{
  background:#eef4f9;
  border-color:#d5e1eb;
  color:#294761;
}

html[data-theme="light"] .dark:hover:not(:disabled),
html[data-theme="light"] .camera-overview-link:hover,
html[data-theme="light"] .ai-history-open:hover,
html[data-theme="light"] #recentAiList .overview-alert-open:hover:not(:disabled){
  background:#e1ebf3;
}

html[data-theme="light"] .primary{
  background:#1f5f91;
  color:#fff;
}

html[data-theme="light"] select,
html[data-theme="light"] input[type="search"]{
  background:#fff;
  color:#1d2b39;
  border-color:#cfdae5;
}

html[data-theme="light"] .ai-summary,
html[data-theme="light"] #petfeeder .pf-ai-summary,
html[data-theme="light"] #recentAiList .overview-alert-description{
  color:#42566a;
}

html[data-theme="light"] .ai-scene,
html[data-theme="light"] #petfeeder .pf-ai-scene,
html[data-theme="light"] #recentAiList .overview-alert-scene{
  color:#66788b;
}

html[data-theme="light"] .camera-overview-snapshot-empty,
html[data-theme="light"] .ai-history-thumb-empty,
html[data-theme="light"] .ai-thumb-placeholder,
html[data-theme="light"] #petfeeder .pf-ai-placeholder{
  color:#718196;
  background:#edf2f7;
}

html[data-theme="light"] .modal-card{
  background:#fff;
  border-color:#d4dee8;
}

html[data-theme="light"] .modal-head,
html[data-theme="light"] .modal-actions{
  border-color:#e0e7ee;
}

html[data-theme="light"] .modal-close{
  background:#edf3f8;
  color:#294761;
  border-color:#d3dfe9;
}

html[data-theme="light"] .toast{
  background:#fff;
  border-color:#d2dde7;
  color:#23384b;
  box-shadow:0 14px 40px rgba(38,57,77,.14);
}

.theme-toggle{
  appearance:none;
  min-height:38px;
  padding:7px 11px;
  border-radius:999px;
  border:1px solid var(--line);
  background:#171e28;
  color:#d9e2ee;
  font:inherit;
  font-size:.78rem;
  font-weight:750;
  cursor:pointer;
  white-space:nowrap;
}

.theme-toggle:hover{
  transform:translateY(-1px);
}

html[data-theme="light"] .theme-toggle{
  background:#fff;
  border-color:#d5e0ea;
  color:#34516b;
}

@media(max-width:720px){
  .theme-toggle .theme-label{display:none}
  .theme-toggle{width:38px;padding:0;display:grid;place-items:center}
}
</style>
<script id="security-theme-bootstrap">
(() => {
  let theme='dark';
  try{
    const saved=localStorage.getItem('security-theme');
    if(saved==='light'||saved==='dark') theme=saved;
    else if(window.matchMedia?.('(prefers-color-scheme: light)').matches) theme='light';
  }catch{}
  document.documentElement.dataset.theme=theme;
})();
</script>
`;

const themeBodyInjection = String.raw`
<script id="security-theme-switch-script">
(() => {
  const actions=document.querySelector('.top-actions');
  if(!actions||document.getElementById('themeToggle'))return;

  const button=document.createElement('button');
  button.id='themeToggle';
  button.type='button';
  button.className='theme-toggle';

  function current(){
    return document.documentElement.dataset.theme==='light'?'light':'dark';
  }

  function paint(){
    const light=current()==='light';
    button.innerHTML='<span aria-hidden="true">'+(light?'☾':'☀')+'</span> <span class="theme-label">'+(light?'Donker':'Licht')+'</span>';
    button.setAttribute('aria-label',light?'Donker thema inschakelen':'Licht thema inschakelen');
    button.title=light?'Donker thema':'Licht thema';
  }

  button.addEventListener('click',()=>{
    const next=current()==='light'?'dark':'light';
    document.documentElement.dataset.theme=next;
    try{localStorage.setItem('security-theme',next)}catch{}
    paint();
  });

  actions.prepend(button);
  paint();
})();
</script>
`;

fs.readFileSync = function themedReadFileSync(file, options) {
  const data = previousReadFileSync(file, options);
  const normalized = String(file).replaceAll('\\', '/');
  if (!normalized.endsWith('/public/security.html')) return data;

  const encoding = typeof options === 'string' ? options : options?.encoding;
  const returnBuffer = !encoding && Buffer.isBuffer(data);
  let text = Buffer.isBuffer(data) ? data.toString('utf8') : String(data);

  if (!text.includes('id="security-theme-style"')) {
    text = text.replace('</head>', themeHeadInjection + '\n</head>');
  }
  if (!text.includes('id="security-theme-switch-script"')) {
    text = text.replace('</body>', themeBodyInjection + '\n</body>');
  }

  return returnBuffer ? Buffer.from(text, 'utf8') : text;
};
