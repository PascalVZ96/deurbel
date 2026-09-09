import fs from 'node:fs';

const previousReadFileSync = fs.readFileSync.bind(fs);

fs.readFileSync = function spookyVisitMergeReadFileSync(file, options) {
  const data = previousReadFileSync(file, options);
  const normalized = String(file).replaceAll('\\', '/');

  if (!normalized.endsWith('/public/security.html')) return data;

  const encoding = typeof options === 'string' ? options : options?.encoding;
  const returnBuffer = !encoding && Buffer.isBuffer(data);
  let text = Buffer.isBuffer(data) ? data.toString('utf8') : String(data);

  if (!text.includes('id="spooky-stats-script"')) {
    return data;
  }

  text = text.replace(
    '<div class="spooky-stat-sub">herkende Spooky-momenten</div>',
    '<div class="spooky-stat-sub">meldingen binnen 5 min samengevoegd</div>'
  );

  text = text.replace(
    '<span id="spookyDataCount" class="badge">0 gebeurtenissen</span>',
    '<span id="spookyDataCount" class="badge">0 bezoeken</span>'
  );

  const eatingBlock = String.raw`  function isEating(item){
    const text = String(item?.title || item?.shortSummary || '').toLowerCase();
    return /\beet\b|\beten\b|eetmoment|voerhouding/.test(text);
  }
`;

  const clusterBlock = eatingBlock + String.raw`
  const SPOOKY_VISIT_GAP_MS = 5 * 60 * 1000;

  function clusterSpookyVisits(items){
    const sorted = [...items]
      .map(item => ({ item, time:timeMs(item.createdAt ?? item.sortTime) }))
      .filter(entry => entry.time > 0)
      .sort((a,b) => a.time - b.time);

    const visits = [];

    for(const entry of sorted){
      let visit = visits[visits.length - 1];

      if(!visit || entry.time - visit.endTime > SPOOKY_VISIT_GAP_MS){
        visit = {
          startTime:entry.time,
          endTime:entry.time,
          events:[entry.item],
          eating:isEating(entry.item),
          latestEvent:entry.item
        };
        visits.push(visit);
        continue;
      }

      visit.endTime = entry.time;
      visit.events.push(entry.item);
      visit.eating = visit.eating || isEating(entry.item);
      visit.latestEvent = entry.item;
    }

    return visits.sort((a,b) => b.endTime - a.endTime);
  }
`;

  if (text.includes(eatingBlock) && !text.includes('function clusterSpookyVisits')) {
    text = text.replace(eatingBlock, clusterBlock);
  }

  const oldRender = String.raw`  function render(items){
    ensurePanel();
    const spooky = items
      .filter(isSpooky)
      .sort((a,b) => timeMs(b.createdAt ?? b.sortTime) - timeMs(a.createdAt ?? a.sortTime));

    const now = Date.now();
    const today = startOfDay(now);
    const week = startOfWeek(now);
    const todayItems = spooky.filter(item => timeMs(item.createdAt ?? item.sortTime) >= today);
    const weekItems = spooky.filter(item => timeMs(item.createdAt ?? item.sortTime) >= week);
    const todayEating = todayItems.filter(isEating);
    const weekEating = weekItems.filter(isEating);
    const latest = spooky[0] || null;
    const latestMs = latest ? timeMs(latest.createdAt ?? latest.sortTime) : 0;

    const setText = (id,value) => {
      const el = document.getElementById(id);
      if(el) el.textContent = value;
    };

    setText('spookyTodayVisits', String(todayItems.length));
    setText('spookyTodayEating', String(todayEating.length));
    setText('spookyWeekVisits', String(weekItems.length));
    setText('spookyWeekEating', String(weekEating.length) + ' eetmoment' + (weekEating.length === 1 ? '' : 'en') + ' deze week');
    setText('spookyLastTime', formatLast(latestMs));
    setText('spookyLastActivity', latest?.title || 'Nog geen Spooky-gebeurtenis');
    setText('spookyDataCount', String(spooky.length) + ' gebeurtenis' + (spooky.length === 1 ? '' : 'sen'));

    const empty = document.getElementById('spookyEmpty');
    if(empty) empty.hidden = spooky.length > 0;
    renderBars(spooky);
  }
`;

  const newRender = String.raw`  function render(items){
    ensurePanel();

    const spookyEvents = items.filter(isSpooky);
    const visits = clusterSpookyVisits(spookyEvents);

    const now = Date.now();
    const today = startOfDay(now);
    const week = startOfWeek(now);
    const todayVisits = visits.filter(visit => visit.startTime >= today);
    const weekVisits = visits.filter(visit => visit.startTime >= week);
    const todayEating = todayVisits.filter(visit => visit.eating);
    const weekEating = weekVisits.filter(visit => visit.eating);
    const latest = visits[0] || null;
    const latestMs = latest?.endTime || 0;

    const setText = (id,value) => {
      const el = document.getElementById(id);
      if(el) el.textContent = value;
    };

    setText('spookyTodayVisits', String(todayVisits.length));
    setText('spookyTodayEating', String(todayEating.length));
    setText('spookyWeekVisits', String(weekVisits.length));
    setText('spookyWeekEating', String(weekEating.length) + ' eetmoment' + (weekEating.length === 1 ? '' : 'en') + ' deze week');
    setText('spookyLastTime', formatLast(latestMs));
    setText('spookyLastActivity', latest?.latestEvent?.title || 'Nog geen Spooky-gebeurtenis');
    setText('spookyDataCount', String(visits.length) + ' bezoek' + (visits.length === 1 ? '' : 'en'));

    const empty = document.getElementById('spookyEmpty');
    if(empty) empty.hidden = visits.length > 0;
    renderBars(visits);
  }
`;

  if (text.includes(oldRender)) {
    text = text.replace(oldRender, newRender);
  }

  text = text.replace(
    'const t = timeMs(item.createdAt ?? item.sortTime);',
    'const t = item.startTime ?? timeMs(item.createdAt ?? item.sortTime);'
  );

  return returnBuffer ? Buffer.from(text, 'utf8') : text;
};
