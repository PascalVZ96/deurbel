import http from 'node:http';
import crypto from 'node:crypto';

const config = {
  port: Number(process.env.WEB_PORT || 8090),
  upstreamPort: Number(process.env.DASHBOARD_INTERNAL_PORT || 8091),
  username: String(process.env.DASHBOARD_USERNAME || '').trim(),
  password: String(process.env.DASHBOARD_PASSWORD || ''),
  sessionSecret: String(process.env.DASHBOARD_SESSION_SECRET || ''),
  sessionHours: Math.max(1, Number(process.env.DASHBOARD_SESSION_HOURS || 24 * 14)),
};

const SESSION_COOKIE = 'security_session';
const loginAttempts = new Map();

function authConfigured() {
  return Boolean(config.username && config.password && config.sessionSecret.length >= 32);
}

function timingSafeEqualText(a, b) {
  const aa = crypto.createHash('sha256').update(String(a)).digest();
  const bb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(aa, bb);
}

function sign(value) {
  return crypto.createHmac('sha256', config.sessionSecret).update(value).digest('base64url');
}

function createSession() {
  const expires = Date.now() + config.sessionHours * 60 * 60 * 1000;
  const payload = Buffer.from(JSON.stringify({ u: config.username, e: expires })).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

function parseCookies(header = '') {
  const result = {};
  for (const part of String(header).split(';')) {
    const index = part.indexOf('=');
    if (index < 1) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key) result[key] = value;
  }
  return result;
}

function validSession(req) {
  if (!authConfigured()) return false;
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  if (!token) return false;
  const dot = token.lastIndexOf('.');
  if (dot < 1) return false;
  const payload = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  if (!timingSafeEqualText(signature, sign(payload))) return false;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return data.u === config.username && Number(data.e) > Date.now();
  } catch {
    return false;
  }
}

function clientIp(req) {
  return String(req.socket.remoteAddress || 'unknown');
}

function loginAllowed(req) {
  const ip = clientIp(req);
  const now = Date.now();
  const current = loginAttempts.get(ip);
  if (!current || now - current.startedAt > 15 * 60 * 1000) {
    loginAttempts.set(ip, { startedAt: now, count: 0 });
    return true;
  }
  return current.count < 8;
}

function registerFailedLogin(req) {
  const ip = clientIp(req);
  const now = Date.now();
  const current = loginAttempts.get(ip);
  if (!current || now - current.startedAt > 15 * 60 * 1000) {
    loginAttempts.set(ip, { startedAt: now, count: 1 });
  } else {
    current.count += 1;
  }
}

function clearLoginFailures(req) {
  loginAttempts.delete(clientIp(req));
}

function cookieSecure(req) {
  const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
  return proto === 'https' || Boolean(req.socket.encrypted);
}

function setSecurityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
}

function sendHtml(res, status, body) {
  const data = Buffer.from(body);
  setSecurityHeaders(res);
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': data.length,
    'Cache-Control': 'no-store',
  });
  res.end(data);
}

function loginPage(message = '') {
  const messageHtml = message ? `<div class="message">${escapeHtml(message)}</div>` : '';
  return `<!doctype html>
<html lang="nl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="theme-color" content="#090d12">
<title>Inloggen · Security Center</title>
<style>
:root{color-scheme:dark;--bg:#090d12;--panel:#111720;--line:#26303d;--text:#f5f7fb;--muted:#8f9bad;--danger:#ff7385}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:radial-gradient(circle at 20% 0,rgba(75,125,205,.18),transparent 34%),radial-gradient(circle at 100% 100%,rgba(61,116,90,.12),transparent 30%),var(--bg);color:var(--text);font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
.card{width:min(100%,420px);padding:28px;border:1px solid var(--line);border-radius:22px;background:linear-gradient(180deg,rgba(21,28,38,.98),rgba(15,21,29,.98));box-shadow:0 24px 80px rgba(0,0,0,.35)}
.icon{width:52px;height:52px;border-radius:16px;display:grid;place-items:center;margin-bottom:20px;background:linear-gradient(145deg,#20314a,#132032);border:1px solid #304665;font-size:24px}.eyebrow{font-size:11px;text-transform:uppercase;letter-spacing:.13em;color:#8291a6;font-weight:800}.title{font-size:30px;letter-spacing:-.04em;font-weight:850;margin:7px 0 8px}.sub{color:var(--muted);font-size:13px;line-height:1.55;margin-bottom:22px}
label{display:block;font-size:12px;color:#b7c2d0;font-weight:750;margin:13px 0 7px}input{width:100%;min-height:46px;border-radius:12px;background:#0d141c;color:var(--text);border:1px solid #2d3948;padding:10px 12px;font:inherit}input:focus{border-color:#567cae;outline:2px solid rgba(114,167,255,.15)}button{width:100%;margin-top:18px;min-height:46px;border:0;border-radius:12px;background:#f5f7fb;color:#10141a;font:inherit;font-weight:820;cursor:pointer}.message{margin:0 0 14px;padding:11px 12px;border-radius:11px;background:#341a20;border:1px solid #64313a;color:#ffd0d6;font-size:12px}.foot{margin-top:17px;color:#667487;font-size:11px;text-align:center}
</style>
</head>
<body>
<main class="card">
<div class="icon">🔐</div>
<div class="eyebrow">Pascal Security Center</div>
<div class="title">Welkom terug</div>
<div class="sub">Log in om je camera's, AI-meldingen en opnames te bekijken.</div>
${messageHtml}
<form method="post" action="/login" autocomplete="on">
<label for="username">Gebruikersnaam</label>
<input id="username" name="username" type="text" autocomplete="username" required autofocus>
<label for="password">Wachtwoord</label>
<input id="password" name="password" type="password" autocomplete="current-password" required>
<button type="submit">Inloggen</button>
</form>
<div class="foot">Beveiligde toegang tot je lokale camerasysteem</div>
</main>
</body>
</html>`;
}

