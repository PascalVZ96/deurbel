import fs from 'node:fs';

const previousReadFileSync = fs.readFileSync.bind(fs);

const diagnosticInjection = String.raw`
<script id="pwa-diagnostics-script">
(() => {
  const startedAt = Date.now();
  let installPromptSeen = false;
  let interactionSeen = false;

  window.addEventListener('beforeinstallprompt', () => {
    installPromptSeen = true;
    window.__securityPwaInstallPromptSeen = true;
    renderIfOpen();
  });

  window.addEventListener('pointerdown', () => {
    interactionSeen = true;
    renderIfOpen();
  }, {once:true, passive:true});

  window.addEventListener('keydown', () => {
    interactionSeen = true;
    renderIfOpen();
  }, {once:true});

  const wantsDiagnostics = () => {
    const params = new URLSearchParams(location.search);
    return params.get('pwa') === 'diag' || location.hash === '#pwa-diagnose';
  };

  function escapeHtml(value){
    return String(value ?? '').replace(/[&<>"']/g, c => ({
      '&':'&amp;',
      '<':'&lt;',
      '>':'&gt;',
      '"':'&quot;',
      "'":'&#39;'
    }[c]));
  }

  function row(label, value, ok = null){
    const state = ok === true ? 'ok' : ok === false ? 'bad' : 'neutral';
    const icon = ok === true ? '✓' : ok === false ? '✕' : '•';
    return '<div class="pwa-diag-row">' +
      '<span class="pwa-diag-state ' + state + '">' + icon + '</span>' +
      '<span class="pwa-diag-label">' + escapeHtml(label) + '</span>' +
      '<strong>' + escapeHtml(value) + '</strong>' +
      '</div>';
  }

  async function collect(){
    const result = {};
    result.secureContext = window.isSecureContext;
    result.standalone = !!(
      window.matchMedia?.('(display-mode: standalone)').matches ||
      navigator.standalone === true
    );
    result.installPromptSeen =
      installPromptSeen ||
      window.__securityPwaInstallPromptSeen === true;
    result.interactionSeen = interactionSeen;
    result.secondsOpen = Math.floor((Date.now() - startedAt) / 1000);

    const manifestLink = document.querySelector('link[rel="manifest"]');
    result.manifestHref = manifestLink?.href || '';

    try {
      const response = await fetch(
        manifestLink?.href || '/pwa/manifest.webmanifest',
        {cache:'no-store', credentials:'include'}
      );
      result.manifestStatus = response.status;
      result.manifestType = response.headers.get('content-type') || '';
      result.manifest = await response.json();
    } catch (error) {
      result.manifestError = error.message;
    }

    result.swSupported = 'serviceWorker' in navigator;

    if(result.swSupported){
      try {
        const regs = await navigator.serviceWorker.getRegistrations();
        result.registrations = regs.map(reg => ({
          scope: reg.scope,
          active: reg.active?.scriptURL || '',
          waiting: reg.waiting?.scriptURL || '',
          installing: reg.installing?.scriptURL || ''
        }));
        result.controller = navigator.serviceWorker.controller?.scriptURL || '';
      } catch (error) {
        result.swError = error.message;
      }
    }

    try {
      const swResponse = await fetch('/service-worker.js', {cache:'no-store'});
      result.swHttpStatus = swResponse.status;
      result.swHttpType = swResponse.headers.get('content-type') || '';
    } catch (error) {
      result.swHttpError = error.message;
    }

    return result;
  }

  function ensurePanel(){
    let panel = document.getElementById('pwaDiagnostics');
    if(panel) return panel;

    panel = document.createElement('section');
    panel.id = 'pwaDiagnostics';
    panel.innerHTML =
      '<div class="pwa-diag-head">' +
        '<div>' +
          '<div class="pwa-diag-eyebrow">Chrome / Android</div>' +
          '<h2>PWA-diagnose</h2>' +
        '</div>' +
        '<button type="button" id="pwaDiagClose" aria-label="Sluiten">×</button>' +
      '</div>' +
      '<div id="pwaDiagBody">Controleren…</div>' +
      '<div class="pwa-diag-actions">' +
        '<button type="button" id="pwaDiagRefresh">Opnieuw controleren</button>' +
        '<button type="button" id="pwaDiagCopy">Kopieer resultaat</button>' +
      '</div>';

    document.body.appendChild(panel);

    if(!document.getElementById('pwaDiagnosticsStyle')){
      const style = document.createElement('style');
      style.id = 'pwaDiagnosticsStyle';
      style.textContent =
        '#pwaDiagnostics{position:fixed;z-index:10000;left:12px;right:12px;bottom:calc(12px + env(safe-area-inset-bottom,0px));max-width:620px;margin:auto;max-height:82dvh;overflow:auto;padding:18px;border:1px solid #344155;border-radius:20px;background:#0f151e;color:#eef4fb;box-shadow:0 22px 80px rgba(0,0,0,.6);font-family:system-ui,-apple-system,sans-serif}' +
        '.pwa-diag-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start}' +
        '.pwa-diag-head h2{margin:2px 0 12px;font-size:22px}' +
        '.pwa-diag-eyebrow{font-size:10px;text-transform:uppercase;letter-spacing:.14em;color:#8b9bb0;font-weight:800}' +
        '.pwa-diag-head button{border:1px solid #344155;background:#171f2b;color:#fff;border-radius:10px;width:36px;height:36px;font-size:24px}' +
        '.pwa-diag-row{display:grid;grid-template-columns:24px minmax(110px,1fr) minmax(120px,1.4fr);gap:8px;align-items:start;padding:9px 0;border-bottom:1px solid #202b39;font-size:12px}' +
        '.pwa-diag-row strong{overflow-wrap:anywhere;text-align:right}' +
        '.pwa-diag-state{font-weight:900}.pwa-diag-state.ok{color:#75d89a}.pwa-diag-state.bad{color:#ff7e8d}.pwa-diag-state.neutral{color:#90a0b4}' +
        '.pwa-diag-label{color:#9cabbc}' +
        '.pwa-diag-note{margin:12px 0 0;padding:11px;border-radius:12px;background:#151e29;color:#afbdcc;font-size:11px;line-height:1.5}' +
        '.pwa-diag-actions{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:14px}' +
        '.pwa-diag-actions button{min-height:42px;border-radius:11px;border:1px solid #344155;background:#1a2532;color:#eef4fb;font-weight:750}' +
        'html[data-theme="light"] #pwaDiagnostics{background:#fff;color:#19334b;border-color:#cdd9e3}' +
        'html[data-theme="light"] .pwa-diag-row{border-color:#dfe7ee}' +
        'html[data-theme="light"] .pwa-diag-note{background:#edf4f9;color:#496276}' +
        'html[data-theme="light"] .pwa-diag-actions button,html[data-theme="light"] .pwa-diag-head button{background:#edf4f9;color:#19334b;border-color:#cdd9e3}';

      document.head.appendChild(style);
    }

    document.getElementById('pwaDiagClose').onclick = () => panel.remove();
    document.getElementById('pwaDiagRefresh').onclick = () => render(panel);
    document.getElementById('pwaDiagCopy').onclick = async () => {
      const data = await collect();
      const text = JSON.stringify(data, null, 2);
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        prompt('Kopieer dit resultaat:', text);
      }
    };

    return panel;
  }

  async function render(panel = ensurePanel()){
    const body = panel.querySelector('#pwaDiagBody');
    body.textContent = 'Controleren…';

    const data = await collect();
    const m = data.manifest || {};
    const sizes = (m.icons || []).map(icon => icon.sizes).filter(Boolean);
    const has192 = sizes.some(value =>
      String(value).split(/\s+/).includes('192x192')
    );
    const has512 = sizes.some(value =>
      String(value).split(/\s+/).includes('512x512')
    );
    const rootRegistration = (data.registrations || []).find(
      reg => reg.scope === location.origin + '/'
    );

    body.innerHTML = [
      row('HTTPS / secure context', data.secureContext ? 'ja' : 'nee', data.secureContext),
      row('Manifest HTTP', data.manifestStatus ? String(data.manifestStatus) : (data.manifestError || 'fout'), data.manifestStatus === 200),
      row('Manifest type', data.manifestType || 'onbekend', /manifest\+json|application\/json/.test(data.manifestType || '')),
      row('Naam', m.name || m.short_name || 'ontbreekt', !!(m.name || m.short_name)),
      row('Start URL', m.start_url || 'ontbreekt', !!m.start_url),
      row('Display', m.display || 'ontbreekt', ['standalone','fullscreen','minimal-ui','window-controls-overlay'].includes(m.display)),
      row('192×192 icoon', has192 ? 'aanwezig' : 'ontbreekt', has192),
      row('512×512 icoon', has512 ? 'aanwezig' : 'ontbreekt', has512),
      row('Service worker HTTP', data.swHttpStatus ? String(data.swHttpStatus) : (data.swHttpError || 'fout'), data.swHttpStatus === 200),
      row('Root SW registratie', rootRegistration?.active || 'niet actief', !!rootRegistration?.active),
      row('Pagina controlled door SW', data.controller || 'nee', !!data.controller),
      row('beforeinstallprompt', data.installPromptSeen ? 'AFGEVUURD' : 'nog niet gezien', data.installPromptSeen ? true : null),
      row('Interactie deze pagina', data.interactionSeen ? 'ja' : 'nog niet', data.interactionSeen ? true : null),
      row('Tijd deze pagina open', data.secondsOpen + ' sec.', data.secondsOpen >= 30 ? true : null),
      row('Standalone actief', data.standalone ? 'ja (appmodus)' : 'nee (browser)', data.standalone ? true : null)
    ].join('') +
      '<div class="pwa-diag-note">' +
      'De beslissende regel is <strong>beforeinstallprompt</strong>. ' +
      'Als alle manifestregels groen zijn maar die na een tik en 30+ seconden niet afgaat, ' +
      'ligt de blokkade aan Chrome/apparaat-installatie en niet meer aan het Security Center.' +
      '</div>';
  }

  function renderIfOpen(){
    const panel = document.getElementById('pwaDiagnostics');
    if(panel) render(panel);
  }

  if(wantsDiagnostics()){
    if(document.readyState === 'loading'){
      document.addEventListener('DOMContentLoaded', () => render());
    } else {
      render();
    }
  }
})();
</script>`;

fs.readFileSync = function pwaDiagnosticsReadFileSync(file, options) {
  const data = previousReadFileSync(file, options);
  const normalized = String(file).replaceAll('\\', '/');
  if (!normalized.endsWith('/public/security.html')) return data;

  const encoding = typeof options === 'string' ? options : options?.encoding;
  const returnBuffer = !encoding && Buffer.isBuffer(data);
  let text = Buffer.isBuffer(data) ? data.toString('utf8') : String(data);

  if (!text.includes('id="pwa-diagnostics-script"')) {
    text = text.replace('</body>', diagnosticInjection + '\n</body>');
  }

  return returnBuffer ? Buffer.from(text, 'utf8') : text;
};