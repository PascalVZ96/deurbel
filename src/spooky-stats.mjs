import fs from 'node:fs';

const previousReadFileSync = fs.readFileSync.bind(fs);

const spookyStatsInjection = String.raw`
<style id="spooky-stats-style">
#spookyStats .spooky-stats-grid,
#spookyStats .spooky-insights-grid{
  display:grid;
  grid-template-columns:repeat(4,minmax(0,1fr));
  gap:12px;
  margin-bottom:14px;
}
#spookyStats .spooky-stat,
#spookyStats .spooky-week-card,
#spookyStats .spooky-insight{
  padding:16px;
  border:1px solid var(--line);
  border-radius:16px;
  background:var(--panel);
}
#spookyStats .spooky-stat-label,
#spookyStats .spooky-insight-label{
  color:var(--muted);
  font-size:.82rem;
  font-weight:700;
}
#spookyStats .spooky-stat-value,
#spookyStats .spooky-insight-value{
  margin-top:6px;
  font-size:1.7rem;
  line-height:1.1;
  font-weight:830;
  letter-spacing:-.03em;
}
#spookyStats .spooky-stat-sub,
#spookyStats .spooky-insight-sub{
  margin-top:5px;
  color:var(--muted);
  font-size:.78rem;
  line-height:1.4;
}
#spookyStats .spooky-insights-title{
  margin:20px 2px 10px;
  font-size:1rem;
  font-weight:820;
}
#spookyStats .spooky-week-head{
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:12px;
  margin-bottom:14px;
  flex-wrap:wrap;
}
#spookyStats .spooky-week-title{font-weight:800}
#spookyStats .spooky-week-sub{color:var(--muted);font-size:.78rem}
#spookyStats .spooky-period{
  display:flex;
  gap:6px;
  padding:4px;
  border:1px solid var(--line);
  border-radius:12px;
  background:#0d141d;
}
#spookyStats .spooky-period button{
  border:0;
  border-radius:9px;
  padding:7px 10px;
  cursor:pointer;
  background:transparent;
  color:var(--muted);
  font:inherit;
  font-size:.78rem;
  font-weight:780;
}
#spookyStats .spooky-period button[aria-pressed="true"]{
  background:#24486b;
  color:#f6fbff;
}
#spookyStats .spooky-bars-wrap{overflow-x:auto;padding-bottom:4px}
#spookyStats .spooky-bars{
  display:grid;
  grid-template-columns:repeat(7,minmax(0,1fr));
  gap:9px;
  align-items:end;
  min-height:145px;
}
#spookyStats .spooky-bars[data-days="30"]{grid-template-columns:repeat(30,minmax(20px,1fr));min-width:850px}
#spookyStats .spooky-day{
  display:grid;
  grid-template-rows:1fr auto auto;
  gap:6px;
  min-width:0;
  text-align:center;
}
#spookyStats .spooky-bar-wrap{height:96px;display:flex;align-items:flex-end;justify-content:center}
#spookyStats .spooky-bar{
  width:min(100%,36px);
  min-height:4px;
  border-radius:9px 9px 4px 4px;
  background:linear-gradient(180deg,#86b9ff,#4d7fba);
}
#spookyStats .spooky-day-count{font-size:.8rem;font-weight:800}
#spookyStats .spooky-day-label{color:var(--muted);font-size:.72rem;text-transform:capitalize}
#spookyStats .spooky-empty{padding:14px 0 2px;color:var(--muted);font-size:.85rem;line-height:1.5}
@media(max-width:1050px){
  #spookyStats .spooky-stats-grid,#spookyStats .spooky-insights-grid{grid-template-columns:repeat(2,minmax(0,1fr))}
}
@media(max-width:520px){
  #spookyStats .spooky-stats-grid,#spookyStats .spooky-insights-grid{grid-template-columns:1fr 1fr;gap:8px}
  #spookyStats .spooky-stat,#spookyStats .spooky-insight{padding:12px}
  #spookyStats .spooky-stat-value,#spookyStats .spooky-insight-value{font-size:1.35rem}
  #spookyStats .spooky-bars{gap:5px}
  #spookyStats .spooky-bar-wrap{height:78px}
}
@media(max-width:380px){
  #spookyStats .spooky-stats-grid,#spookyStats .spooky-insights-grid{grid-template-columns:1fr}
}
</style>
<script id="spooky-stats-script">
(() => {
  let refreshBusy = false;
  let selectedDays = 7;
  let latestSnapshot = null;
  const SPOOKY_VISIT_GAP_MS = 5 * 60 * 1000;
  const DAY_MS = 24 * 60 * 60 * 1000;

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
        '<p>Bezoeken en eetmomenten uit het permanente Spooky-logboek.</p></div>' +
        '<a class="btn dark" href="#aiHistory">Bekijk AI-meldingen</a>' +
      '</div>' +
      '<div class="spooky-stats-grid">' +
        '<article class="spooky-stat"><div class="spooky-stat-label">Bezoeken vandaag</div>' +
        '<div id="spookyTodayVisits" class="spooky-stat-value">-</div>' +
        '<div class="spooky-stat-sub">meldingen binnen 5 min samengevoegd</div></article>' +
        '<article class="spooky-stat"><div class="spooky-stat-label">Eetmomenten vandaag</div>' +
        '<div id="spookyTodayEating" class="spooky-stat-value">-</div>' +
        '<div class="spooky-stat-sub">AI herkent eten</div></article>' +
        '<article class="spooky-stat"><div class="spooky-stat-label">Laatste bezoek</div>' +
        '<div id="spookyLastTime" class="spooky-stat-value" style="font-size:1.15rem">-</div>' +
        '<div id="spookyLastActivity" class="spooky-stat-sub">Nog geen gegevens</div></article>' +
        '<article class="spooky-stat"><div class="spooky-stat-label">Laatste eetmoment</div>' +
        '<div id="spookyLastEating" class="spooky-stat-value" style="font-size:1.15rem">-</div>' +
        '<div id="spookyLastEatingSub" class="spooky-stat-sub">Nog geen eetmoment</div></article>' +
        '<article class="spooky-stat"><div class="spooky-stat-label">Gem. duur vandaag</div>' +
        '<div id="spookyAverageDuration" class="spooky-stat-value">-</div>' +
        '<div class="spooky-stat-sub">gemiddelde bezoekduur</div></article>' +
        '<article class="spooky-stat"><div class="spooky-stat-label">Langste bezoek vandaag</div>' +
        '<div id="spookyLongestDuration" class="spooky-stat-value">-</div>' +
        '<div class="spooky-stat-sub">langste samengevoegde bezoek</div></article>' +
      '</div>' +
      '<div class="spooky-insights-title">Inzichten</div>' +
      '<div class="spooky-insights-grid">' +
        '<article class="spooky-insight"><div class="spooky-insight-label">Gem. bezoeken per dag</div>' +
        '<div id="spookyAvgVisitsDay" class="spooky-insight-value">-</div>' +
        '<div id="spookyAvgVisitsDaySub" class="spooky-insight-sub">laatste 7 dagen</div></article>' +
        '<article class="spooky-insight"><div class="spooky-insight-label">Gem. eetmomenten per dag</div>' +
        '<div id="spookyAvgEatingDay" class="spooky-insight-value">-</div>' +
        '<div id="spookyAvgEatingDaySub" class="spooky-insight-sub">laatste 7 dagen</div></article>' +
        '<article class="spooky-insight"><div class="spooky-insight-label">Favoriete tijd</div>' +
        '<div id="spookyFavoriteHour" class="spooky-insight-value" style="font-size:1.25rem">-</div>' +
        '<div id="spookyFavoriteHourSub" class="spooky-insight-sub">nog te weinig gegevens</div></article>' +
        '<article class="spooky-insight"><div class="spooky-insight-label">Deze week vs vorige week</div>' +
        '<div id="spookyWeekCompare" class="spooky-insight-value" style="font-size:1.25rem">-</div>' +
        '<div id="spookyWeekCompareSub" class="spooky-insight-sub">historie wordt opgebouwd</div></article>' +
      '</div>' +
      '<div class="spooky-week-card">' +
        '<div class="spooky-week-head">' +
          '<div><div id="spookyChartTitle" class="spooky-week-title">Laatste 7 dagen</div>' +
          '<div class="spooky-week-sub">Aantal samengevoegde bezoeken per dag</div></div>' +
          '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">' +
            '<span id="spookyDataCount" class="badge">0 bezoeken</span>' +
            '<div class="spooky-period" aria-label="Periode">' +
              '<button type="button" data-spooky-days="7" aria-pressed="true">7 dagen</button>' +
              '<button type="button" data-spooky-days="30" aria-pressed="false">30 dagen</button>' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div class="spooky-bars-wrap"><div id="spookyBars" class="spooky-bars" data-days="7"></div></div>' +
        '<div id="spookyEmpty" class="spooky-empty" hidden>Het permanente logboek wordt automatisch opgebouwd zodra Spooky wordt herkend.</div>' +
      '</div>';

    anchor.insertAdjacentElement('afterend', section);

    section.querySelectorAll('[data-spooky-days]').forEach(button => {
      button.addEventListener('click', () => {
        selectedDays = Number(button.dataset.spookyDays) === 30 ? 30 : 7;
        section.querySelectorAll('[data-spooky-days]').forEach(other => {
          other.setAttribute('aria-pressed', String(other === button));
        });
        if(latestSnapshot) render(latestSnapshot);
      });
    });
  }

  function timeMs(value){
    if(value === null || value === undefined) return 0;
    if(typeof value === 'number') return value < 1e12 ? value * 1000 : value;
    const numeric = Number(value);
    if(String(value).trim() !== '' && Number.isFinite(numeric)) return numeric < 1e12 ? numeric * 1000 : numeric;
    const parsed = new Date(value).getTime();
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function itemText(item){
    return [item?.title,item?.shortSummary,item?.scene].filter(Boolean).join(' ').toLowerCase();
  }

  function isSpooky(item){return /\bspooky\b/i.test(itemText(item));}
  function isEating(item){return Boolean(item?.eating) || /\beet\b|\beten\b|\bgegeten\b|eetmoment|voerhouding/.test(itemText(item));}

  function startOfDay(ms = Date.now()){
    const d = new Date(ms); d.setHours(0,0,0,0); return d.getTime();
  }

  function startOfWeek(ms = Date.now()){
    const d = new Date(ms); d.setHours(0,0,0,0);
    const day = d.getDay() || 7; d.setDate(d.getDate() - day + 1); return d.getTime();
  }

  function formatLast(ms){
    if(!ms) return '-';
    const d = new Date(ms);
    if(ms >= startOfDay()) return d.toLocaleTimeString('nl-NL',{hour:'2-digit',minute:'2-digit'});
    return d.toLocaleDateString('nl-NL',{day:'2-digit',month:'2-digit'}) + ' · ' + d.toLocaleTimeString('nl-NL',{hour:'2-digit',minute:'2-digit'});
  }

  function formatDuration(ms){
    if(!Number.isFinite(ms) || ms <= 0) return '<1 min';
    const minutes = Math.max(1,Math.round(ms / 60000));
    if(minutes < 60) return String(minutes) + ' min';
    const hours = Math.floor(minutes / 60); const rest = minutes % 60;
    return rest ? String(hours) + 'u ' + String(rest) + 'm' : String(hours) + 'u';
  }

  function decimal(value){return Number(value || 0).toLocaleString('nl-NL',{minimumFractionDigits:1,maximumFractionDigits:1});}

  function clusterSpookyVisits(items){
    const sorted = items.filter(isSpooky).map(item => {
      const start = timeMs(item.createdAt ?? item.startTime ?? item.sortTime);
      const rawEnd = timeMs(item.endAt ?? item.endTime);
      return {item,start,end:rawEnd >= start ? rawEnd : start};
    }).filter(entry => entry.start > 0).sort((a,b) => a.start - b.start);

    const visits = [];
    for(const entry of sorted){
      let visit = visits[visits.length - 1];
      if(!visit || entry.start - visit.endTime > SPOOKY_VISIT_GAP_MS){
        visit = {startTime:entry.start,endTime:entry.end,events:[entry.item],eating:isEating(entry.item),latestEvent:entry.item,latestEventTime:entry.start};
        visits.push(visit);
      }else{
        visit.endTime = Math.max(visit.endTime,entry.end,entry.start);
        visit.events.push(entry.item);
        visit.eating = visit.eating || isEating(entry.item);
        if(entry.start >= visit.latestEventTime){visit.latestEvent = entry.item;visit.latestEventTime = entry.start;}
      }
    }
    visits.forEach(visit => {visit.durationMs = Math.max(0,visit.endTime - visit.startTime);});
    return visits.sort((a,b) => b.endTime - a.endTime);
  }

  async function loadSnapshot(){
    const response = await fetch('/api/spooky/logbook',{cache:'no-store'});
    if(!response.ok) throw new Error('Logboek HTTP ' + response.status);
    const data = await response.json();
    return {events:Array.isArray(data?.events) ? data.events : [],createdAt:data?.createdAt || null,lastError:data?.lastError || null};
  }

  function renderBars(visits,daysCount){
    const root = document.getElementById('spookyBars');
    if(!root) return;
    root.dataset.days = String(daysCount);
    const days = [];
    const today = startOfDay();
    for(let offset = daysCount - 1; offset >= 0; offset--){
      const start = today - offset * DAY_MS;
      const end = start + DAY_MS;
      const count = visits.filter(visit => visit.startTime >= start && visit.startTime < end).length;
      days.push({start,count});
    }
    const max = Math.max(1,...days.map(day => day.count));
    root.innerHTML = days.map(day => {
      const height = day.count ? Math.max(12,Math.round((day.count / max) * 96)) : 4;
      const label = daysCount === 7
        ? new Date(day.start).toLocaleDateString('nl-NL',{weekday:'short'}).replace('.','')
        : new Date(day.start).toLocaleDateString('nl-NL',{day:'numeric',month:'numeric'});
      return '<div class="spooky-day"><div class="spooky-bar-wrap"><div class="spooky-bar" style="height:' + height + 'px" title="' + day.count + ' bezoek(en)"></div></div><div class="spooky-day-count">' + day.count + '</div><div class="spooky-day-label">' + label + '</div></div>';
    }).join('');
  }

  function favoriteHour(visits){
    if(!visits.length) return null;
    const hours = Array(24).fill(0);
    visits.forEach(visit => {hours[new Date(visit.startTime).getHours()]++;});
    const max = Math.max(...hours);
    const hour = hours.indexOf(max);
    return {hour,count:max};
  }

  function render(snapshot){
    ensurePanel();
    latestSnapshot = snapshot;
    const visits = clusterSpookyVisits(snapshot.events);
    const now = Date.now();
    const today = startOfDay(now);
    const currentWeek = startOfWeek(now);
    const previousWeek = currentWeek - 7 * DAY_MS;
    const todayVisits = visits.filter(visit => visit.startTime >= today);
    const todayEating = todayVisits.filter(visit => visit.eating);
    const latest = visits[0] || null;
    const lastEating = visits.find(visit => visit.eating) || null;
    const todayDurations = todayVisits.map(visit => visit.durationMs);
    const avgDuration = todayDurations.length ? todayDurations.reduce((sum,value) => sum + value,0) / todayDurations.length : null;
    const longestDuration = todayDurations.length ? Math.max(...todayDurations) : null;

    const periodStart = today - (selectedDays - 1) * DAY_MS;
    const periodVisits = visits.filter(visit => visit.startTime >= periodStart);
    const periodEating = periodVisits.filter(visit => visit.eating);
    const createdMs = timeMs(snapshot.createdAt);
    const coverageStart = Math.max(periodStart,createdMs ? startOfDay(createdMs) : periodStart);
    const coveredDays = Math.max(1,Math.min(selectedDays,Math.floor((today - coverageStart) / DAY_MS) + 1));
    const fav = favoriteHour(periodVisits);

    const thisWeek = visits.filter(visit => visit.startTime >= currentWeek);
    const lastWeek = visits.filter(visit => visit.startTime >= previousWeek && visit.startTime < currentWeek);
    const fullPreviousWeek = createdMs > 0 && createdMs <= previousWeek;

    const setText = (id,value) => {const el = document.getElementById(id);if(el) el.textContent = value;};
    setText('spookyTodayVisits',String(todayVisits.length));
    setText('spookyTodayEating',String(todayEating.length));
    setText('spookyLastTime',formatLast(latest?.endTime || 0));
    setText('spookyLastActivity',latest?.latestEvent?.title || 'Nog geen Spooky-gebeurtenis');
    setText('spookyLastEating',formatLast(lastEating?.endTime || 0));
    setText('spookyLastEatingSub',lastEating?.latestEvent?.title || 'Nog geen eetmoment');
    setText('spookyAverageDuration',avgDuration === null ? '-' : formatDuration(avgDuration));
    setText('spookyLongestDuration',longestDuration === null ? '-' : formatDuration(longestDuration));
    setText('spookyAvgVisitsDay',decimal(periodVisits.length / coveredDays));
    setText('spookyAvgEatingDay',decimal(periodEating.length / coveredDays));
    setText('spookyAvgVisitsDaySub','over ' + coveredDays + ' opgeslagen dag' + (coveredDays === 1 ? '' : 'en'));
    setText('spookyAvgEatingDaySub','over ' + coveredDays + ' opgeslagen dag' + (coveredDays === 1 ? '' : 'en'));
    setText('spookyFavoriteHour',fav ? String(fav.hour).padStart(2,'0') + ':00–' + String((fav.hour + 1) % 24).padStart(2,'0') + ':00' : '-');
    setText('spookyFavoriteHourSub',fav ? String(fav.count) + ' bezoek' + (fav.count === 1 ? '' : 'en') + ' in deze periode' : 'nog te weinig gegevens');

    if(fullPreviousWeek){
      const diff = thisWeek.length - lastWeek.length;
      setText('spookyWeekCompare',(diff > 0 ? '+' : '') + String(diff));
      setText('spookyWeekCompareSub',String(thisWeek.length) + ' deze week · ' + String(lastWeek.length) + ' vorige week');
    }else{
      setText('spookyWeekCompare','-');
      setText('spookyWeekCompareSub','historie wordt opgebouwd');
    }

    setText('spookyChartTitle','Laatste ' + selectedDays + ' dagen');
    setText('spookyDataCount',String(periodVisits.length) + ' bezoek' + (periodVisits.length === 1 ? '' : 'en'));
    const empty = document.getElementById('spookyEmpty');
    if(empty) empty.hidden = visits.length > 0;
    renderBars(visits,selectedDays);
  }

  async function refresh(){
    if(refreshBusy || document.hidden) return;
    refreshBusy = true;
    try{render(await loadSnapshot());}
    catch(error){
      console.warn('[spooky-stats] ' + error.message);
      ensurePanel();
      const empty = document.getElementById('spookyEmpty');
      if(empty){empty.hidden = false;empty.textContent = 'Spooky-statistieken konden tijdelijk niet worden geladen.';}
    }finally{refreshBusy = false;}
  }

  ensurePanel();
  void refresh();
  window.addEventListener('security:viewchange',() => {if(typeof activeSecurityView === 'undefined' || activeSecurityView === 'overview') void refresh();});
  document.addEventListener('visibilitychange',() => {if(!document.hidden) void refresh();});
  setInterval(() => {void refresh();},30000);
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
  if (!text.includes('id="spooky-stats-style"')) text = text.replace('</body>', spookyStatsInjection + '\n</body>');
  return returnBuffer ? Buffer.from(text, 'utf8') : text;
};
