import http from 'node:http';

const previousCreateServer = http.createServer.bind(http);

const manifest = JSON.stringify({
  id:'/',
  name:'Pascal Security Center',
  short_name:'Security',
  description:'Camera’s, AI-meldingen en opnames in één Security Center.',
  start_url:'/pwa/manifest.webmanifest?launch=1',
  scope:'/',
  display:'standalone',
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
    {name:'Opnames',short_name:'Opnames',url:'/#recordingsSection'}
  ]
}, null, 2);

const launchHtml = `<!doctype html>
<html lang="nl">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="theme-color" content="#090d12">
  <title>Security Center</title>
</head>
<body style="margin:0;background:#090d12;color:#eef4fb;font-family:system-ui">
  <main style="min-height:100vh;display:grid;place-items:center;text-align:center;padding:24px">
    <div><div style="font-size:36px">🔐</div><div style="margin-top:10px;font-weight:800">Security Center openen…</div></div>
  </main>
  <script>location.replace('/');</script>
</body>
</html>`;

function send(res,status,type,body,cacheControl='no-store'){
  const data=Buffer.from(body);
  res.writeHead(status,{
    'Content-Type':type,
    'Content-Length':data.length,
    'Cache-Control':cacheControl,
    'X-Content-Type-Options':'nosniff'
  });
  res.end(data);
}

http.createServer = function pwaBootstrapCreateServer(options, listener){
  let serverOptions=options;
  let requestListener=listener;

  if(typeof options==='function'){
    requestListener=options;
    serverOptions=undefined;
  }

  const wrapped=(req,res)=>{
    let url;
    try{url=new URL(req.url,`http://${req.headers.host||'localhost'}`)}catch{}

    if(req.method==='GET' && url?.pathname==='/pwa/manifest.webmanifest'){
      if(url.searchParams.get('launch')==='1'){
        send(res,200,'text/html; charset=utf-8',launchHtml,'no-store');
      }else{
        send(res,200,'application/manifest+json; charset=utf-8',manifest,'no-cache');
      }
      return;
    }

    return requestListener?.(req,res);
  };

  return serverOptions===undefined
    ? previousCreateServer(wrapped)
    : previousCreateServer(serverOptions,wrapped);
};
