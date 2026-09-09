import fs from 'node:fs';

const previousReadFileSync = fs.readFileSync.bind(fs);

const spookyRecordsInjection = String.raw`
<style id="spooky-records-style">
#spookyStats .spooky-records-title{
  margin:20px 2px 10px;
  font-size:1rem;
  font-weight:820;
}
#spookyStats .spooky-records-grid{
  display:grid;
  grid-template-columns:repeat(4,minmax(0,1fr));
  gap:12px;
  margin-bottom:14px;
}
#spookyStats .spooky-record-card{
  padding:16px;
  border:1px solid var(--line);
  border-radius:16px;
  background:var(--panel);
}
#spookyStats .spooky-record-label{
  color:var(--muted);
  font-size:.82rem;
  font-weight:700;
}
#spookyStats .spooky-record-value{
  margin-top:6px;
  font-size:1.35rem;
  line-height:1.15;
  font-weight:830;
  letter-spacing:-.03em;
}
#spookyStats .spooky-record-sub{
  margin-top:5px;
  color:var(--muted);
  font-size:.78rem;
  line-height:1.4;
}
@media(max-width:1050px){
  #spookyStats .spooky-records-grid{grid-template-columns:repeat(2,minmax(0,1fr))}
}
@media(max-width:520px){
  #spookyStats .spooky-records-grid{grid-template-columns:1fr 1fr;gap:8px}
  #spookyStats .spooky-record-card{padding:12px}
  #spookyStats .spooky-record-value{font-size:1.15rem}
}
@media(max-width:380px){
  #spookyStats .spooky-records-grid{grid-template-columns:1fr}
}
</style>
<script id="spooky-records-script">
(() => {
  const GAP_MS = 5 * 60 * 1000;
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

  function isSpooky(item){return /\bspooky\b/i.test(textFor(item));}
  function isEating(item){return Boolean(item?.eating) || /\beet\b|\beten\b|\bgegeten\b|eetmoment|voerhouding/.test(textFor(item));}

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
    visits.forEach(visit => {visit.durationMs = Math.max(0,visit.endTime - visit.startTime);});
    return visits;
  }

  function ensurePanel(){
    const stats = document.getElementById('spookyStats');
    if(!stats || document.getElementById('spookyRecords')) return Boolean(stats);

    const holder = document.createElement('div');
    holder.id = 'spookyRecords';
    holder.innerHTML =
      '<div class="spooky-records-title">Records</div>' +
      '<div class="spooky-records-grid">' +
        '<article class="spooky-record-card"><div class="spooky-record-label">Drukste dag</div>' +
        '<div id="spookyRecordBusiestDay" class="spooky-record-value">-</div>' +
        '<div id="spookyRecordBusiestDaySub" class="spooky-record-sub">nog te weinig gegevens</div></article>' +
        '<article class="spooky-record-card"><div class="spooky-record-label">Meeste eetmomenten op 1 dag</div>' +
        '<div id="spookyRecordEatingDay" class="spooky-record-value">-</div>' +
        '<div id="spookyRecordEatingDaySub" class="spooky-record-sub">nog te weinig gegevens</div></article>' +
        '<article class="spooky-record-card"><div class="spooky-record-label">Langste bezoek</div>' +
        '<div id="spookyRecordLongestVisit" class="spooky-record-value">-</div>' +
        '<div id="spookyRecordLongestVisitSub" class="spooky-record-sub">hele logboek</div></article>' +
        '<article class="spooky-record-card"><div class="spooky-record-label">Langste eetbezoek</div>' +
        '<div id="spookyRecordLongestEating" class="spooky-record-value">-</div>' +
        '<div id="spookyRecordLongestEatingSub" class="spooky-record-sub">hele logboek</div></article>' +
      '</div>';

    const hourly = document.getElementById('spookyHourly');
    const weekCard = stats.querySelector('.spooky-week-card');
    if(hourly) hourly.insertAdjacentElement('afterend',holder);
    else if(weekCard) stats.insertBefore(holder,weekCard);
    else stats.appendChild(holder);
    return true;
  }

  function dayKey(ms){
    const d = new Date(ms);
    return String(d.getFullYear()) + '-' + String(d.getMonth() + 1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
  }

  function formatDate(ms){
    if(!ms) return '-';
    return new Date(ms).toLocaleDateString('nl-NL',{weekday:'short',day:'2-digit',month:'short'}).replace('.','');
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

  function setText(id,value){
    const el = document.getElementById(id);
    if(el) el.textContent = value;
  }

  function bestDay(visits, predicate = () => true){
    const map = new Map();
    visits.filter(predicate).forEach(visit => {
      const key = dayKey(visit.startTime);
      const current = map.get(key) || {count:0,first:visit.startTime};
      current.count++;
      current.first = Math.min(current.first,visit.startTime);
      map.set(key,current);
    });
    const rows = [...map.values()].sort((a,b) => b.count - a.count || b.first - a.first);
    return rows[0] || null;
  }

  function longest(visits){
    return visits.reduce((best,visit) => !best || visit.durationMs > best.durationMs ? visit : best,null);
  }

  function render(visits){
    const busiest = bestDay(visits);
    const eatingDay = bestDay(visits,visit => visit.eating);
    const longestVisit = longest(visits);
    const longestEating = longest(visits.filter(visit => visit.eating));

    setText('spookyRecordBusiestDay',busiest ? String(busiest.count) + ' bezoek' + (busiest.count === 1 ? '' : 'en') : '-');
    setText('spookyRecordBusiestDaySub',busiest ? formatDate(busiest.first) : 'nog te weinig gegevens');

    setText('spookyRecordEatingDay',eatingDay ? String(eatingDay.count) + ' eetmoment' + (eatingDay.count === 1 ? '' : 'en') : '-');
    setText('spookyRecordEatingDaySub',eatingDay ? formatDate(eatingDay.first) : 'nog te weinig gegevens');

    setText('spookyRecordLongestVisit',longestVisit ? formatDuration(longestVisit.durationMs) : '-');
    setText('spookyRecordLongestVisitSub',longestVisit ? formatDate(longestVisit.startTime) + (longestVisit.eating ? ' · met eten' : ' · zonder eten') : 'hele logboek');

    setText('spookyRecordLongestEating',longestEating ? formatDuration(longestEating.durationMs) : '-');
    setText('spookyRecordLongestEatingSub',longestEating ? formatDate(longestEating.startTime) : 'hele logboek');
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
      console.warn('[spooky-records] ' + error.message);
    }finally{
      busy = false;
    }
  }

  ensurePanel();
  void refresh();
  window.addEventListener('security:viewchange',() => {void refresh();});
  document.addEventListener('visibilitychange',() => {if(!document.hidden) void refresh();});
  setInterval(() => {void refresh();},30000);
})();
</script>
`;

fs.readFileSync = function spookyRecordsReadFileSync(file, options) {
  const data = previousReadFileSync(file, options);
  const normalized = String(file).replaceAll('\\', '/');
  if (!normalized.endsWith('/public/security.html')) return data;

  const encoding = typeof options === 'string' ? options : options?.encoding;
  const returnBuffer = !encoding && Buffer.isBuffer(data);
  let text = Buffer.isBuffer(data) ? data.toString('utf8') : String(data);

  if (!text.includes('id="spooky-records-style"')) {
    text = text.replace('</body>', spookyRecordsInjection + '\n</body>');
  }

  return returnBuffer ? Buffer.from(text, 'utf8') : text;
};
