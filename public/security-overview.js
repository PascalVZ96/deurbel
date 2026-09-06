(() => {
  const sourceInfo = source => {
    if (source === 'eufy') return { icon:'🚪', label:'Eufy Voordeur' };
    if (source === 'petfeeder') return { icon:'🐾', label:'Pet Feeder' };
    if (source === 'localcar') return { icon:'🚗', label:'LSC Parkeerplaats' };
    if (source === 'lsc') return { icon:'⌂', label:'LSC Parkeerplaats' };
    return { icon:'◉', label:'Camera' };
  };

  const timestamp = value => {
    if (value === null || value === undefined || value === '') return 0;
    const numeric = Number(value);
    if (String(value).trim() !== '' && Number.isFinite(numeric)) {
      return numeric < 1e12 ? numeric * 1000 : numeric;
    }
    const parsed = new Date(value).getTime();
    return Number.isFinite(parsed) ? parsed : 0;
  };

  const timeLabel = value => {
    const ms = timestamp(value);
    if (!ms) return 'Tijd onbekend';
    return new Date(ms).toLocaleString('nl-NL', {
      day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit'
    });
  };

  function ensureSnapshot(card, id) {
    if (!card || card.querySelector('.camera-overview-snapshot')) return;
    const box = document.createElement('div');
    box.className = 'camera-overview-snapshot';
    box.id = id;
    box.innerHTML = '<div class="camera-overview-snapshot-placeholder">Laatste momentopname laden…</div>';
    card.prepend(box);
  }

  function setSnapshot(id, item, fallback) {
    const box = document.getElementById(id);
    if (!box) return;
    if (!item?.thumbnailUrl) {
      box.innerHTML = `<div class="camera-overview-snapshot-placeholder">${fallback}</div>`;
      return;
    }

    const src = String(item.thumbnailUrl) + (String(item.thumbnailUrl).includes('?') ? '&' : '?') + 'overview=' + Date.now();
    box.innerHTML = '<div class="camera-overview-snapshot-placeholder">Momentopname laden…</div>';

    const img = document.createElement('img');
    img.alt = 'Laatste momentopname';
    img.loading = 'lazy';
    img.onload = () => {
      const placeholder = box.querySelector('.camera-overview-snapshot-placeholder');
      if (placeholder) placeholder.remove();
    };
    img.onerror = () => {
      box.innerHTML = `<div class="camera-overview-snapshot-placeholder">${fallback}</div>`;
    };
    img.src = src;
    box.appendChild(img);

    const badge = document.createElement('span');
    badge.className = 'camera-overview-snapshot-badge';
    badge.textContent = 'Laatste momentopname';
    box.appendChild(badge);
  }

  async function updateCameraSnapshots() {
    const cards = [...document.querySelectorAll('#cameraOverview .camera-overview-card')];
    ensureSnapshot(cards[0], 'camEufySnapshot');
    ensureSnapshot(cards[1], 'camLscSnapshot');
    ensureSnapshot(cards[2], 'camPetSnapshot');

    try {
      const response = await fetch('/api/ai/history?limit=30', {
        cache:'no-store',
        signal:AbortSignal.timeout(12000),
      });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      const data = await response.json();
      const history = Array.isArray(data.history) ? data.history : [];

      const latest = predicate => history
        .filter(predicate)
        .sort((a,b) => timestamp(b.createdAt) - timestamp(a.createdAt))[0] || null;

      const eufy = latest(item => item.source === 'eufy');
      const lsc = latest(item => item.source === 'lsc' || item.source === 'localcar');
      const pet = latest(item => item.source === 'petfeeder');

      setSnapshot('camEufySnapshot', eufy, 'Nog geen momentopname van de voordeur');
      setSnapshot('camLscSnapshot', lsc, 'Nog geen momentopname van de parkeerplaats');
      setSnapshot('camPetSnapshot', pet, 'Nog geen momentopname van de voerbak');
    } catch (error) {
      setSnapshot('camEufySnapshot', null, 'Momentopname niet bereikbaar');
      setSnapshot('camLscSnapshot', null, 'Momentopname niet bereikbaar');
      setSnapshot('camPetSnapshot', null, 'Momentopname niet bereikbaar');
      console.warn('[overview] Momentopnames:', error.message);
    }
  }

  function enhanceRecentAlerts() {
    const container = document.getElementById('recentAiList');
    if (!container) return;

    const cards = [...container.children].filter(node =>
      node.classList?.contains('ai-history-item') && !node.dataset.recentWrapped
    );

    for (const card of cards) {
      card.dataset.recentWrapped = '1';

      const source = card.dataset.source || '';
      const info = sourceInfo(source);
      const title = card.querySelector('.ai-history-title')?.textContent?.trim() || 'Nieuwe melding';
      const meta = [...card.querySelectorAll('.ai-history-meta span')].map(span => span.textContent.trim());
      const sourceText = meta[0] || info.label;
      const dateText = meta[1] || '';

      const details = document.createElement('details');
      details.className = 'recent-alert';

      const summary = document.createElement('summary');
      summary.className = 'recent-alert-summary';
      summary.innerHTML = `
        <span class="recent-alert-icon" aria-hidden="true">${info.icon}</span>
        <span>
          <span class="recent-alert-title">${escapeText(title)}</span>
          <span class="recent-alert-meta">${escapeText([sourceText, dateText].filter(Boolean).join(' · '))}</span>
        </span>
        <span class="recent-alert-chevron" aria-hidden="true">⌄</span>`;

      const body = document.createElement('div');
      body.className = 'recent-alert-body';

      card.replaceWith(details);
      body.appendChild(card);
      details.append(summary, body);
    }
  }

  function escapeText(value) {
    return String(value ?? '')
      .replace(/&/g,'&amp;')
      .replace(/</g,'&lt;')
      .replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;')
      .replace(/'/g,'&#39;');
  }

  function watchRecentAlerts() {
    const container = document.getElementById('recentAiList');
    if (!container) return;

    const observer = new MutationObserver(() => enhanceRecentAlerts());
    observer.observe(container, { childList:true });
    enhanceRecentAlerts();
  }

  function init() {
    updateCameraSnapshots();
    watchRecentAlerts();

    setInterval(() => {
      if (!document.hidden) updateCameraSnapshots();
    }, 30000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once:true });
  } else {
    init();
  }
})();
