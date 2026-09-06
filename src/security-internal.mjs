import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const originalListen = http.Server.prototype.listen;
const originalReadFileSync = fs.readFileSync.bind(fs);

const overviewAlertsInjection = String.raw`
<style id="overview-alert-accordion-style">
#recentAiList{
  gap:8px;
}

#recentAiList .overview-alert-item{
  overflow:hidden;
  border:1px solid var(--soft);
  border-radius:14px;
  background:linear-gradient(135deg,rgba(18,27,38,.78),rgba(10,16,23,.86));
}

#recentAiList .overview-alert-summary{
  list-style:none;
  display:grid;
  grid-template-columns:38px minmax(0,1fr) auto;
  align-items:center;
  gap:12px;
  padding:12px 14px;
  cursor:pointer;
  user-select:none;
}

#recentAiList .overview-alert-summary::-webkit-details-marker{
  display:none;
}

#recentAiList .overview-alert-icon{
  width:38px;
  height:38px;
  display:grid;
  place-items:center;
  border-radius:11px;
  background:#172333;
  border:1px solid #2a3c52;
  font-size:17px;
}

#recentAiList .overview-alert-heading{
  min-width:0;
}

#recentAiList .overview-alert-title{
  overflow:hidden;
  color:#eef4fb;
  font-size:.9375rem;
  font-weight:680;
  line-height:1.35;
  text-overflow:ellipsis;
  white-space:nowrap;
}

#recentAiList .overview-alert-meta{
  margin-top:3px;
  color:#8492a4;
  font-size:.75rem;
}

#recentAiList .overview-alert-chevron{
  color:#8290a2;
  font-size:18px;
  line-height:1;
  transition:transform .15s ease;
}

#recentAiList .overview-alert-item[open] .overview-alert-chevron{
  transform:rotate(180deg);
}

#recentAiList .overview-alert-body{
  display:grid;
  grid-template-columns:120px minmax(0,1fr);
  gap:14px;
  padding:14px;
  border-top:1px solid rgba(255,255,255,.06);
  background:rgba(6,11,17,.28);
}

#recentAiList .overview-alert-thumb{
  position:relative;
  width:120px;
  aspect-ratio:4/3;
  overflow:hidden;
  border-radius:11px;
  background:#06090d;
  border:1px solid rgba(255,255,255,.07);
}

#recentAiList .overview-alert-thumb img{
  display:block;
  width:100%;
  height:100%;
  object-fit:cover;
}

#recentAiList .overview-alert-thumb-empty{
  position:absolute;
  inset:0;
  display:grid;
  place-items:center;
  padding:10px;
  color:#718093;
  font-size:.72rem;
  text-align:center;
}

#recentAiList .overview-alert-info{
  min-width:0;
}

#recentAiList .overview-alert-description,
#recentAiList .overview-alert-scene{
  margin:0;
  color:#b7c4d3;
  font-size:.875rem;
  line-height:1.55;
}

#recentAiList .overview-alert-scene{
  margin-top:8px;
  color:#8f9daf;
}

#recentAiList .overview-alert-tags{
  display:flex;
  flex-wrap:wrap;
  gap:6px;
  margin-top:10px;
}

#recentAiList .overview-alert-tag{
  padding:4px 7px;
  border-radius:999px;
  background:#101923;
  border:1px solid rgba(255,255,255,.06);
  color:#8796a8;
  font-size:.72rem;
}

#recentAiList .overview-alert-tag.warn{
  color:#ffe9a7;
  background:#2b2410;
  border-color:#665823;
}

#recentAiList .overview-alert-tag.danger{
  color:#ffc2c8;
  background:#2f1519;
  border-color:#693139;
}

#recentAiList .overview-alert-actions{
  display:flex;
  gap:8px;
  flex-wrap:wrap;
  margin-top:12px;
}

#recentAiList .overview-alert-open{
  appearance:none;
  min-height:38px;
  padding:8px 11px;
  border:1px solid #304760;
  border-radius:10px;
  color:#eef4fb;
  background:#172536;
  font:inherit;
  font-size:.8125rem;
  font-weight:700;
  cursor:pointer;
}

#recentAiList .overview-alert-open:hover:not(:disabled){
  background:#21344b;
}

#recentAiList .overview-alert-open:disabled{
  opacity:.48;
  cursor:not-allowed;
}

@media(max-width:620px){
  #recentAiList .overview-alert-summary{
    grid-template-columns:34px minmax(0,1fr) auto;
    gap:10px;
    padding:11px 12px;
  }

  #recentAiList .overview-alert-icon{
    width:34px;
    height:34px;
    font-size:15px;
  }

  #recentAiList .overview-alert-body{
    grid-template-columns:1fr;
    padding:12px;
  }

  #recentAiList .overview-alert-thumb{
    width:100%;
    max-width:220px;
    aspect-ratio:16/9;
  }
}
</style>
<script id="overview-alert-accordion-script">
(() => {
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;'
  }[c]));

  const timestamp = value => {
    if(value === null || value === undefined || value === '') return NaN;
    if(typeof value === 'number' || /^[0-9.]+$/.test(String(value))){
      const n = Number(value);
      return n < 1000000000000 ? n * 1000 : n;
    }
    return new Date(value).getTime();
  };

  const timeLabel = value => {
    const time = timestamp(value);
    return Number.isFinite(time)
      ? new Date(time).toLocaleTimeString('nl-NL',{hour:'2-digit',minute:'2-digit'})
      : 'Tijd onbekend';
  };

  const sourceInfo = source => {
    if(source === 'localcar') return {icon:'🚗', name:'LSC · lokaal'};
    if(source === 'eufy') return {icon:'🚪', name:'Eufy Voordeur'};
    if(source === 'petfeeder') return {icon:'🐾', name:'Pet Feeder'};
    if(source === 'lsc') return {icon:'🏠', name:'LSC Parkeerplaats'};
    return {icon:'◉', name:'Camera'};
  };

  const threatInfo = item => {
    if(item.local || item.source === 'localcar') return {text:'Lokale detectie', cls:''};
    const value = item.potentialThreatLevel;
    const n = Number(value);
    if(value === null || value === undefined || value === '' || !Number.isFinite(n)){
      return {text:'Niet beoordeeld', cls:''};
    }
    if(n >= 2) return {text:'Dreiging '+n, cls:'danger'};
    if(n === 1) return {text:'Dreiging 1', cls:'warn'};
    return {text:'Geen dreiging', cls:''};
  };

  const hasRecording = item => Boolean(
    (item.recordingType === 'eufy' && (item.recordingFile || item.videoUrl)) ||
    (item.recordingType === 'local-car' && item.videoUrl) ||
    (item.recordingType === 'frigate' && item.reviewId)
  );

  const card = item => {
    const source = sourceInfo(item.source);
    const threat = threatInfo(item);
    const confidence = Number(item.confidence);
    const confidenceText = item.confidence !== null && item.confidence !== undefined && item.confidence !== '' && Number.isFinite(confidence)
      ? Math.round(confidence * 100) + '%'
      : null;
    const objects = Array.isArray(item.objects) ? item.objects.map(String).filter(Boolean) : [];
    const summary = item.shortSummary || item.scene || 'Geen beschrijving beschikbaar.';
    const scene = item.scene && item.scene !== summary ? item.scene : '';
    const thumb = item.thumbnailUrl
      ? '<img loading="lazy" src="'+esc(item.thumbnailUrl)+'" alt="Momentopname van '+esc(source.name)+'">'
      : '<div class="overview-alert-thumb-empty">Geen momentopname</div>';

    return '<details class="overview-alert-item" data-alert-id="'+esc(item.id)+'">' +
      '<summary class="overview-alert-summary">' +
        '<span class="overview-alert-icon" aria-hidden="true">'+source.icon+'</span>' +
        '<span class="overview-alert-heading">' +
          '<span class="overview-alert-title">'+esc(item.title || 'Gebeurtenis')+'</span>' +
          '<span class="overview-alert-meta">'+esc(source.name)+' · '+esc(timeLabel(item.createdAt))+'</span>' +
        '</span>' +
        '<span class="overview-alert-chevron" aria-hidden="true">⌄</span>' +
      '</summary>' +
      '<div class="overview-alert-body">' +
        '<div class="overview-alert-thumb">'+thumb+'</div>' +
        '<div class="overview-alert-info">' +
          '<p class="overview-alert-description">'+esc(summary)+'</p>' +
          (scene ? '<p class="overview-alert-scene">'+esc(scene)+'</p>' : '') +
          '<div class="overview-alert-tags">' +
            '<span class="overview-alert-tag '+threat.cls+'">'+esc(threat.text)+'</span>' +
            (confidenceText ? '<span class="overview-alert-tag">Zekerheid '+esc(confidenceText)+'</span>' : '') +
            objects.map(object => '<span class="overview-alert-tag">'+esc(object)+'</span>').join('') +
          '</div>' +
          '<div class="overview-alert-actions">' +
            '<button type="button" class="overview-alert-open" data-history-id="'+esc(item.id)+'" '+(hasRecording(item) ? '' : 'disabled')+'>' +
              (hasRecording(item) ? '▶ Bekijk opname' : 'Geen opname') +
            '</button>' +
          '</div>' +
        '</div>' +
      '</div>' +
    '</details>';
  };

  if(typeof renderAiItems !== 'function') return;
  const originalRenderAiItems = renderAiItems;

  renderAiItems = function(container, items, emptyText){
    if(!container || container.id !== 'recentAiList'){
      return originalRenderAiItems(container, items, emptyText);
    }

    const key = JSON.stringify([items, emptyText]);
    if(container.dataset.overviewAlertRenderKey === key) return;

    const openIds = new Set(
      [...container.querySelectorAll('details[open][data-alert-id]')]
        .map(details => details.dataset.alertId)
        .filter(Boolean)
    );

    container.dataset.overviewAlertRenderKey = key;
    container.innerHTML = items.length
      ? items.map(card).join('')
      : '<div class="ai-history-empty">'+esc(emptyText)+'</div>';

    container.querySelectorAll('details[data-alert-id]').forEach(details => {
      if(openIds.has(details.dataset.alertId)) details.open = true;
    });

    container.querySelectorAll('[data-history-id]').forEach(button => {
      button.addEventListener('click', event => {
        event.stopPropagation();
        if(!button.disabled && typeof openAiHistoryItem === 'function'){
          openAiHistoryItem(button.dataset.historyId);
        }
      });
    });

    container.querySelectorAll('.overview-alert-thumb img').forEach(img => {
      img.addEventListener('error', () => {
        const fallback = document.createElement('div');
        fallback.className = 'overview-alert-thumb-empty';
        fallback.textContent = 'Momentopname niet beschikbaar';
        img.replaceWith(fallback);
      }, {once:true});
    });
  };

  if(typeof renderAiHistory === 'function') renderAiHistory();
})();
</script>
`;

fs.readFileSync = function patchedReadFileSync(file, options) {
  const data = originalReadFileSync(file, options);
  const target = String(file);
  const normalized = target.replaceAll('\\', '/');

  if (!normalized.endsWith('/public/security.html')) return data;

  const encoding = typeof options === 'string' ? options : options?.encoding;
  const returnBuffer = !encoding && Buffer.isBuffer(data);
  let text = Buffer.isBuffer(data) ? data.toString('utf8') : String(data);

  if (!text.includes('id="overview-alert-accordion-style"')) {
    text = text.replace('</body>', overviewAlertsInjection + '\n</body>');
  }

  return returnBuffer ? Buffer.from(text, 'utf8') : text;
};

http.Server.prototype.listen = function patchedListen(...args) {
  if (typeof args[0] === 'number') {
    if (typeof args[1] === 'string') args[1] = '127.0.0.1';
    else args.splice(1, 0, '127.0.0.1');
  }
  return originalListen.apply(this, args);
};

await import('./security-monitor.mjs');
