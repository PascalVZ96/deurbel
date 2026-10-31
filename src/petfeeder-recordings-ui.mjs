// Adds Pet Feeder review clips to the authenticated Security Center recordings tab.
// Does not change Eufy recordings or Frigate's own retention settings.
import fs from 'node:fs';

const originalReadFileSync = fs.readFileSync.bind(fs);
const injection = String.raw`
<style id="petfeeder-recordings-style">
#pfRecordings{margin-top:24px}
#pfRecordings .pf-rec-heading{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:12px}
#pfRecordings .pf-rec-heading h2{margin:0;font-size:1.14rem}
#pfRecordings .pf-rec-heading p{margin:5px 0 0;color:var(--muted,#91a1b5);font-size:.82rem}
#pfRecordings .pf-rec-actions{display:flex;gap:8px;flex-wrap:wrap}
#pfRecordings .pf-rec-actions button,#pfRecordings .pf-rec-actions a,#pfRecordings .pf-rec-item button{color:inherit;background:#182637;border:1px solid #32485d;border-radius:9px;padding:9px 12px;cursor:pointer;text-decoration:none;font-size:.82rem}
#pfRecordings .pf-rec-actions button:hover,#pfRecordings .pf-rec-actions a:hover,#pfRecordings .pf-rec-item button:hover{background:#22374d}
#pfRecordings .pf-rec-list{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px}
#pfRecordings .pf-rec-item{border:1px solid #293849;background:#111a24;border-radius:13px;overflow:hidden;min-width:0}
#pfRecordings .pf-rec-image{height:126px;background:#080e13;display:flex;align-items:center;justify-content:center;color:#8292a4;font-size:.78rem;overflow:hidden}
#pfRecordings .pf-rec-image img{width:100%;height:100%;object-fit:cover}
#pfRecordings .pf-rec-image .pf-rec-placeholder{position:absolute;inset:0;display:grid;place-items:center;pointer-events:none}
#pfRecordings .pf-rec-details{padding:12px;display:flex;flex-direction:column;gap:7px}
#pfRecordings .pf-rec-details strong{font-size:.9rem}
#pfRecordings .pf-rec-details small{font-size:.75rem;color:#a7b6c7}
#pfRecordings .pf-rec-item button{align-self:flex-start}
#pfRecordings .pf-rec-status{margin-bottom:12px;color:#a9bacb;font-size:.82rem}
#pfRecordings .pf-rec-player{margin-top:16px;padding:12px;background:#0c1219;border:1px solid #304055;border-radius:13px}
#pfRecordings .pf-rec-player video{display:block;width:100%;max-height:68vh;background:#000;border-radius:8px}
#pfRecordings .pf-rec-player p{color:#a9bacb;font-size:.82rem;margin:8px 0 0}
#pfRecordings .pf-rec-player button{float:right;background:#1c2936;border:1px solid #3b4d60;border-radius:8px;color:#fff;padding:6px 10px;cursor:pointer}
</style>
<script id="petfeeder-recordings-script">
(() => {
  function mount() {
    const parent = document.getElementById('view-recordings');
    if (!parent || document.getElementById('pfRecordings')) return;
    const sec = document.createElement('section');
    sec.id = 'pfRecordings';
    sec.className = 'section';
    sec.innerHTML = '<div class="pf-rec-heading"><div><h2>Pet Feeder-opnames</h2><p>Bewegingen en herkende dieren uit Frigate · doorlopende beelden via Geschiedenis</p></div><div class="pf-rec-actions"><button type="button" id="pfRecRefresh">Vernieuwen</button><a href="/frigate/" target="_blank" rel="noopener">Volledige geschiedenis ↗</a></div></div><div class="pf-rec-status" id="pfRecStatus">Opnames laden…</div><div class="pf-rec-list" id="pfRecList"></div><div class="pf-rec-player" id="pfRecPlayer" hidden><button type="button" id="pfRecClose">Sluiten</button><strong id="pfRecPlayerTitle">Opname</strong><video controls playsinline preload="metadata" id="pfRecVideo"></video><p id="pfRecVideoStatus">Kies een opname</p></div>';
    parent.appendChild(sec);
    sec.querySelector('.pf-rec-actions a').href = 'https://' + location.hostname + ':8971/';
    document.getElementById('pfRecRefresh').addEventListener('click', load);
    document.getElementById('pfRecClose').addEventListener('click', close);
    document.getElementById('pfRecVideo').addEventListener('error', () => {
      document.getElementById('pfRecVideoStatus').textContent = 'Clip nog niet beschikbaar. Probeer het later of bekijk de volledige opname in Frigate.';
    });
    load();
  }
  function close() {
    const video = document.getElementById('pfRecVideo');
    if (video) { video.pause(); video.removeAttribute('src'); video.load(); }
    const player = document.getElementById('pfRecPlayer');
    if (player) player.hidden = true;
  }
  function dateText(value) {
    if (value === null || value === undefined) return 'Onbekend tijdstip';
    const n = Number(value);
    const d = Number.isFinite(n) && String(value).trim() !== ''
      ? new Date(n < 1e12 ? n * 1000 : n)
      : new Date(value);
    return Number.isFinite(d.getTime())
      ? d.toLocaleString('nl-NL',{dateStyle:'medium',timeStyle:'short'})
      : 'Onbekend tijdstip';
  }
  function play(item) {
    const player = document.getElementById('pfRecPlayer');
    const video = document.getElementById('pfRecVideo');
    document.getElementById('pfRecPlayerTitle').textContent = 'Pet Feeder · ' + dateText(item.startTime);
    document.getElementById('pfRecVideoStatus').textContent = 'Clip wordt geladen…';
    player.hidden = false;
    video.src = item.videoUrl;
    video.load();
    video.play().catch(() => {
      document.getElementById('pfRecVideoStatus').textContent = 'Klik op afspelen om de clip te bekijken.';
    });
    player.scrollIntoView({behavior:'smooth',block:'nearest'});
  }
  let loading = false;
  async function load() {
    const list = document.getElementById('pfRecList');
    const status = document.getElementById('pfRecStatus');
    if (!list || !status || loading) return;
    loading = true;
    status.textContent = 'Pet Feeder-opnames ophalen…';
    try {
      const r = await fetch('/api/petfeeder/recordings/reviews', {cache:'no-store'});
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'HTTP ' + r.status);
      list.replaceChildren();
      const items = Array.isArray(d.items) ? d.items : [];
      if (!items.length) {
        status.textContent = 'Nog geen gedetecteerde gebeurtenissen. Doorlopende video is al beschikbaar in Frigate bij Geschiedenis.';
        return;
      }
      status.textContent = items.length + ' recente gebeurtenis' + (items.length === 1 ? '' : 'sen') + ' · klik op Bekijken voor een clip.';
      for (const item of items) {
        const card = document.createElement('article');
        card.className = 'pf-rec-item';
        const frame = document.createElement('div');
        frame.className = 'pf-rec-image';
        const placeholder = document.createElement('span');
        placeholder.className = 'pf-rec-placeholder';
        placeholder.textContent = 'Momentopname laden…';
        const img = document.createElement('img');
        img.alt = 'Pet Feeder-opname';
        img.loading = 'lazy';
        img.addEventListener('load', () => { placeholder.remove(); });
        img.addEventListener('error', () => {
          img.remove();
          placeholder.textContent = 'Momentopname niet beschikbaar';
        });
        // Insert before assigning src: lazy-loaded detached images may never load.
        frame.replaceChildren(img, placeholder);
        img.src = item.thumbUrl;
        const content = document.createElement('div');
        content.className = 'pf-rec-details';
        const title = document.createElement('strong');
        title.textContent = dateText(item.startTime);
        const info = document.createElement('small');
        const cats = Array.isArray(item.labels) ? item.labels.filter(x => typeof x === 'string').slice(0,3) : [];
        info.textContent = (item.severity === 'alert' ? 'Waarschuwing' : 'Detectie') + (cats.length ? ' · ' + cats.join(', ') : '');
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = '▶ Bekijken';
        button.addEventListener('click', () => play(item));
        content.append(title,info,button);
        card.append(frame,content);
        list.appendChild(card);
      }
    } catch (e) {
      status.textContent = 'Frigate-opnames tijdelijk niet bereikbaar: ' + e.message;
    } finally { loading = false; }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',mount,{once:true});
  else mount();
  window.addEventListener('security:viewchange', () => {
    if (location.hash.includes('recordings')) load();
  });
})();
</script>
`;

fs.readFileSync = function petFeederRecordingReadFileSync(file, options) {
  const data = originalReadFileSync(file, options);
  const normalized = String(file).replaceAll('\\', '/');
  if (!normalized.endsWith('/public/security.html')) return data;
  const encoding = typeof options === 'string' ? options : options?.encoding;
  const bufferOutput = !encoding && Buffer.isBuffer(data);
  let html = Buffer.isBuffer(data) ? data.toString('utf8') : String(data);
  if (!html.includes('id="petfeeder-recordings-script"')) {
    html = html.replace('</body>', injection + '\n</body>');
  }
  return bufferOutput ? Buffer.from(html, 'utf8') : html;
};
