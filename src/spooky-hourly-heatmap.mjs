import fs from 'node:fs';

const previousReadFileSync = fs.readFileSync.bind(fs);

const spookyHourlyInjection = String.raw`
<style id="spooky-hourly-style">
#spookyStats .spooky-hourly{
  margin:14px 0;
  padding:16px;
  border:1px solid var(--line);
  border-radius:16px;
  background:var(--panel);
}
#spookyStats .spooky-hourly-head{
  display:flex;
  align-items:flex-start;
  justify-content:space-between;
  gap:12px;
  margin-bottom:14px;
  flex-wrap:wrap;
}
#spookyStats .spooky-hourly-title{font-weight:820}
#spookyStats .spooky-hourly-sub{margin-top:3px;color:var(--muted);font-size:.78rem}
#spookyStats .spooky-hourly-scroll{overflow-x:auto;padding-bottom:4px}
#spookyStats .spooky-hourly-grid{
  display:grid;
  grid-template-columns:92px repeat(24,minmax(28px,1fr));
  gap:5px;
  min-width:900px;
  align-items:center;
}
#spookyStats .spooky-hourly-label{
  color:var(--muted);
  font-size:.76rem;
  font-weight:760;
}
#spookyStats .spooky-hourly-hour{
  color:var(--muted);
  font-size:.66rem;
  text-align:center;
}
#spookyStats .spooky-hourly-cell{
  height:34px;
  display:grid;
  place-items:center;
  border-radius:8px;
  border:1px solid rgba(255,255,255,.05);
  background:rgba(84,155,255,var(--heat,.08));
  font-size:.7rem;
  font-weight:800;
  color:#edf5ff;
}
#spookyStats .spooky-hourly-cell.eating{
  background:rgba(88,214,141,var(--heat,.08));
}
#spookyStats .spooky-hourly-summary{
  display:grid;
  grid-template-columns:repeat(2,minmax(0,1fr));
  gap:10px;
  margin-top:12px;
}
#spookyStats .spooky-hourly-summary-card{
  padding:11px 12px;
  border-radius:12px;
  border:1px solid var(--soft);
  background:#0d141c;
}
#spookyStats .spooky-hourly-summary-card span{display:block;color:var(--muted);font-size:.72rem}
#spookyStats .spooky-hourly-summary-card b{display:block;margin-top:3px;font-size:.95rem}
@media(max-width:520px){
  #spookyStats .spooky-hourly{padding:12px}
  #spookyStats .spooky-hourly-summary{grid-template-columns:1fr}
}
</style>
<script id="spooky-hourly-script">
(() => {
  const GAP_MS = 5 * 60 * 1000;
  const DAY_MS = 24 * 60 * 60 * 1000;
  let selectedDays = 7;
  let busy = false;

  function timeMs(value){
    if(value === null || value === undefined) return 0;
    if(typeof value === 'number') return value < 1e12 ? value * 1000 : value;
    const numeric = Number(value);
    if(String(value).trim() !== '' && Number.isFinite(numeric)) return numeric < 1e12 ? numeric * 1000 : numeric;
    const parsed = new Date(value).getTime();
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function textFor(item){
    return [item?.title,item?.shortSummary,item?.scene].filter(Boolean).join(' ').toLowerCase();
  }

  function isSpooky(item){return /\\bspooky\\b/i.test(textFor(item));}
  function isEating(item){return Boolean(item?.eating) || /\\beet\\b|\\beten\\b|\\bgegeten\\b|eetmoment|voerhouding/.test(textFor(item));}

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
        visit = {startTime:entry.start,endTime:entry.end,eating:isEating(entry.item)};
        visits.push(visit);
      }else{
        visit.endTime = Math.max(visit.endTime,entry.end,entry.start);
        visit.eating = visit.eating || isEating(entry.item);
      }
    }
    return visits;
  }

  function ensurePanel(){
    const stats = document.getElementById('spookyStats');
    if(!stats || document.getElementById('spookyHourly')) return Boolean(stats);

    const holder = document.createElement('div');
    holder.id = 'spookyHourly';
    holder.className = 'spooky-hourly';
    holder.innerHTML =
      '<div class="spooky-hourly-head">' +
        '<div><div class="spooky-hourly-title">Dagritme per uur</div>' +
        '<div id="spookyHourlyPeriod" class="spooky-hourly-sub">Bezoeken en eetmomenten · laatste 7 dagen</div></div>' +
        '<span id="spookyHourlyCount" class="badge">0 bezoeken</span>' +
      '</div>' +
      '<div class="spooky-hourly-scroll"><div id="spookyHourlyGrid" class="spooky-hourly-grid"></div></div>' +
      '<div class="spooky-hourly-summary">' +
        '<div class="spooky-hourly-summary-card"><span>Drukste bezoekuur</span><b id="spookyBusiestVisitHour">-</b></div>' +
        '<div class="spooky-hourly-summary-card"><span>Drukste eetuur</span><b id="spookyBusiestEatingHour">-</b></div>' +
      '</div>';

    const weekCard = stats.querySelector('.spooky-week-card');
    if(weekCard) stats.insertBefore(holder,weekCard);
    else stats.appendChild(holder);
    return true;
  }

  function hourLabel(hour){
    return String(hour).padStart(2,'0') + ':00–' + String((hour + 1) % 24).padStart(2,'0') + ':00';
  }

  function busiest(counts){
    const max = Math.max(...counts);
    if(max <= 0) return null;
    return {hour:counts.indexOf(max),count:max};
  }

  function render(visits){
    const grid = document.getElementById('spookyHourlyGrid');
    if(!grid) return;

    const today = new Date();
    today.setHours(0,0,0,0);
    const periodStart = today.getTime() - (selectedDays - 1) * DAY_MS;
    const period = visits.filter(visit => visit.startTime >= periodStart);
    const visitCounts = Array(24).fill(0);
    const eatingCounts = Array(24).fill(0);

    period.forEach(visit => {
      const hour = new Date(visit.startTime).getHours();
      visitCounts[hour]++;
      if(visit.eating) eatingCounts[hour]++;
    });

    const visitMax = Math.max(1,...visitCounts);
    const eatingMax = Math.max(1,...eatingCounts);
    let html = '<div></div>';
    for(let hour = 0; hour < 24; hour++) html += '<div class="spooky-hourly-hour">' + String(hour).padStart(2,'0') + '</div>';

    html += '<div class="spooky-hourly-label">Bezoeken</div>';
    for(let hour = 0; hour < 24; hour++){
      const count = visitCounts[hour];
      const heat = count ? (0.18 + 0.72 * (count / visitMax)).toFixed(2) : '0.06';
      html += '<div class="spooky-hourly-cell" style="--heat:' + heat + '" title="' + hourLabel(hour) + ': ' + count + ' bezoek(en)">' + (count || '') + '</div>';
    }

    html += '<div class="spooky-hourly-label">Eten</div>';
    for(let hour = 0; hour < 24; hour++){
      const count = eatingCounts[hour];
      const heat = count ? (0.18 + 0.72 * (count / eatingMax)).toFixed(2) : '0.06';
      html += '<div class="spooky-hourly-cell eating" style="--heat:' + heat + '" title="' + hourLabel(hour) + ': ' + count + ' eetmoment(en)">' + (count || '') + '</div>';
    }

    grid.innerHTML = html;

    const topVisit = busiest(visitCounts);
    const topEating = busiest(eatingCounts);
    const visitEl = document.getElementById('spookyBusiestVisitHour');
    const eatingEl = document.getElementById('spookyBusiestEatingHour');
    const countEl = document.getElementById('spookyHourlyCount');
    const periodEl = document.getElementById('spookyHourlyPeriod');

    if(visitEl) visitEl.textContent = topVisit ? hourLabel(topVisit.hour) + ' · ' + topVisit.count : '-';
    if(eatingEl) eatingEl.textContent = topEating ? hourLabel(topEating.hour) + ' · ' + topEating.count : '-';
    if(countEl) countEl.textContent = String(period.length) + ' bezoek' + (period.length === 1 ? '' : 'en');
    if(periodEl) periodEl.textContent = 'Bezoeken en eetmomenten · laatste ' + selectedDays + ' dagen';
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
      const data = await response.json();
      render(cluster(Array.isArray(data?.events) ? data.events : []));
    }catch(error){
      console.warn('[spooky-hourly] ' + error.message);
    }finally{
      busy = false;
    }
  }

  document.addEventListener('click',event => {
    const button = event.target.closest?.('[data-spooky-days]');
    if(!button) return;
    selectedDays = Number(button.dataset.spookyDays) === 30 ? 30 : 7;
    setTimeout(() => {void refresh();},0);
  });

  ensurePanel();
  void refresh();
  window.addEventListener('security:viewchange',() => {void refresh();});
  document.addEventListener('visibilitychange',() => {if(!document.hidden) void refresh();});
  setInterval(() => {void refresh();},30000);
})();
</script>
`;

fs.readFileSync = function spookyHourlyReadFileSync(file, options) {
  const data = previousReadFileSync(file, options);
  const normalized = String(file).replaceAll('\\', '/');
  if (!normalized.endsWith('/public/security.html')) return data;

  const encoding = typeof options === 'string' ? options : options?.encoding;
  const returnBuffer = !encoding && Buffer.isBuffer(data);
  let text = Buffer.isBuffer(data) ? data.toString('utf8') : String(data);

  if (!text.includes('id="spooky-hourly-style"')) {
    text = text.replace('</body>', spookyHourlyInjection + '\n</body>');
  }

  return returnBuffer ? Buffer.from(text, 'utf8') : text;
};
