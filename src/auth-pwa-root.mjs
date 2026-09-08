import http from 'node:http';

const previousCreateServer = http.createServer.bind(http);

const serviceWorker = String.raw`
const OFFLINE_HTML = '<!doctype html><html lang="nl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#090d12"><title>Security Center offline</title><style>*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:#090d12;color:#eef4fb;font-family:system-ui,-apple-system,sans-serif}.card{width:min(100%,420px);padding:26px;border-radius:22px;background:#111720;border:1px solid #26303d;text-align:center}.icon{font-size:42px}.title{font-size:24px;font-weight:800;margin:14px 0 8px}.text{color:#9aa8ba;line-height:1.55}.retry{margin-top:20px;min-height:44px;padding:10px 16px;border:0;border-radius:12px;background:#eef4fb;color:#111820;font:inherit;font-weight:800}</style></head><body><main class="card"><div class="icon">🔒</div><div class="title">Security Center is offline</div><div class="text">Er is nu geen verbinding met je server. Camera’s, opnames en AI-data worden bewust niet offline opgeslagen.</div><button class="retry" onclick="location.reload()">Opnieuw proberen</button></main></body></html>';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET' || request.mode !== 'navigate') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith(fetch(request).catch(() => new Response(OFFLINE_HTML, {
    status:503,
    headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}
  })));
});
`;

function sendServiceWorker(req, res) {
  const body = Buffer.from(serviceWorker);
  res.writeHead(200, {
    'Content-Type':'text/javascript; charset=utf-8',
    'Content-Length':body.length,
    'Cache-Control':'no-store',
    'X-Content-Type-Options':'nosniff',
  });
  if (req.method === 'HEAD') res.end();
  else res.end(body);
}

http.createServer = function authPwaRootCreateServer(options, listener) {
  let serverOptions = options;
  let requestListener = listener;
  if (typeof options === 'function') {
    requestListener = options;
    serverOptions = undefined;
  }

  const wrapped = (req, res) => {
    let pathname = '';
    try { pathname = new URL(req.url, `http://${req.headers.host || 'localhost'}`).pathname; } catch {}

    if ((req.method === 'GET' || req.method === 'HEAD') && pathname === '/service-worker.js') {
      sendServiceWorker(req, res);
      return;
    }

    return requestListener?.(req, res);
  };

  return serverOptions === undefined
    ? previousCreateServer(wrapped)
    : previousCreateServer(serverOptions, wrapped);
};
