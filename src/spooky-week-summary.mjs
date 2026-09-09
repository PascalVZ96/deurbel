import fs from 'node:fs';

const previousReadFileSync = fs.readFileSync.bind(fs);

const injection = String.raw`
<style id="spooky-week-summary-style">
#spookyStats .spooky-week-summary{
  margin:14px 0;
  padding:16px;
  border:1px solid var(--line);
  border-radius:16px;
  background:var(--panel);
}
#spookyStats .spooky-week-summary-head{
  display:flex;
  align-items:flex-start;
  justify-content:space-between;
  gap:12px;
  flex-wrap:wrap;
  margin-bottom:12px;
}
#spookyStats .spooky-week-summary-title{font-weight:830}
#spookyStats .spooky-week-summary-sub{margin-top:3px;color:var(--muted);font-size:.78rem}
#spookyStats .spooky-week-summary-text{
  font-size:.92rem;
  line-height:1.6;
}
#spookyStats .spooky-week-summary-grid{
  display:grid;
  grid-template-columns:repeat(4,minmax(0,1fr));
  gap:10px;
  margin-top:14px;
}
#spookyStats .spooky-week-mini{
  padding:11px 12px;
  border:1px solid var(--soft);
  border-radius:12px;
  background:#0d141c;
}
#spookyStats .spooky-week-mini span{display:block;color:var(--muted);font-size:.72rem}
#spookyStats .spooky-week-mini b{display:block;margin-top:4px;font-size:.98rem}
#spookyStats .spooky-history-note{margin-top:10px;color:var(--muted);font-size:.75rem;line-height:1.45}
@media(max-width:900px){#spookyStats .spooky-week-summary-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:520px){
  #spookyStats .spooky-week-summary{padding:12px}
  #spookyStats .spooky-week-summary-grid{grid-template-columns:1fr 1fr;gap:8px}
}
@media(max-width:380px){#spookyStats .spooky-week-summary-grid{grid-template-columns:1fr}}
</style>
<script id="spooky-week-summary-script">
(() => {
  const GAP_MS = 5 * 60 * 1000;
  const DAY_MS = 24 * 60 * 60 * 1000;
  let busy = false;

  function timeMs(value){
    if(value === null || value === undefined) return 0;
    if(typeof value === 'number') return value < 1e12 ? value * 1000 : value;
    const numeric = Number(value);
    if(String(value).trim() !== '' && Number.isFinite(numeric)) return numeric < 1e12 ? numeric * 1000 : numeric;
    const parsed = new Date(value).getTime();
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function textFor(item){return [item?.title,item?.shortSummary,item?.scene].filter(Boolean).join(' ').toLowerCase();}
  function isSpooky(item){return /\\bspooky\\b/i.test(textFor(item));}
  function isEating(item){return Boolean(item?.eating) || /\\beet\\b|\\beten\\b|\\bgegeten\\b|eetmoment|voerhouding/.test(textFor(item));}

  function startOfWeek(ms = Date.now()){
    const d = new Date(ms);
    d.setHours(0,0,0,0);
    const day = d.getDay() || 7;
    d.setDate(d.getDate() - day + 1);
    return d.getTime();
  }

  function cluster(items){
    const sorted = items.filter(isSpooky).map(item => {
      const start = timeMs(item.startTime ?? item.createdAt ?? item.sortTime);
      const rawEnd = timeMs(item.endTime ?? item.endAt);
      return {item,start,end:rawEnd >= start ? rawEnd : start};
    }).filter(entry => entry.start > 0).sort((a,b) => a.start - b.start);

    const visits = [];
    for(const entry of sorted){
      let visit = visits[visits.length - 1];
      if(!visit || entry.start - visit.endTime > GAP_MS){
        visit = {startTime:entry.start,endTime:entry.end,eating:isEating(entry.item),events:[entry.item]};
        visits.push(visit);
      }else{
        visit.endTime = Math.max(visit.endTime,entry.end,entry.start);
        visit.eating = visit.eating || isEating(entry.item);
        visit.events.push(entry.item);
      }
    }
    visits.forEach(visit => {visit.durationMs = Math.max(0,visit.endTime - visit.startTime);});
    return visits;
  }

  function ensurePanel(){
    const stats = document.getElementById('spookyStats');
    if(!stats || document.getElementById('spookyWeekSummary')) return Boolean(stats);

    const holder = document.createElement('div');
    holder.id = 'spookyWeekSummary';
    holder.className = 'spooky-week-summary';
    holder.innerHTML =
      '<div class="spooky-week-summary-head">' +
        '<div><div class="spooky-week-summary-title">Weekoverzicht</div>' +
        '<div class="spooky-week-summary-sub">Automatische samenvatting van Spooky bij de voerbak</div></div>' +
        '<span id="spookyHistoryBadge" class="badge">Historie opbouwen</span>' +
      '</div>' +
      '<div id="spookyWeekSummaryText" class="spooky-week-summary-text">Gegevens laden…</div>' +
      '<div class="spooky-week-summary-grid">' +
        '<div class="spooky-week-mini"><span>Bezoeken deze week</span><b id="spookyWeekSummaryVisits">-</b></div>' +
        '<div class="spooky-week-mini"><span>Eetmomenten deze week</span><b id="spookyWeekSummaryEating">-</b></div>' +
        '<div class="spooky-week-mini"><span>Gem. bezoekduur</span><b id="spookyWeekSummaryDuration">-</b></div>' +
        '<div class="spooky-week-mini"><span>Vs. vorige week</span><b id="spookyWeekSummaryCompare">-</b></div>' +
      '</div>' +
      '<div id="spookyHistoryNote" class="spooky-history-note"></div>';

    const insights = stats.querySelector('.spooky-insights-title');
    if(insights) insights.insertAdjacentElement('beforebegin',holder);
    else {
      const grid = stats.querySelector('.spooky-stats-grid');
      if(grid) grid.insertAdjacentElement('afterend',holder);
      else stats.appendChild(holder);
    }
    return true;
  }

  function formatDuration(ms){
    if(!Number.isFinite(ms) || ms <= 0) return '<1 min';
    const seconds = Math.max(1,Math.round(ms / 1000));
    if(seconds < 60) return String(seconds) + ' sec';
    const minutes = Math.round(seconds / 60);
    if(minutes < 60) return String(minutes) + ' min';
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return rest ? String(hours) + 'u ' + String(rest) + 'm' : String(hours) + 'u';
  }

  function formatDate(ms){
    return new Date(ms).toLocaleDateString('nl-NL',{weekday:'long',day:'numeric',month:'long'});
  }

  function hourLabel(hour){
    return String(hour).padStart(2,'0') + ':00–' + String((hour + 1) % 24).padStart(2,'0') + ':00';
  }

  function favoriteHour(visits){
    if(!visits.length) return null;
    const counts = Array(24).fill(0);
    visits.forEach(visit => counts[new Date(visit.startTime).getHours()]++);
    const max = Math.max(...counts);
    return max > 0 ? {hour:counts.indexOf(max),count:max} : null;
  }

  function busiestDay(visits){
    if(!visits.length) return null;
    const map = new Map();
    visits.forEach(visit => {
      const d = new Date(visit.startTime);
      d.setHours(0,0,0,0);
      const key = d.getTime();
      map.set(key,(map.get(key) || 0) + 1);
    });
    return [...map.entries()].sort((a,b) => b[1] - a[1] || b[0] - a[0])[0] || null;
  }

  function setText(id,value){const el = document.getElementById(id); if(el) el.textContent = value;}

  function render(data){
    const events = Array.isArray(data?.events) ? data.events : [];
    const visits = cluster(events);
    const now = Date.now();
    const currentWeek = startOfWeek(now);
    const previousWeek = currentWeek - 7 * DAY_MS;
    const createdMs = timeMs(data?.createdAt);
    const thisWeek = visits.filter(v => v.startTime >= currentWeek);
    const lastWeek = visits.filter(v => v.startTime >= previousWeek && v.startTime < currentWeek);
    const eating = thisWeek.filter(v => v.eating);
    const avgDuration = thisWeek.length ? thisWeek.reduce((s,v) => s + v.durationMs,0) / thisWeek.length : 0;
    const busyDay = busiestDay(thisWeek);
    const eatHour = favoriteHour(eating);
    const fullLastWeek = createdMs > 0 && createdMs <= previousWeek;
    const ageDays = createdMs ? Math.max(1,Math.floor((now - createdMs) / DAY_MS) + 1) : 0;

    setText('spookyWeekSummaryVisits',String(thisWeek.length));
    setText('spookyWeekSummaryEating',String(eating.length));
    setText('spookyWeekSummaryDuration',thisWeek.length ? formatDuration(avgDuration) : '-');

    if(fullLastWeek){
      const diff = thisWeek.length - lastWeek.length;
      setText('spookyWeekSummaryCompare',(diff > 0 ? '+' : '') + String(diff) + ' bezoeken');
    }else{
      setText('spookyWeekSummaryCompare','Nog opbouwen');
    }

    const parts = [];
    parts.push('Deze week kwam Spooky ' + thisWeek.length + ' keer bij de voerbak' + (eating.length ? ', waarvan ' + eating.length + ' keer met eten.' : '.'));
    if(thisWeek.length) parts.push('De gemiddelde bezoekduur is ' + formatDuration(avgDuration) + '.');
    if(busyDay) parts.push('De drukste dag is ' + formatDate(busyDay[0]) + ' met ' + busyDay[1] + ' bezoek' + (busyDay[1] === 1 ? '' : 'en') + '.');
    if(eatHour) parts.push('Het meest voorkomende eetuur is ' + hourLabel(eatHour.hour) + '.');
    if(fullLastWeek){
      const diff = thisWeek.length - lastWeek.length;
      parts.push('Dat zijn ' + Math.abs(diff) + ' bezoek' + (Math.abs(diff) === 1 ? '' : 'en') + (diff > 0 ? ' meer' : diff < 0 ? ' minder' : ' evenveel') + ' dan vorige week.');
    }else{
      parts.push('Een volledige vergelijking met vorige week verschijnt zodra het logboek lang genoeg bestaat.');
    }
    setText('spookyWeekSummaryText',parts.join(' '));

    const badge = document.getElementById('spookyHistoryBadge');
    if(badge){
      if(ageDays >= 30) badge.textContent = '30+ dagen historie';
      else if(ageDays >= 14) badge.textContent = '2+ weken historie';
      else if(ageDays >= 7) badge.textContent = '7+ dagen historie';
      else badge.textContent = 'Historie · ' + ageDays + ' dag' + (ageDays === 1 ? '' : 'en');
    }

    const backup = data?.backup || {};
    const backupText = backup.available
      ? 'Backup actief · ' + Number(backup.copies || 0) + ' dagelijkse kopie' + (Number(backup.copies || 0) === 1 ? '' : 'ën')
      : 'Backupstatus niet beschikbaar';
    setText('spookyHistoryNote','Permanent logboek: ' + events.length + ' gebeurtenissen · ' + backupText + '.');
  }

  async function refresh(){
    if(busy || document.hidden) return;
    if(!ensurePanel()){
      setTimeout(() => {void refresh();},250);
      return;
    }
    busy = true;
    try{
      const response = await fetch('/api/spooky/logbook',{cache:'no-store'});
      if(!response.ok) throw new Error('Logboek HTTP ' + response.status);
      render(await response.json());
    }catch(error){
      console.warn('[spooky-week-summary] ' + error.message);
      setText('spookyWeekSummaryText','Weekoverzicht kon tijdelijk niet worden geladen.');
    }finally{busy = false;}
  }

  ensurePanel();
  void refresh();
  window.addEventListener('security:viewchange',() => {void refresh();});
  document.addEventListener('visibilitychange',() => {if(!document.hidden) void refresh();});
  setInterval(() => {void refresh();},30000);
})();
</script>
`;

fs.readFileSync = function spookyWeekSummaryReadFileSync(file, options) {
  const data = previousReadFileSync(file, options);
  const normalized = String(file).replaceAll('\\', '/');
  if (!normalized.endsWith('/public/security.html')) return data;
  const encoding = typeof options === 'string' ? options : options?.encoding;
  const returnBuffer = !encoding && Buffer.isBuffer(data);
  let text = Buffer.isBuffer(data) ? data.toString('utf8') : String(data);
  if (!text.includes('id="spooky-week-summary-style"')) text = text.replace('</body>', injection + '\n</body>');
  return returnBuffer ? Buffer.from(text,'utf8') : text;
};
