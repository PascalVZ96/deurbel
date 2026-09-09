import fs from 'node:fs';

const previousReadFileSync = fs.readFileSync.bind(fs);

const injection = String.raw`
<style id="spooky-page-style">
#spookyMini{
  margin-top:18px;
  padding:16px;
  border:1px solid var(--line);
  border-radius:18px;
  background:linear-gradient(180deg,rgba(21,28,38,.98),rgba(15,21,29,.98));
  box-shadow:none;
}
#spookyMini .spooky-mini-head{
  display:flex;
  align-items:flex-start;
  justify-content:space-between;
  gap:12px;
  margin-bottom:12px;
}
#spookyMini .spooky-mini-title{font-size:15px;font-weight:830;letter-spacing:-.02em}
#spookyMini .spooky-mini-sub{margin-top:3px;color:var(--muted);font-size:11px;line-height:1.4}
#spookyMini .spooky-mini-grid{
  display:grid;
  grid-template-columns:repeat(4,minmax(0,1fr));
  gap:9px;
}
#spookyMini .spooky-mini-metric{
  min-width:0;
  padding:11px 12px;
  border-radius:13px;
  background:#0d141c;
  border:1px solid var(--soft);
}
#spookyMini .spooky-mini-label{font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;font-weight:760}
#spookyMini .spooky-mini-value{margin-top:5px;font-size:18px;font-weight:830;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#spookyMini .spooky-mini-foot{
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:10px;
  margin-top:11px;
  padding-top:11px;
  border-top:1px solid var(--soft);
}
#spookyMini .spooky-mini-status{font-size:11px;color:var(--muted);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#view-spooky .spooky-page-hero{
  margin-bottom:10px;
  padding:22px;
  border:1px solid var(--line);
  border-radius:20px;
  background:linear-gradient(145deg,rgba(29,49,69,.76),rgba(15,22,31,.96));
}
#view-spooky .spooky-page-kicker{font-size:11px;color:#91a4b9;text-transform:uppercase;letter-spacing:.11em;font-weight:800}
#view-spooky .spooky-page-hero h1{margin-top:5px;font-size:clamp(29px,4vw,42px)}
#view-spooky .spooky-page-hero p{margin-top:8px;max-width:760px;color:var(--muted);font-size:13px;line-height:1.55}
#view-spooky #spookyStats{margin-top:0}
@media(max-width:760px){
  .mobile-nav{grid-template-columns:repeat(6,minmax(0,1fr))!important}
  .mobile-nav a{font-size:9px!important}
  #spookyMini{padding:13px;margin-top:14px}
  #spookyMini .spooky-mini-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:7px}
  #view-spooky .spooky-page-hero{padding:17px;border-radius:17px}
}
@media(max-width:430px){
  .mobile-nav a{font-size:8px!important}
  .mobile-nav a .mobile-nav-icon{font-size:17px!important}
  #spookyMini .spooky-mini-foot{align-items:stretch;flex-direction:column}
  #spookyMini .spooky-mini-foot .btn{width:100%}
}
</style>
<script id="spooky-page-script">
(() => {
  const GAP_MS = 5 * 60 * 1000;
  let miniBusy = false;

  function timeMs(value){
    if(value === null || value === undefined) return 0;
    if(typeof value === 'number') return value < 1e12 ? value * 1000 : value;
    const numeric = Number(value);
    if(String(value).trim() !== '' && Number.isFinite(numeric)) return numeric < 1e12 ? numeric * 1000 : numeric;
    const parsed = new Date(value).getTime();
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function cluster(events){
    const sorted = events.map(item => {
      const start = timeMs(item.startTime ?? item.createdAt ?? item.sortTime);
      const rawEnd = timeMs(item.endTime ?? item.endAt);
      return {item,start,end:rawEnd >= start ? rawEnd : start};
    }).filter(entry => entry.start > 0).sort((a,b) => a.start - b.start);

    const visits = [];
    for(const entry of sorted){
      let visit = visits[visits.length - 1];
      if(!visit || entry.start - visit.endTime > GAP_MS){
        visit = {startTime:entry.start,endTime:entry.end,eating:Boolean(entry.item?.eating),latestEvent:entry.item};
        visits.push(visit);
      }else{
        visit.endTime = Math.max(visit.endTime,entry.end,entry.start);
        visit.eating = visit.eating || Boolean(entry.item?.eating);
        visit.latestEvent = entry.item;
      }
    }
    return visits.sort((a,b) => b.endTime - a.endTime);
  }

  function startOfDay(){
    const d = new Date();
    d.setHours(0,0,0,0);
    return d.getTime();
  }

  function formatTime(ms){
    if(!ms) return '-';
    const d = new Date(ms);
    if(ms >= startOfDay()) return d.toLocaleTimeString('nl-NL',{hour:'2-digit',minute:'2-digit'});
    return d.toLocaleDateString('nl-NL',{day:'2-digit',month:'2-digit'}) + ' · ' + d.toLocaleTimeString('nl-NL',{hour:'2-digit',minute:'2-digit'});
  }

  function ensureRoute(){
    try{
      securityRoutes.spooky = 'spooky';
      securityViewTitles.spooky = 'Spooky';
    }catch(error){
      console.warn('[spooky-page] Route kon niet worden toegevoegd: ' + error.message);
    }
  }

  function ensureDesktopNav(){
    const nav = document.querySelector('.nav');
    if(!nav || nav.querySelector('[data-nav="spooky"]')) return;
    const link = document.createElement('a');
    link.href = '#spooky';
    link.dataset.nav = 'spooky';
    link.textContent = '🐾 Spooky';
    const recordings = nav.querySelector('[data-nav="recordings"]');
    if(recordings) nav.insertBefore(link,recordings);
    else nav.appendChild(link);
  }

  function ensureMobileNav(){
    const nav = document.getElementById('mobileNav');
    if(!nav || nav.querySelector('[data-mobile-view="spooky"]')) return;
    const link = document.createElement('a');
    link.href = '#spooky';
    link.dataset.mobileView = 'spooky';
    link.innerHTML = '<span class="mobile-nav-icon" aria-hidden="true">🐾</span><span>Spooky</span>';
    const recordings = nav.querySelector('[data-mobile-view="recordings"]');
    if(recordings) nav.insertBefore(link,recordings);
    else nav.appendChild(link);
  }

  function ensureSpookyView(){
    const main = document.getElementById('mainContent');
    if(!main) return false;

    let view = document.getElementById('view-spooky');
    if(!view){
      view = document.createElement('div');
      view.id = 'view-spooky';
      view.className = 'app-view';
      view.dataset.view = 'spooky';
      view.hidden = true;
      view.innerHTML =
        '<section class="spooky-page-hero">' +
          '<div class="spooky-page-kicker">Pet Feeder · permanent logboek</div>' +
          '<h1>🐾 Spooky</h1>' +
          '<p>Alle bezoeken, eetmomenten, dagritmes, records en historie van Spooky op één plek.</p>' +
        '</section>';
      main.appendChild(view);
    }

    const stats = document.getElementById('spookyStats');
    if(stats && stats.parentElement !== view) view.appendChild(stats);
    return Boolean(stats);
  }

  function ensureMini(){
    if(document.getElementById('spookyMini')) return true;
    const overview = document.getElementById('view-overview');
    const anchor = document.getElementById('cameraOverview');
    if(!overview || !anchor) return false;

    const mini = document.createElement('section');
    mini.id = 'spookyMini';
    mini.innerHTML =
      '<div class="spooky-mini-head">' +
        '<div><div class="spooky-mini-title">🐾 Spooky</div>' +
        '<div class="spooky-mini-sub">Korte samenvatting van de Pet Feeder.</div></div>' +
        '<span id="spookyMiniBackup" class="badge">Logboek…</span>' +
      '</div>' +
      '<div class="spooky-mini-grid">' +
        '<div class="spooky-mini-metric"><div class="spooky-mini-label">Bezoeken vandaag</div><div id="spookyMiniVisits" class="spooky-mini-value">-</div></div>' +
        '<div class="spooky-mini-metric"><div class="spooky-mini-label">Eetmomenten vandaag</div><div id="spookyMiniEating" class="spooky-mini-value">-</div></div>' +
        '<div class="spooky-mini-metric"><div class="spooky-mini-label">Laatste bezoek</div><div id="spookyMiniLastVisit" class="spooky-mini-value">-</div></div>' +
        '<div class="spooky-mini-metric"><div class="spooky-mini-label">Laatste eetmoment</div><div id="spookyMiniLastEating" class="spooky-mini-value">-</div></div>' +
      '</div>' +
      '<div class="spooky-mini-foot">' +
        '<div id="spookyMiniActivity" class="spooky-mini-status">Spooky-logboek laden…</div>' +
        '<a class="btn dark" href="#spooky">Bekijk alle Spooky-gegevens</a>' +
      '</div>';

    anchor.insertAdjacentElement('afterend',mini);
    return true;
  }

  function setText(id,value){
    const el = document.getElementById(id);
    if(el) el.textContent = value;
  }

  async function refreshMini(){
    if(miniBusy || document.hidden || !ensureMini()) return;
    miniBusy = true;
    try{
      const response = await fetch('/api/spooky/logbook',{cache:'no-store'});
      if(!response.ok) throw new Error('HTTP ' + response.status);
      const data = await response.json();
      const visits = cluster(Array.isArray(data?.events) ? data.events : []);
      const today = startOfDay();
      const todayVisits = visits.filter(visit => visit.startTime >= today);
      const todayEating = todayVisits.filter(visit => visit.eating);
      const latest = visits[0] || null;
      const lastEating = visits.find(visit => visit.eating) || null;

      setText('spookyMiniVisits',String(todayVisits.length));
      setText('spookyMiniEating',String(todayEating.length));
      setText('spookyMiniLastVisit',formatTime(latest?.endTime || 0));
      setText('spookyMiniLastEating',formatTime(lastEating?.endTime || 0));
      setText('spookyMiniActivity',latest?.latestEvent?.title || 'Nog geen Spooky-bezoek opgeslagen.');

      const badge = document.getElementById('spookyMiniBackup');
      if(badge){
        const backup = data?.backup || {};
        if(backup.available){
          badge.className = 'badge good';
          badge.textContent = 'Logboek + backup';
        }else{
          badge.className = 'badge warn';
          badge.textContent = 'Logboek actief';
        }
      }
    }catch(error){
      setText('spookyMiniActivity','Spooky-gegevens tijdelijk niet beschikbaar.');
      const badge = document.getElementById('spookyMiniBackup');
      if(badge){badge.className = 'badge warn';badge.textContent = 'Niet bereikbaar';}
    }finally{
      miniBusy = false;
    }
  }

  function syncMobileNav(){
    const visible = document.querySelector('.app-view[data-view]:not([hidden])');
    const view = visible?.dataset?.view || 'overview';
    document.querySelectorAll('[data-mobile-view]').forEach(link => {
      const active = link.dataset.mobileView === view;
      link.classList.toggle('active',active);
      if(active) link.setAttribute('aria-current','page');
      else link.removeAttribute('aria-current');
    });
  }

  function finishSetup(){
    ensureRoute();
    ensureDesktopNav();
    ensureMobileNav();
    const hasStats = ensureSpookyView();
    ensureMini();
    if(!hasStats) setTimeout(finishSetup,200);

    try{
      selectSecurityView(location.hash === '#spooky');
    }catch{}
    syncMobileNav();
    void refreshMini();
  }

  finishSetup();
  window.addEventListener('hashchange',() => setTimeout(syncMobileNav,0));
  window.addEventListener('security:viewchange',() => {syncMobileNav();void refreshMini();});
  document.addEventListener('visibilitychange',() => {if(!document.hidden) void refreshMini();});
  setInterval(() => {void refreshMini();},30000);
})();
</script>
`;

fs.readFileSync = function spookyPageReadFileSync(file, options) {
  const data = previousReadFileSync(file, options);
  const normalized = String(file).replaceAll('\\', '/');
  if (!normalized.endsWith('/public/security.html')) return data;

  const encoding = typeof options === 'string' ? options : options?.encoding;
  const returnBuffer = !encoding && Buffer.isBuffer(data);
  let text = Buffer.isBuffer(data) ? data.toString('utf8') : String(data);

  if (!text.includes('id="spooky-page-style"')) {
    text = text.replace('</body>', injection + '\n</body>');
  }

  return returnBuffer ? Buffer.from(text, 'utf8') : text;
};
