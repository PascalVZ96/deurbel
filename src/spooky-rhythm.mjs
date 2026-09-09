import fs from 'node:fs';

const previousReadFileSync = fs.readFileSync.bind(fs);

const spookyRhythmInjection = String.raw`
<style id="spooky-rhythm-style">
#spookyStats .spooky-rhythm-title{
  margin:20px 2px 10px;
  font-size:1rem;
  font-weight:820;
}
#spookyStats .spooky-rhythm-grid{
  display:grid;
  grid-template-columns:repeat(4,minmax(0,1fr));
  gap:12px;
  margin-bottom:14px;
}
#spookyStats .spooky-rhythm-card{
  padding:16px;
  border:1px solid var(--line);
  border-radius:16px;
  background:var(--panel);
}
#spookyStats .spooky-rhythm-label{
  color:var(--muted);
  font-size:.82rem;
  font-weight:700;
}
#spookyStats .spooky-rhythm-value{
  margin-top:6px;
  font-size:1.45rem;
  line-height:1.15;
  font-weight:830;
  letter-spacing:-.03em;
}
#spookyStats .spooky-rhythm-sub{
  margin-top:5px;
  color:var(--muted);
  font-size:.78rem;
  line-height:1.4;
}
@media(max-width:1050px){
  #spookyStats .spooky-rhythm-grid{grid-template-columns:repeat(2,minmax(0,1fr))}
}
@media(max-width:520px){
  #spookyStats .spooky-rhythm-grid{grid-template-columns:1fr 1fr;gap:8px}
  #spookyStats .spooky-rhythm-card{padding:12px}
  #spookyStats .spooky-rhythm-value{font-size:1.2rem}
}
@media(max-width:380px){
  #spookyStats .spooky-rhythm-grid{grid-template-columns:1fr}
}
</style>
<script id="spooky-rhythm-script">
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
    return visits.sort((a,b) => b.endTime - a.endTime);
  }

  function formatElapsed(ms){
    if(!Number.isFinite(ms) || ms < 0) return '-';
    const minutes = Math.floor(ms / 60000);
    if(minutes < 1) return '<1 min';
    if(minutes < 60) return String(minutes) + ' min';
    const hours = Math.floor(minutes / 60);
    const restMinutes = minutes % 60;
    if(hours < 24) return restMinutes ? String(hours) + 'u ' + String(restMinutes) + 'm' : String(hours) + 'u';
    const days = Math.floor(hours / 24);
    const restHours = hours % 24;
    return restHours ? String(days) + 'd ' + String(restHours) + 'u' : String(days) + 'd';
  }

  function formatInterval(ms){
    if(!Number.isFinite(ms) || ms <= 0) return '-';
    const minutes = Math.round(ms / 60000);
    if(minutes < 60) return String(minutes) + ' min';
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return rest ? String(hours) + 'u ' + String(rest) + 'm' : String(hours) + 'u';
  }

  function ensurePanel(){
    const stats = document.getElementById('spookyStats');
    if(!stats || document.getElementById('spookyRhythm')) return Boolean(stats);

    const holder = document.createElement('div');
    holder.id = 'spookyRhythm';
    holder.innerHTML =
      '<div class="spooky-rhythm-title">Eetritme</div>' +
      '<div class="spooky-rhythm-grid">' +
        '<article class="spooky-rhythm-card"><div class="spooky-rhythm-label">Sinds laatste eetmoment</div>' +
        '<div id="spookySinceEating" class="spooky-rhythm-value">-</div>' +
        '<div class="spooky-rhythm-sub">tijd sinds laatste bezoek met eten</div></article>' +
        '<article class="spooky-rhythm-card"><div class="spooky-rhythm-label">Gem. tussen eetmomenten</div>' +
        '<div id="spookyEatingInterval" class="spooky-rhythm-value">-</div>' +
        '<div id="spookyEatingIntervalSub" class="spooky-rhythm-sub">nog te weinig gegevens</div></article>' +
        '<article class="spooky-rhythm-card"><div class="spooky-rhythm-label">Bezoeken met eten</div>' +
        '<div id="spookyEatingRatio" class="spooky-rhythm-value">-</div>' +
        '<div id="spookyEatingRatioSub" class="spooky-rhythm-sub">laatste 7 dagen</div></article>' +
        '<article class="spooky-rhythm-card"><div class="spooky-rhythm-label">Meest actief dagdeel</div>' +
        '<div id="spookyDaypart" class="spooky-rhythm-value">-</div>' +
        '<div id="spookyDaypartSub" class="spooky-rhythm-sub">nog te weinig gegevens</div></article>' +
      '</div>';

    const weekCard = stats.querySelector('.spooky-week-card');
    if(weekCard) stats.insertBefore(holder,weekCard);
    else stats.appendChild(holder);
    return true;
  }

  function setText(id,value){
    const el = document.getElementById(id);
    if(el) el.textContent = value;
  }

  function favoriteDaypart(visits){
    if(!visits.length) return null;
    const parts = [
      {name:'Nacht',start:0,end:6,count:0},
      {name:'Ochtend',start:6,end:12,count:0},
      {name:'Middag',start:12,end:18,count:0},
      {name:'Avond',start:18,end:24,count:0}
    ];
    visits.forEach(visit => {
      const hour = new Date(visit.startTime).getHours();
      const part = parts.find(item => hour >= item.start && hour < item.end);
      if(part) part.count++;
    });
    return parts.sort((a,b) => b.count - a.count)[0];
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
      const visits = cluster(Array.isArray(data?.events) ? data.events : []);
      const now = Date.now();
      const today = new Date();
      today.setHours(0,0,0,0);
      const periodStart = today.getTime() - (selectedDays - 1) * DAY_MS;
      const periodVisits = visits.filter(visit => visit.startTime >= periodStart);
      const periodEating = periodVisits.filter(visit => visit.eating).sort((a,b) => a.startTime - b.startTime);
      const lastEating = visits.find(visit => visit.eating) || null;

      setText('spookySinceEating',lastEating ? formatElapsed(now - lastEating.endTime) : '-');

      if(periodEating.length >= 2){
        const gaps = [];
        for(let i = 1; i < periodEating.length; i++) gaps.push(periodEating[i].startTime - periodEating[i - 1].endTime);
        const average = gaps.reduce((sum,value) => sum + value,0) / gaps.length;
        setText('spookyEatingInterval',formatInterval(average));
        setText('spookyEatingIntervalSub',String(periodEating.length) + ' eetmomenten in ' + selectedDays + ' dagen');
      }else{
        setText('spookyEatingInterval','-');
        setText('spookyEatingIntervalSub','nog te weinig gegevens');
      }

      const ratio = periodVisits.length ? Math.round((periodEating.length / periodVisits.length) * 100) : null;
      setText('spookyEatingRatio',ratio === null ? '-' : String(ratio) + '%');
      setText('spookyEatingRatioSub',String(periodEating.length) + ' van ' + String(periodVisits.length) + ' bezoeken · ' + selectedDays + ' dagen');

      const daypart = favoriteDaypart(periodVisits);
      setText('spookyDaypart',daypart ? daypart.name : '-');
      setText('spookyDaypartSub',daypart ? String(daypart.count) + ' bezoek' + (daypart.count === 1 ? '' : 'en') + ' · ' + selectedDays + ' dagen' : 'nog te weinig gegevens');
    }catch(error){
      console.warn('[spooky-rhythm] ' + error.message);
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

fs.readFileSync = function spookyRhythmReadFileSync(file, options) {
  const data = previousReadFileSync(file, options);
  const normalized = String(file).replaceAll('\\', '/');
  if (!normalized.endsWith('/public/security.html')) return data;

  const encoding = typeof options === 'string' ? options : options?.encoding;
  const returnBuffer = !encoding && Buffer.isBuffer(data);
  let text = Buffer.isBuffer(data) ? data.toString('utf8') : String(data);

  if (!text.includes('id="spooky-rhythm-style"')) {
    text = text.replace('</body>', spookyRhythmInjection + '\n</body>');
  }

  return returnBuffer ? Buffer.from(text, 'utf8') : text;
};
