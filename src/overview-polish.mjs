import fs from 'node:fs';

const previousReadFileSync = fs.readFileSync.bind(fs);

const overviewPolishInjection = String.raw`
<style id="overview-polish-style">
#view-overview .metrics{
  grid-template-columns:repeat(4,minmax(0,1fr));
  gap:10px;
  margin-bottom:24px;
}

#view-overview .metric{
  min-height:0;
  padding:13px 15px;
  border-radius:14px;
}

#view-overview .metric:nth-child(5){
  display:none;
}

#view-overview .metric-label{
  font-size:.78rem;
}

#view-overview .metric-value{
  margin-top:5px;
  font-size:1.55rem;
  line-height:1.1;
}

#view-overview .metric-sub{
  margin-top:4px;
  font-size:.74rem;
  line-height:1.35;
}

#view-overview .battery-meter{
  height:5px;
  margin-top:8px;
}

#cameraOverview .section-head{
  margin-bottom:12px;
}

#cameraOverview .camera-overview-grid{
  gap:12px;
}

#cameraOverview .camera-overview-card{
  display:flex;
  flex-direction:column;
  padding:0;
  border-radius:16px;
}

#cameraOverview .camera-overview-card::before{
  display:none;
}

#cameraOverview .camera-overview-snapshot{
  position:relative;
  width:100%;
  aspect-ratio:16/9;
  overflow:hidden;
  background:#06090d;
  border-bottom:1px solid rgba(255,255,255,.06);
}

#cameraOverview .camera-overview-snapshot img{
  display:block;
  width:100%;
  height:100%;
  object-fit:cover;
}

#cameraOverview .camera-overview-snapshot-empty{
  position:absolute;
  inset:0;
  display:grid;
  place-items:center;
  padding:18px;
  color:#718093;
  font-size:.8rem;
  text-align:center;
  background:linear-gradient(135deg,#0c131c,#091018);
}

#cameraOverview .camera-overview-snapshot-label{
  position:absolute;
  left:10px;
  bottom:10px;
  z-index:2;
  padding:5px 8px;
  border-radius:999px;
  background:rgba(5,10,15,.78);
  border:1px solid rgba(255,255,255,.12);
  color:#eef4fb;
  font-size:.7rem;
  font-weight:700;
  backdrop-filter:blur(6px);
}

#cameraOverview .camera-overview-top{
  padding:13px 14px 0;
}

#cameraOverview .camera-overview-icon{
  width:36px;
  height:36px;
  flex-basis:36px;
  border-radius:10px;
  font-size:16px;
}

#cameraOverview .camera-overview-title{
  font-size:.98rem;
  font-weight:720;
}

#cameraOverview .camera-overview-sub{
  font-size:.73rem;
}

#cameraOverview .camera-overview-state{
  padding:5px 8px;
  font-size:.72rem;
}

#cameraOverview .camera-overview-ai{
  min-height:0;
  margin:10px 14px 0;
  padding:9px 10px;
  border-radius:10px;
}

#cameraOverview .camera-overview-ai-label{
  margin-bottom:2px;
  font-size:.68rem;
  letter-spacing:.06em;
}

#cameraOverview .camera-overview-ai-title{
  font-size:.82rem;
  font-weight:650;
  line-height:1.4;
}

#cameraOverview .camera-overview-bottom{
  margin-top:auto;
  padding:10px 14px 13px;
}

#cameraOverview .camera-overview-meta{
  font-size:.73rem;
}

#cameraOverview .camera-overview-link{
  padding:7px 9px;
  font-size:.76rem;
}

@media(max-width:900px){
  #view-overview .metrics{
    grid-template-columns:repeat(2,minmax(0,1fr));
  }
}

@media(max-width:520px){
  #view-overview .metrics{
    grid-template-columns:1fr 1fr;
    gap:8px;
  }

  #view-overview .metric{
    padding:11px 12px;
  }

  #view-overview .metric-value{
    font-size:1.35rem;
  }

  #cameraOverview .camera-overview-snapshot{
    aspect-ratio:16/8.5;
  }
}
</style>
<script id="overview-polish-script">
(() => {
  const sources = [
    { card:0, source:'eufy', label:'Laatste momentopname' },
    { card:1, source:'lsc', alternates:['localcar'], label:'Laatste momentopname' },
    { card:2, source:'petfeeder', label:'Laatste momentopname' }
  ];

  const cards = [...document.querySelectorAll('#cameraOverview .camera-overview-card')];

  function ensureSnapshots(){
    for(const config of sources){
      const card = cards[config.card];
      if(!card || card.querySelector('.camera-overview-snapshot')) continue;

      const box = document.createElement('div');
      box.className = 'camera-overview-snapshot';
      box.dataset.source = config.source;
      box.innerHTML = '<div class="camera-overview-snapshot-empty">Momentopname laden…</div>' +
        '<span class="camera-overview-snapshot-label">'+config.label+'</span>';
      card.prepend(box);
    }
  }

  function latestFor(config){
    if(typeof aiHistoryItems === 'undefined' || !Array.isArray(aiHistoryItems)) return null;
    const allowed = new Set([config.source, ...(config.alternates || [])]);
    return aiHistoryItems.find(item => allowed.has(item.source) && item.thumbnailUrl) || null;
  }

  function paintSnapshot(config){
    const card = cards[config.card];
    const box = card?.querySelector('.camera-overview-snapshot');
    if(!box) return;

    const item = latestFor(config);
    const current = box.dataset.thumbnail || '';
    const wanted = item?.thumbnailUrl || '';
    if(current === wanted) return;
    box.dataset.thumbnail = wanted;

    box.querySelector('img')?.remove();
    const oldEmpty = box.querySelector('.camera-overview-snapshot-empty');

    if(!wanted){
      if(oldEmpty) oldEmpty.textContent = 'Nog geen momentopname beschikbaar';
      else {
        const empty = document.createElement('div');
        empty.className = 'camera-overview-snapshot-empty';
        empty.textContent = 'Nog geen momentopname beschikbaar';
        box.prepend(empty);
      }
      return;
    }

    const empty = oldEmpty || document.createElement('div');
    empty.className = 'camera-overview-snapshot-empty';
    empty.textContent = 'Momentopname laden…';
    if(!empty.parentNode) box.prepend(empty);

    const img = document.createElement('img');
    img.alt = 'Laatste momentopname';
    img.loading = 'lazy';
    img.addEventListener('load', () => empty.remove(), {once:true});
    img.addEventListener('error', () => {
      img.remove();
      empty.textContent = 'Momentopname niet beschikbaar';
    }, {once:true});
    img.src = wanted;
    box.prepend(img);
  }

  function refreshSnapshots(){
    ensureSnapshots();
    sources.forEach(paintSnapshot);
  }

  ensureSnapshots();
  refreshSnapshots();

  if(typeof renderAiHistory === 'function'){
    const previousRenderAiHistory = renderAiHistory;
    renderAiHistory = function(...args){
      const result = previousRenderAiHistory.apply(this,args);
      refreshSnapshots();
      return result;
    };
  }

  window.addEventListener('security:viewchange', () => {
    if(typeof activeSecurityView === 'undefined' || activeSecurityView === 'overview') refreshSnapshots();
  });

  setInterval(() => {
    if(!document.hidden) refreshSnapshots();
  }, 15000);
})();
</script>
`;

fs.readFileSync = function overviewPolishedReadFileSync(file, options) {
  const data = previousReadFileSync(file, options);
  const normalized = String(file).replaceAll('\\', '/');

  if (!normalized.endsWith('/public/security.html')) return data;

  const encoding = typeof options === 'string' ? options : options?.encoding;
  const returnBuffer = !encoding && Buffer.isBuffer(data);
  let text = Buffer.isBuffer(data) ? data.toString('utf8') : String(data);

  if (!text.includes('id="overview-polish-style"')) {
    text = text.replace('</body>', overviewPolishInjection + '\n</body>');
  }

  return returnBuffer ? Buffer.from(text, 'utf8') : text;
};
