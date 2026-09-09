import http from 'node:http';

const previousCreateServer = http.createServer.bind(http);

const manifest = JSON.stringify({
  id:'/',
  name:'Pascal Security Center',
  short_name:'Security',
  description:'Camera’s, AI-meldingen, Spooky-statistieken en opnames in één Security Center.',
  start_url:'/',
  scope:'/',
  display:'standalone',
  orientation:'any',
  background_color:'#090d12',
  theme_color:'#090d12',
  prefer_related_applications:false,
  icons:[
    {src:'/pwa/icon-192.png',sizes:'192x192',type:'image/png',purpose:'any'},
    {src:'/pwa/icon-512.png',sizes:'512x512',type:'image/png',purpose:'any'},
    {src:'/pwa/icon-512.png',sizes:'512x512',type:'image/png',purpose:'maskable'}
  ],
  shortcuts:[
    {name:'Camera’s',short_name:'Camera’s',url:'/#cameras'},
    {name:'AI-meldingen',short_name:'AI',url:'/#aiHistory'},
    {name:'Spooky',short_name:'Spooky',url:'/#spooky'},
    {name:'Opnames',short_name:'Opnames',url:'/#recordingsSection'}
  ]
},null,2);

http.createServer = function pwaManifestCurrentCreateServer(...args){
  let listener = null;
  if(typeof args[0] === 'function') listener = args[0];
  else if(typeof args[1] === 'function') listener = args[1];
  if(!listener) return previousCreateServer(...args);

  const wrapped = (req,res) => {
    let pathname='';
    try{pathname=new URL(req.url,`http://${req.headers.host||'localhost'}`).pathname}catch{}

    if(req.method==='GET' && pathname==='/pwa/manifest.webmanifest'){
      res.writeHead(200,{
        'Content-Type':'application/manifest+json; charset=utf-8',
        'Cache-Control':'no-store, max-age=0',
        'Pragma':'no-cache'
      });
      res.end(manifest);
      return;
    }

    return listener(req,res);
  };

  if(typeof args[0] === 'function') return previousCreateServer(wrapped);
  return previousCreateServer(args[0],wrapped);
};
