(()=>{
  async function addAccountControls(){
    const host=document.querySelector('.top-actions');
    if(!host || document.getElementById('authAccountControls')) return;

    let session=null;
    try{
      const response=await fetch('/api/auth/session',{cache:'no-store'});
      if(response.ok) session=await response.json();
    }catch{}
    if(!session?.authenticated) return;

    const wrap=document.createElement('div');
    wrap.id='authAccountControls';
    wrap.style.display='contents';

    const user=document.createElement('span');
    user.className='badge main';
    user.textContent=`👤 ${session.username}`;
    user.title='Ingelogde gebruiker';

    const logout=document.createElement('button');
    logout.type='button';
    logout.className='btn dark';
    logout.textContent='Uitloggen';
    logout.addEventListener('click',async()=>{
      logout.disabled=true;
      try{ await fetch('/api/auth/logout',{method:'POST'}); }catch{}
      location.replace('/login');
    });

    wrap.append(user,logout);
    host.append(wrap);
  }

  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded',addAccountControls,{once:true});
  else addAccountControls();
})();