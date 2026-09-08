import fs from 'node:fs';

const previousReadFileSync = fs.readFileSync.bind(fs);

const sessionUiInjection = String.raw`
<style id="security-session-ui-style">
.security-session{
  display:inline-flex;
  align-items:center;
  gap:8px;
  min-height:38px;
  padding:4px 5px 4px 10px;
  border:1px solid var(--line);
  border-radius:999px;
  background:#171e28;
  color:#cbd5e1;
}
.security-session-user{
  display:inline-flex;
  align-items:center;
  gap:6px;
  max-width:180px;
  font-size:.76rem;
  font-weight:700;
  white-space:nowrap;
  overflow:hidden;
  text-overflow:ellipsis;
}
.security-session-user::before{
  content:'●';
  color:var(--good);
  font-size:.62rem;
}
.security-logout{
  appearance:none;
  min-height:29px;
  padding:5px 9px;
  border-radius:999px;
  border:1px solid #354252;
  background:#202a36;
  color:#eef3f8;
  font:inherit;
  font-size:.72rem;
  font-weight:760;
  cursor:pointer;
}
.security-logout:hover{background:#2a3644}
html[data-theme="light"] .security-session{
  background:#fff;
  border-color:#d5e0ea;
  color:#496277;
}
html[data-theme="light"] .security-logout{
  background:#eef4f9;
  border-color:#d5e1eb;
  color:#294761;
}
html[data-theme="light"] .security-logout:hover{background:#e1ebf3}
.ai-history-item.notification-deeplink-target{
  outline:2px solid #70a7ff;
  outline-offset:3px;
  box-shadow:0 0 0 7px rgba(112,167,255,.12),var(--shadow);
  animation:notificationDeeplinkPulse 1.2s ease-out 2;
}
@keyframes notificationDeeplinkPulse{
  0%{box-shadow:0 0 0 0 rgba(112,167,255,.30),var(--shadow)}
  100%{box-shadow:0 0 0 12px rgba(112,167,255,0),var(--shadow)}
}
@media(max-width:720px){
  .security-session{padding-left:7px}
  .security-session-user span{display:none}
  .security-session-user{width:10px;overflow:visible}
  .security-logout{padding:5px 8px}
}
</style>
<script id="security-session-ui-script">
(() => {
  const actions=document.querySelector('.top-actions');

  async function addSessionControl(){
    if(!actions || document.getElementById('securitySession')) return;
    try{
      const response=await fetch('/api/session',{cache:'no-store',credentials:'same-origin'});
      if(!response.ok)return;
      const session=await response.json();
      if(!session?.authenticated)return;

      const box=document.createElement('div');
      box.id='securitySession';
      box.className='security-session';

      const user=document.createElement('span');
      user.className='security-session-user';
      user.title='Ingelogd als '+String(session.username||'gebruiker');
      const label=document.createElement('span');
      label.textContent=String(session.username||'gebruiker');
      user.append(label);

      const form=document.createElement('form');
      form.method='post';
      form.action='/logout';
      form.style.margin='0';

      const button=document.createElement('button');
      button.type='submit';
      button.className='security-logout';
      button.textContent='Uitloggen';
      button.setAttribute('aria-label','Uitloggen bij Security Center');
      form.append(button);

      box.append(user,form);
      actions.append(box);
    }catch{}
  }

  const targetId=new URLSearchParams(location.search).get('alert');
  let targetHandled=false;
  let targetAttempts=0;

  function showTarget(){
    if(targetHandled || !targetId)return;
    targetAttempts++;

    if(typeof aiHistoryItems==='undefined' || !Array.isArray(aiHistoryItems) || !aiHistoryItems.length){
      if(targetAttempts<80)setTimeout(showTarget,250);
      return;
    }

    const index=aiHistoryItems.findIndex(item=>String(item?.id||'')===targetId);
    if(index<0){
      if(!aiHistoryLoaded && targetAttempts<80){setTimeout(showTarget,250);return}
      targetHandled=true;
      if(typeof toast==='function')toast('Deze melding staat niet meer tussen de 100 meest recente AI-meldingen.');
      return;
    }

    try{
      aiHistorySource='all';
      aiHistoryPage=Math.floor(index/AI_HISTORY_PAGE_SIZE)+1;
      const search=document.getElementById('aiHistorySearch');
      const period=document.getElementById('aiHistoryPeriod');
      if(search)search.value='';
      if(period)period.value='all';
      document.querySelectorAll('.ai-history-filter').forEach(button=>{
        const active=(button.dataset.source||'all')==='all';
        button.classList.toggle('active',active);
        button.setAttribute('aria-pressed',String(active));
      });
      if(typeof renderAiHistory==='function')renderAiHistory();
    }catch{}

    if(location.hash!=='#aiHistory'){
      history.replaceState(history.state,'',location.pathname+location.search+'#aiHistory');
      if(typeof selectSecurityView==='function')selectSecurityView();
    }

    const button=[...document.querySelectorAll('[data-history-id]')]
      .find(node=>node.dataset.historyId===targetId);
    const card=button?.closest('.ai-history-item');

    if(!card){
      if(targetAttempts<80){setTimeout(showTarget,250);return}
      return;
    }

    targetHandled=true;
    card.classList.add('notification-deeplink-target');
    card.scrollIntoView({behavior:'smooth',block:'center'});
    setTimeout(()=>card.classList.remove('notification-deeplink-target'),7000);
  }

  addSessionControl();
  if(targetId){
    if(location.hash!=='#aiHistory'){
      history.replaceState(history.state,'',location.pathname+location.search+'#aiHistory');
      if(typeof selectSecurityView==='function')selectSecurityView(true);
    }
    setTimeout(showTarget,100);
  }
})();
</script>
`;

fs.readFileSync = function sessionUiReadFileSync(file, options) {
  const data = previousReadFileSync(file, options);
  const normalized = String(file).replaceAll('\\', '/');
  if (!normalized.endsWith('/public/security.html')) return data;

  const encoding = typeof options === 'string' ? options : options?.encoding;
  const returnBuffer = !encoding && Buffer.isBuffer(data);
  let text = Buffer.isBuffer(data) ? data.toString('utf8') : String(data);

  if (!text.includes('id="security-session-ui-script"')) {
    text = text.replace('</body>', sessionUiInjection + '\n</body>');
  }

  return returnBuffer ? Buffer.from(text, 'utf8') : text;
};
