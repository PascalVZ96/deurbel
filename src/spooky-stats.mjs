import fs from 'node:fs';

const previousReadFileSync = fs.readFileSync.bind(fs);

const spookyStatsInjection = String.raw`
<style id="spooky-stats-style">
#spookyStats .spooky-stats-grid{
  display:grid;
  grid-template-columns:repeat(4,minmax(0,1fr));
  gap:12px;
  margin-bottom:14px;
}
#spookyStats .spooky-stat,
#spookyStats .spooky-week-card{
  padding:16px;
  border:1px solid var(--line);
  border-radius:16px;
  background:var(--panel);
}
#spookyStats .spooky-stat-label{
  color:var(--muted);
  font-size:.82rem;
  font-weight:700;
}
#spookyStats .spooky-stat-value{
  margin-top:6px;
  font-size:1.7rem;
  line-height:1.1;
  font-weight:830;
  letter-spacing:-.03em;
}
#spookyStats .spooky-stat-sub{
  margin-top:5px;
  color:var(--muted);
  font-size:.78rem;
  line-height:1.4;
}
#spookyStats .spooky-week-head{
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:12px;
  margin-bottom:14px;
}
#spookyStats .spooky-week-title{font-weight:800}
#spookyStats .spooky-week-sub{
  color:var(--muted);
  font-size:.78rem;
}
#spookyStats .spooky-bars{
  display:grid;
  grid-template-columns:repeat(7,minmax(0,1fr));
  gap:9px;
  align-items:end;
  min-height:145px;
}
#spookyStats .spooky-day{
  display:grid;
  grid-template-rows:1fr auto auto;
  gap:6px;
  min-width:0;
  text-align:center;
}
#spookyStats .spooky-bar-wrap{
  height:96px;
  display:flex;
  align-items:flex-end;
  justify-content:center;
}
#spookyStats .spooky-bar{
  width:min(100%,36px);
  min-height:4px;
  border-radius:9px 9px 4px 4px;
  background:linear-gradient(180deg,#86b9ff,#4d7fba);
}
#spookyStats .spooky-day-count{
  font-size:.8rem;
  font-weight:800;
}
#spookyStats .spooky-day-label{
  color:var(--muted);
  font-size:.72rem;
  text-transform:capitalize;
}
#spookyStats .spooky-empty{
  padding:14px 0 2px;
  color:var(--muted);
  font-size:.85rem;
  line-height:1.5;
}
@media(max-width:1050px){
  #spookyStats .spooky-stats-grid{grid-template-columns:repeat(2,minmax(0,1fr))}
}
@media(max-width:520px){
  #spookyStats .spooky-stats-grid{grid-template-columns:1fr 1fr;gap:8px}
  #spookyStats .spooky-stat{padding:12px}
  #spookyStats .spooky-stat-value{font-size:1.4rem}
  #spookyStats .spooky-bars{gap:5px}
  #spookyStats .spooky-bar-wrap{height:78px}
}
@media(max-width:380px){
  #spookyStats .spooky-stats-grid{grid-template-columns:1fr}
}
</style>
<script id="spooky-stats-script">
(() => {
  let refreshBusy = false;
  const SPOOKY_VISIT_GAP_MS = 5 * 60 * 1000;

  function ensurePanel(){
    if(document.getElementById('spookyStats')) return;
    const anchor = document.querySelector('#cameraOverview');
    if(!anchor) return;

    const section = document.createElement('section');
    section.id = 'spookyStats';
    section.className = 'section';
    section.innerHTML =
      '<div class="section-head">' +
        '<div><h2>🐾 Spooky-statistieken</h2>' +
        '<p>Bezoeken en eetmomenten bij de Pet Feeder op basis van AI-meldingen.</p></div>' +
        '<a class="btn dark" href="#aiHistory">Bekijk AI-meldingen</a>' +
      '</div>' +
      '<div class="spooky-stats-grid">' +
        '<article class="spooky-stat"><div class="spooky-stat-label">Bezoeken vandaag</div>' +
        '<div id="spookyTodayVisits" class="spooky-stat-value">-</div>' +
        '<div class="spooky-stat-sub">meldingen binnen 5 min samengevoegd</div></article>' +
        '<article class="spooky-stat"><div class="spooky-stat-label">Eetmomenten vandaag</div>' +
        '<div id="spookyTodayEating" class="spooky-stat-value">-</div>' +
        '<div class="spooky-stat-sub">AI herkent eten</div></article>' +
        '<article class="spooky-stat"><div class="spooky-stat-label">Deze week</div>' +
        '<div id="spookyWeekVisits" class="spooky-stat-value">-</div>' +
        '<div id="spookyWeekEating" class="spooky-stat-sub">-</div></article>' +
        '<article class="spooky-stat"><div class="spooky-stat-label">Laatste bezoek</div>' +
        '<div id="spookyLastTime" class="spooky-stat-value" style="font-size:1.15rem">-</div>' +
        '<div id="spookyLastActivity" class="spooky-stat-sub">Nog geen gegevens</div></article>' +
        '<article class="spooky-stat"><div class="spooky-stat-label">Gem. duur vandaag</div>' +
        '<div id="spookyAverageDuration" class="spooky-stat-value">-</div>' +
        '<div class="spooky-stat-sub">gemiddelde bezoekduur</div></article>' +
        '<article class="spooky-stat"><div class="spooky-stat-label">Langste bezoek vandaag</div>' +
        '<div id="spookyLongestDuration" class="spooky-stat-value">-</div>' +
        '<div class="spooky-stat-sub">langste samengevoegde bezoek</div></article>' +
        '<article class="spooky-stat"><div class="spooky-stat-label">Laatste eetmoment</div>' +
        '<div id="spookyLastEating" class="spooky-stat-value" style="font-size:1.15rem">-</div>' +
        '<div id="spookyLastEatingSub" class="spooky-stat-sub">Nog geen eetmoment</div></article>' +
      '</div>' +
      '<div class="spooky-week-card">' +
        '<div class="spooky-week-head"><div><div class="spooky-week-title">Laatste 7 dagen</div>' +
        '<div class="spooky-week-sub">Aantal herkende bezoeken per dag</div></div>' +
        '<span id="spookyDataCount" class="badge">0 bezoeken</span></div>' +
        '<div id="spookyBars" class="spooky-bars"></div>' +
        '<div id="spookyEmpty" class="spooky-empty" hidden>' +
        'Vanaf nieuwe AI-gebeurtenissen waarin Spooky bij naam wordt herkend, worden de statistieken automatisch opgebouwd.' +
        '</div>' +
      '</div>';

    anchor.insertAdjacentElement('afterend', section);
  }

  function timeMs(value){
    if(value === null || value === undefined) return 0;
    if(typeof value === 'number') return value < 1e12 ? value * 1000 : value;
    const numeric = Number(value);
    if(String(value).trim() !== '' && Number.isFinite(numeric)){
      return numeric < 1e12 ? numeric * 1000 : numeric;
    }
    const parsed = new Date(value).getTime();
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function itemText(item){
    return [item?.title, item?.shortSummary, item?.scene]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
  }

  function isSpooky(item){
    return /\bspooky\b/i.test(itemText(item));
  }

  function isEating(item){
    const text = itemText(item);
    return /\beet\b|\beten\b|\bgegeten\b|eetmoment|voerhouding/.test(text);
  }

  function startOfDay(ms = Date.now()){
    const d = new Date(ms);
    d.setHours(0,0,0,0);
    return d.getTime();
  }

  function startOfWeek(ms = Date.now()){
    const d = new Date(ms);
    d.setHours(0,0,0,0);
    const day = d.getDay() || 7;
    d.setDate(d.getDate() - day + 1);
    return d.getTime();
  }

  function formatLast(ms){
    if(!ms) return '-';
    const d = new Date(ms);
    const today = startOfDay();
    if(ms >= today){
      return d.toLocaleTimeString('nl-NL',{hour:'2-digit',minute:'2-digit'});
    }
    return d.toLocaleDateString('nl-NL',{day:'2-digit',month:'2-digit'}) +
      ' · ' + d.toLocaleTimeString('nl-NL',{hour:'2-digit',minute:'2-digit'});
  }

  function formatDuration(ms){
    if(!Number.isFinite(ms) || ms <= 0) return '<1 min';
    const minutes = Math.max(1, Math.round(ms / 60000));
    if(minutes < 60) return String(minutes) + ' min';
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return rest ? String(hours) + 'u ' + String(rest) + 'm' : String(hours) + 'u';
  }

  function clusterSpookyVisits(items){
    const sorted = items
      .filter(isSpooky)
      .map(item => {
        const start = timeMs(item.createdAt ?? item.startTime ?? item.sortTime);
        const rawEnd = timeMs(item.endAt ?? item.endTime);
        return {
          item,
          start,
          end:rawEnd >= start ? rawEnd : start
        };
      })
      .filter(entry => entry.start > 0)
      .sort((a,b) => a.start - b.start);

    const visits = [];

    for(const entry of sorted){
      let visit = visits[visits.length - 1];

      if(!visit || entry.start - visit.endTime > SPOOKY_VISIT_GAP_MS){
        visit = {
          startTime:entry.start,
          endTime:entry.end,
          events:[entry.item],
          eating:isEating(entry.item),
          latestEvent:entry.item,
          latestEventTime:entry.start
        };
        visits.push(visit);
        continue;
      }

      visit.endTime = Math.max(visit.endTime, entry.end, entry.start);
      visit.events.push(entry.item);
      visit.eating = visit.eating || isEating(entry.item);
      if(entry.start >= visit.latestEventTime){
        visit.latestEvent = entry.item;
        visit.latestEventTime = entry.start;
      }
    }

    for(const visit of visits){
      visit.durationMs = Math.max(0, visit.endTime - visit.startTime);
    }

    return visits.sort((a,b) => b.endTime - a.endTime);
  }

  async function loadPetFeederEvents(){
    try{
      const response = await fetch('/frigate/api/review?cameras=petfeeder&limit=100',{cache:'no-store'});
      if(!response.ok) throw new Error('Frigate HTTP ' + response.status);
      const raw = await response.json();
      const reviews = Array.isArray(raw) ? raw : Array.isArray(raw?.reviews) ? raw.reviews : [];

      return reviews.map(review => {
        const meta = review?.data?.metadata || {};
        return {
          createdAt:review?.start_time ?? review?.startTime ?? null,
          endAt:review?.end_time ?? review?.endTime ?? null,
          title:meta.title || null,
          shortSummary:meta.shortSummary ?? meta.short_summary ?? null,
          scene:meta.scene || null
        };
      }).filter(item => item.title || item.shortSummary || item.scene);
    }catch(error){
      console.warn('[spooky-stats] Frigate detail niet beschikbaar: ' + error.message);
      const response = await fetch('/api/ai/history?limit=100',{cache:'no-store'});
      if(!response.ok) throw new Error('Historie HTTP ' + response.status);
      const data = await response.json();
      return (Array.isArray(data?.history) ? data.history : [])
        .filter(item => item?.source === 'petfeeder');
    }
  }

  function renderBars(visits){
    const root = document.getElementById('spookyBars');
    if(!root) return;
    const days = [];
    const today = startOfDay();

    for(let offset = 6; offset >= 0; offset--){
      const start = today - offset * 86400000;
      const end = start + 86400000;
      const count = visits.filter(visit => visit.startTime >= start && visit.startTime < end).length;
      days.push({start,count});
    }

    const max = Math.max(1,...days.map(day => day.count));
    root.innerHTML = days.map(day => {
      const height = day.count ? Math.max(12, Math.round((day.count / max) * 96)) : 4;
      const label = new Date(day.start).toLocaleDateString('nl-NL',{weekday:'short'}).replace('.','');
      return '<div class="spooky-day">' +
        '<div class="spooky-bar-wrap"><div class="spooky-bar" style="height:' + height + 'px" title="' + day.count + ' bezoek(en)"></div></div>' +
        '<div class="spooky-day-count">' + day.count + '</div>' +
        '<div class="spooky-day-label">' + label + '</div>' +
        '</div>';
    }).join('');
  }

  function render(items){
    ensurePanel();
    const visits = clusterSpookyVisits(items);

    const now = Date.now();
    const today = startOfDay(now);
    const week = startOfWeek(now);
    const todayVisits = visits.filter(visit => visit.startTime >= today);
    const weekVisits = visits.filter(visit => visit.startTime >= week);
    const todayEating = todayVisits.filter(visit => visit.eating);
    const weekEating = weekVisits.filter(visit => visit.eating);
    const latest = visits[0] || null;
    const lastEating = visits.find(visit => visit.eating) || null;

    const todayDurations = todayVisits.map(visit => visit.durationMs);
    const avgDuration = todayDurations.length
      ? todayDurations.reduce((sum,value) => sum + value, 0) / todayDurations.length
      : null;
    const longestDuration = todayDurations.length ? Math.max(...todayDurations) : null;

    const setText = (id,value) => {
      const el = document.getElementById(id);
      if(el) el.textContent = value;
    };

    setText('spookyTodayVisits', String(todayVisits.length));
    setText('spookyTodayEating', String(todayEating.length));
    setText('spookyWeekVisits', String(weekVisits.length));
    setText('spookyWeekEating', String(weekEating.length) + ' eetmoment' + (weekEating.length === 1 ? '' : 'en') + ' deze week');
    setText('spookyLastTime', formatLast(latest?.endTime || 0));
    setText('spookyLastActivity', latest?.latestEvent?.title || 'Nog geen Spooky-gebeurtenis');
    setText('spookyAverageDuration', avgDuration === null ? '-' : formatDuration(avgDuration));
    setText('spookyLongestDuration', longestDuration === null ? '-' : formatDuration(longestDuration));
    setText('spookyLastEating', formatLast(lastEating?.endTime || 0));
    setText('spookyLastEatingSub', lastEating?.latestEvent?.title || 'Nog geen eetmoment');
    setText('spookyDataCount', String(visits.length) + ' bezoek' + (visits.length === 1 ? '' : 'en'));

    const empty = document.getElementById('spookyEmpty');
    if(empty) empty.hidden = visits.length > 0;
    renderBars(visits);
  }

  async function refresh(){
    if(refreshBusy || document.hidden) return;
    refreshBusy = true;
    try{
      render(await loadPetFeederEvents());
    }catch(error){
      console.warn('[spooky-stats] ' + error.message);
      ensurePanel();
      const empty = document.getElementById('spookyEmpty');
      if(empty){
        empty.hidden = false;
        empty.textContent = 'Spooky-statistieken konden tijdelijk niet worden geladen.';
      }
    }finally{
      refreshBusy = false;
    }
  }

  ensurePanel();
  void refresh();
  window.addEventListener('security:viewchange', () => {
    if(typeof activeSecurityView === 'undefined' || activeSecurityView === 'overview') void refresh();
  });
  document.addEventListener('visibilitychange', () => {
    if(!document.hidden) void refresh();
  });
  setInterval(() => { void refresh(); }, 30000);
})();
</script>
`;

fs.readFileSync = function spookyStatsReadFileSync(file, options) {
  const data = previousReadFileSync(file, options);
  const normalized = String(file).replaceAll('\\', '/');

  if (!normalized.endsWith('/public/security.html')) return data;

  const encoding = typeof options === 'string' ? options : options?.encoding;
  const returnBuffer = !encoding && Buffer.isBuffer(data);
  let text = Buffer.isBuffer(data) ? data.toString('utf8') : String(data);

  if (!text.includes('id="spooky-stats-style"')) {
    text = text.replace('</body>', spookyStatsInjection + '\n</body>');
  }

  return returnBuffer ? Buffer.from(text, 'utf8') : text;
};
