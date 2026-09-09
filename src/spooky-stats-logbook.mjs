import fs from 'node:fs';

const previousReadFileSync = fs.readFileSync.bind(fs);

const replacementLoader = String.raw`  async function loadPetFeederEvents(){
    try{
      const response = await fetch('/api/spooky/logbook',{cache:'no-store'});
      if(!response.ok) throw new Error('Logboek HTTP ' + response.status);
      const data = await response.json();
      if(Array.isArray(data?.events)) return data.events;
    }catch(error){
      console.warn('[spooky-stats] Permanent logboek niet beschikbaar: ' + error.message);
    }

    const response = await fetch('/api/ai/history?limit=100',{cache:'no-store'});
    if(!response.ok) throw new Error('Historie HTTP ' + response.status);
    const data = await response.json();
    return (Array.isArray(data?.history) ? data.history : [])
      .filter(item => item?.source === 'petfeeder');
  }
`;

fs.readFileSync = function spookyStatsLogbookReadFileSync(file, options) {
  const data = previousReadFileSync(file, options);
  const normalized = String(file).replaceAll('\\', '/');

  if (!normalized.endsWith('/public/security.html')) return data;

  const encoding = typeof options === 'string' ? options : options?.encoding;
  const returnBuffer = !encoding && Buffer.isBuffer(data);
  let text = Buffer.isBuffer(data) ? data.toString('utf8') : String(data);

  const start = text.indexOf('  async function loadPetFeederEvents(){');
  const end = start >= 0
    ? text.indexOf('\n  function renderBars(visits){', start)
    : -1;

  if (start >= 0 && end > start) {
    text = text.slice(0, start) + replacementLoader + text.slice(end);
  }

  text = text.replace(
    'Bezoeken en eetmomenten bij de Pet Feeder op basis van AI-meldingen.',
    'Bezoeken en eetmomenten bij de Pet Feeder uit het permanente Spooky-logboek.'
  );

  return returnBuffer ? Buffer.from(text, 'utf8') : text;
};