function setupPage() {
  return `<!doctype html><html lang="nl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Security Center configureren</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#090d12;color:#f5f7fb;font-family:system-ui;padding:24px}.box{max-width:640px;border:1px solid #26303d;background:#111720;padding:28px;border-radius:20px}code{background:#0b1016;padding:2px 6px;border-radius:6px;color:#cfe2ff}p{line-height:1.6;color:#aeb9c8}</style></head><body><div class="box"><h1>Login nog niet geconfigureerd</h1><p>Vul <code>DASHBOARD_USERNAME</code>, <code>DASHBOARD_PASSWORD</code> en een willekeurige <code>DASHBOARD_SESSION_SECRET</code> van minimaal 32 tekens in je <code>.env</code> in en herstart daarna de container.</p></div></body></html>`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
}

async function readForm(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 16 * 1024) throw new Error('Formulier te groot');
    chunks.push(chunk);
  }
  return new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
}

function redirect(res, location, headers = {}) {
  setSecurityHeaders(res);
  res.writeHead(303, { Location: location, 'Cache-Control':'no-store', ...headers });
  res.end();
}

function proxy(req, res) {
  const headers = { ...req.headers, host: `127.0.0.1:${config.upstreamPort}` };
  delete headers['content-length'];

  const upstream = http.request({
    hostname: '127.0.0.1',
    port: config.upstreamPort,
    method: req.method,
    path: req.url,
    headers,
  }, upstreamRes => {
    const responseHeaders = { ...upstreamRes.headers };
    responseHeaders['cache-control'] ||= 'no-store';
    responseHeaders['x-content-type-options'] = 'nosniff';
    responseHeaders['x-frame-options'] = 'DENY';
    responseHeaders['referrer-policy'] = 'no-referrer';
    res.writeHead(upstreamRes.statusCode || 502, responseHeaders);
    upstreamRes.pipe(res);
  });

  upstream.on('error', error => {
    if (!res.headersSent) {
      sendHtml(res, 502, loginPage(`Dashboard intern niet bereikbaar: ${error.message}`));
    } else {
      try { res.end(); } catch {}
    }
  });

  req.pipe(upstream);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (!authConfigured()) {
    sendHtml(res, 503, setupPage());
    return;
  }

  if (req.method === 'GET' && url.pathname === '/login') {
    if (validSession(req)) redirect(res, '/');
    else sendHtml(res, 200, loginPage());
    return;
  }

  if (req.method === 'POST' && url.pathname === '/login') {
    if (!loginAllowed(req)) {
      sendHtml(res, 429, loginPage('Te veel mislukte pogingen. Probeer het over ongeveer 15 minuten opnieuw.'));
      return;
    }

    try {
      const form = await readForm(req);
      const usernameOk = timingSafeEqualText(form.get('username') || '', config.username);
      const passwordOk = timingSafeEqualText(form.get('password') || '', config.password);

      if (!usernameOk || !passwordOk) {
        registerFailedLogin(req);
        sendHtml(res, 401, loginPage('Gebruikersnaam of wachtwoord is niet juist.'));
        return;
      }

      clearLoginFailures(req);
      const secure = cookieSecure(req) ? '; Secure' : '';
      redirect(res, '/', {
        'Set-Cookie': `${SESSION_COOKIE}=${createSession()}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.round(config.sessionHours * 3600)}${secure}`,
      });
    } catch (error) {
      sendHtml(res, 400, loginPage(error.message));
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/logout') {
    const secure = cookieSecure(req) ? '; Secure' : '';
    redirect(res, '/login', {
      'Set-Cookie': `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`,
    });
    return;
  }

  if (!validSession(req)) {
    if (url.pathname.startsWith('/api/') || url.pathname.endsWith('.mjpg') || url.pathname.startsWith('/recordings/')) {
      setSecurityHeaders(res);
      res.writeHead(401, { 'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store' });
      res.end(JSON.stringify({ ok:false, error:'Niet ingelogd' }));
    } else {
      redirect(res, '/login');
    }
    return;
  }

  proxy(req, res);
});

server.listen(config.port, '0.0.0.0', () => {
  console.log(`[auth] Security Center login actief op 0.0.0.0:${config.port}`);
  console.log(`[auth] Intern dashboard: http://127.0.0.1:${config.upstreamPort}`);
  if (!authConfigured()) console.warn('[auth] Loginconfiguratie ontbreekt; dashboard blijft geblokkeerd.');
});
