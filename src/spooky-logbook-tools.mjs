import fs from 'node:fs';

const previousReadFileSync = fs.readFileSync.bind(fs);

const injection = String.raw`
<style id="spooky-logbook-tools-style">
#spookyStats .spooky-logbook-actions{
  display:flex;
  align-items:center;
  justify-content:flex-end;
  gap:8px;
  flex-wrap:wrap;
}
#spookyStats .spooky-backup-badge[data-state="ok"]{opacity:.9}
#spookyStats .spooky-backup-badge[data-state="error"]{opacity:.9}
@media(max-width:620px){
  #spookyStats .section-head{align-items:flex-start}
  #spookyStats .spooky-logbook-actions{justify-content:flex-start}
}
</style>
<script id="spooky-logbook-tools-script">
(() => {
  let busy = false;

  function ensureTools(){
    const stats = document.getElementById('spookyStats');
    if(!stats) return false;
    if(document.getElementById('spookyLogbookExport')) return true;

    const head = stats.querySelector('.section-head');
    if(!head) return false;

    const existingAction = head.querySelector('a.btn');
    const actions = document.createElement('div');
    actions.className = 'spooky-logbook-actions';

    if(existingAction){
      existingAction.replaceWith(actions);
      actions.appendChild(existingAction);
    }else{
      head.appendChild(actions);
    }

    const exportLink = document.createElement('a');
    exportLink.id = 'spookyLogbookExport';
    exportLink.className = 'btn';
    exportLink.href = '/api/spooky/logbook/export';
    exportLink.setAttribute('download','');
    exportLink.textContent = 'Exporteer logboek';
    actions.appendChild(exportLink);

    const badge = document.createElement('span');
    badge.id = 'spookyBackupBadge';
    badge.className = 'badge spooky-backup-badge';
    badge.textContent = 'Backup controleren…';
    actions.appendChild(badge);

    return true;
  }

  async function refresh(){
    if(busy || document.hidden) return;
    if(!ensureTools()){
      setTimeout(() => {void refresh();},250);
      return;
    }

    busy = true;
    try{
      const response = await fetch('/api/spooky/logbook',{cache:'no-store'});
      if(!response.ok) throw new Error('HTTP ' + response.status);
      const data = await response.json();
      const badge = document.getElementById('spookyBackupBadge');
      if(!badge) return;

      const backup = data?.backup || {};
      if(backup.available){
        const copies = Number(backup.copies || 0);
        badge.dataset.state = 'ok';
        badge.textContent = 'Backup · ' + copies + ' dag' + (copies === 1 ? '' : 'en');
        badge.title = backup.directory || '';
      }else{
        badge.dataset.state = 'error';
        badge.textContent = backup.lastError ? 'Backup fout' : 'Backup wordt gemaakt';
        badge.title = backup.lastError || '';
      }
    }catch(error){
      const badge = document.getElementById('spookyBackupBadge');
      if(badge){
        badge.dataset.state = 'error';
        badge.textContent = 'Backupstatus onbekend';
        badge.title = error.message;
      }
    }finally{
      busy = false;
    }
  }

  ensureTools();
  void refresh();
  window.addEventListener('security:viewchange',() => {void refresh();});
  document.addEventListener('visibilitychange',() => {if(!document.hidden) void refresh();});
  setInterval(() => {void refresh();},60000);
})();
</script>
`;

fs.readFileSync = function spookyLogbookToolsReadFileSync(file, options) {
  const data = previousReadFileSync(file, options);
  const normalized = String(file).replaceAll('\\', '/');
  if (!normalized.endsWith('/public/security.html')) return data;

  const encoding = typeof options === 'string' ? options : options?.encoding;
  const returnBuffer = !encoding && Buffer.isBuffer(data);
  let text = Buffer.isBuffer(data) ? data.toString('utf8') : String(data);

  if (!text.includes('id="spooky-logbook-tools-style"')) {
    text = text.replace('</body>', injection + '\n</body>');
  }

  return returnBuffer ? Buffer.from(text, 'utf8') : text;
};
