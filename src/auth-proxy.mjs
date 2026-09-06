import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const config = {
  port: Number(process.env.WEB_PORT || 8090),
  targetPort: Number(process.env.SECURITY_INTERNAL_PORT || 8095),
  enabled: !/^(0|false|no|off)$/i.test(String(process.env.AUTH_ENABLED || '1')),
  username: String(process.env.AUTH_USERNAME || '').trim(),
  passwordHash: String(process.env.AUTH_PASSWORD_HASH || '').trim(),
  sessionHours: Math.max(1, Math.min(24 * 90, Number(process.env.AUTH_SESSION_HOURS || 168))),
  cookieSecure: /^(1|true|yes|on)$/i.test(String(process.env.AUTH_COOKIE_SECURE || '0')),
  trustProxy: /^(1|true|yes|on)$/i.test(String(process.env.AUTH_TRUST_PROXY || '0')),
};

const loginHtml = fs.readFileSync(path.join(__dirname, '..', 'public', 'login.html'));
const authClientJs = fs.readFileSync(path.join(__dirname, '..', 'public', 'auth-client.js'));
const COOKIE_NAME = 'security_center_session';
const PBKDF2_DIGEST = 'sha256';
const failedLogins = new Map();

function isLoopback(address = '') {
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

function clientIp(req) {
  if (config.trustProxy) {
    const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    if (forwarded) return forwarded;
  }
  return req.socket.remoteAddress || 'unknown';
}

function isConfigured() {
  return Boolean(config.username && config.passwordHash);
}

function parseCookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const index = part.indexOf('=');
    if (index < 1) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    try { out[key] = decodeURIComponent(value); } catch { out[key] = value; }
  }
  return out;
}

function b64url(input) {
  return Buffer.from(input).toString('base64url');
}

function signingKey() {
  return crypto.createHash('sha256').update(`security-center-session:${config.passwordHash}`).digest();
}

function createSession(username) {
  const now = Math.floor(Date.now() / 1000);
  const payload = b64url(JSON.stringify({ u: username, iat: now, exp: now + config.sessionHours * 3600 }));
  const signature = crypto.createHmac('sha256', signingKey()).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

function readSession(req) {
  const token = parseCookies(req)[COOKIE_NAME];
  if (!token || !isConfigured()) return null;
  const [payload, signature, extra] = String(token).split('.');
  if (!payload || !signature || extra) return null;

  const expected = crypto.createHmac('sha256', signingKey()).update(payload).digest();
  let supplied;
  try { supplied = Buffer.from(signature, 'base64url'); } catch { return null; }
  if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) return null;

  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (data.u !== config.username || !Number.isFinite(data.exp) || data.exp <= Math.floor(Date.now() / 1000)) return null;
    return data;
  } catch {
    return null;
  }
}

function verifyPassword(password) {
  const parts = config.passwordHash.split(':');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;
  const iterations = Number(parts[1]);
  if (!Number.isInteger(iterations) || iterations < 100000 || iterations > 2000000) return false;

  let salt;
  let expected;
  try {
    salt = Buffer.from(parts[2], 'base64url');
    expected = Buffer.from(parts[3], 'base64url');
  } catch {
    return false;
  }
  if (salt.length < 16 || expected.length < 32) return false;

  const actual = crypto.pbkdf2Sync(String(password), salt, iterations, expected.length, PBKDF2_DIGEST);
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function securityHeaders(extra = {}) {
  const headers = {
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    ...extra,
  };
  if (config.cookieSecure) headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains';
  return headers;
}

function sendJson(res, status, body, extra = {}) {
  const payload = Buffer.from(JSON.stringify(body));
  res.writeHead(status, securityHeaders({
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': payload.length,
    ...extra,
  }));
  res.end(payload);
}

function sendHtml(res, status, body, extra = {}) {
  const payload = Buffer.isBuffer(body) ? body : Buffer.from(String(body));
  res.writeHead(status, securityHeaders({
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': payload.length,
    ...extra,
  }));
  res.end(payload);
}

function cookieHeader(value, maxAgeSeconds) {
  const attrs = [
    `${COOKIE_NAME}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.max(0, Math.trunc(maxAgeSeconds))}`,
  ];
  if (config.cookieSecure) attrs.push('Secure');
  return attrs.join('; ');
}

async function readBody(req, maxBytes = 32 * 1024) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > maxBytes) throw new Error('Request te groot');
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function loginState(ip) {
  const now = Date.now();
  const current = failedLogins.get(ip);
  if (!current || now - current.windowStartedAt > 15 * 60 * 1000) {
    const fresh = { failures: 0, windowStartedAt: now, blockedUntil: 0 };
    failedLogins.set(ip, fresh);
    return fresh;
  }
  return current;
}

function registerFailure(ip) {
  const state = loginState(ip);
  state.failures += 1;
  if (state.failures >= 5) {
    const step = Math.min(6, state.failures - 5);
    state.blockedUntil = Date.now() + (30 * (2 ** step)) * 1000;
  }
  failedLogins.set(ip, state);
}

function clearFailures(ip) {
  failedLogins.delete(ip);
}

function safeNext(value) {
  const next = String(value || '/');
  if (!next.startsWith('/') || next.startsWith('//')) return '/';
  if (next.startsWith('/login') || next.startsWith('/api/auth/')) return '/';
  return next;
}

function proxyRequest(req, res) {
  const headers = { ...req.headers, host: `127.0.0.1:${config.targetPort}` };
  delete headers['proxy-connection'];

  const options = {
    hostname: '127.0.0.1',
    port: config.targetPort,
    method: req.method,
    path: req.url,
    headers,
  };

  const upstream = http.request(options, upstreamRes => {
    const responseHeaders = { ...upstreamRes.headers };
    responseHeaders['x-content-type-options'] = 'nosniff';
    responseHeaders['x-frame-options'] = 'DENY';
    responseHeaders['referrer-policy'] = 'no-referrer';
    responseHeaders['permissions-policy'] = 'camera=(), microphone=(), geolocation=()';
    if (config.cookieSecure) responseHeaders['strict-transport-security'] = 'max-age=31536000; includeSubDomains';

    const requestPath = new URL(req.url, 'http://localhost').pathname;
    const contentType = String(upstreamRes.headers['content-type'] || '');
    if (req.method === 'GET' && requestPath === '/' && contentType.includes('text/html')) {
      const chunks = [];
      let size = 0;
      upstreamRes.on('data', chunk => {
        size += chunk.length;
        if (size <= 2 * 1024 * 1024) chunks.push(Buffer.from(chunk));
      });
      upstreamRes.on('end', () => {
        if (size > 2 * 1024 * 1024) {
          if (!res.headersSent) sendJson(res, 502, { ok: false, error: 'Dashboardpagina is onverwacht groot.' });
          return;
        }
        let html = Buffer.concat(chunks).toString('utf8');
        const injection = '<script src="/auth-client.js"></script>';
        html = html.includes('</body>') ? html.replace('</body>', `${injection}</body>`) : html + injection;
        const body = Buffer.from(html);
        delete responseHeaders['content-length'];
        delete responseHeaders['content-encoding'];
        responseHeaders['content-length'] = body.length;
        res.writeHead(upstreamRes.statusCode || 200, responseHeaders);
        res.end(body);
      });
      return;
    }

    res.writeHead(upstreamRes.statusCode || 502, responseHeaders);
    upstreamRes.pipe(res);
  });

  upstream.on('error', error => {
    if (!res.headersSent) {
      sendJson(res, 502, { ok: false, error: `Interne Security Center niet bereikbaar: ${error.message}` });
    } else {
      try { res.destroy(error); } catch {}
    }
  });

  req.on('aborted', () => upstream.destroy());
  req.pipe(upstream);
}

function wantsHtml(req, url) {
  if (url.pathname === '/' || url.pathname.endsWith('.html')) return true;
  return String(req.headers.accept || '').includes('text/html');
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const loopback = isLoopback(req.socket.remoteAddress);
  const session = readSession(req);

  if (req.method === 'GET' && url.pathname === '/login') {
    if (session) {
      res.writeHead(302, securityHeaders({ Location: safeNext(url.searchParams.get('next')) }));
      res.end();
      return;
    }
    sendHtml(res, 200, loginHtml);
    return;
  }

  if (req.method === 'GET' && url.pathname === '/auth-client.js') {
    res.writeHead(200, securityHeaders({
      'Content-Type': 'text/javascript; charset=utf-8',
      'Content-Length': authClientJs.length,
    }));
    res.end(authClientJs);
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/auth/session') {
    sendJson(res, session ? 200 : 401, {
      authenticated: Boolean(session),
      username: session?.u || null,
      configured: isConfigured(),
    });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/auth/login') {
    if (!config.enabled) {
      sendJson(res, 503, { ok: false, error: 'Inloggen is uitgeschakeld.' });
      return;
    }
    if (!isConfigured()) {
      sendJson(res, 503, { ok: false, error: 'Login is nog niet ingesteld op de server.' });
      return;
    }

    const ip = clientIp(req);
    const rate = loginState(ip);
    if (rate.blockedUntil > Date.now()) {
      const retryAfter = Math.max(1, Math.ceil((rate.blockedUntil - Date.now()) / 1000));
      sendJson(res, 429, { ok: false, error: `Te veel mislukte pogingen. Probeer over ${retryAfter} seconden opnieuw.` }, { 'Retry-After': retryAfter });
      return;
    }

    try {
      const raw = await readBody(req);
      const type = String(req.headers['content-type'] || '');
      let username = '';
      let password = '';
      let next = '/';

      if (type.includes('application/json')) {
        const data = JSON.parse(raw.toString('utf8') || '{}');
        username = String(data.username || '');
        password = String(data.password || '');
        next = safeNext(data.next);
      } else {
        const form = new URLSearchParams(raw.toString('utf8'));
        username = String(form.get('username') || '');
        password = String(form.get('password') || '');
        next = safeNext(form.get('next'));
      }

      const usernameBuffer = Buffer.from(username);
      const expectedUsernameBuffer = Buffer.from(config.username);
      const usernameOk = usernameBuffer.length === expectedUsernameBuffer.length && crypto.timingSafeEqual(usernameBuffer, expectedUsernameBuffer);
      const passwordOk = verifyPassword(password);
      if (!usernameOk || !passwordOk) {
        registerFailure(ip);
        sendJson(res, 401, { ok: false, error: 'Gebruikersnaam of wachtwoord is onjuist.' });
        return;
      }

      clearFailures(ip);
      const token = createSession(config.username);
      sendJson(res, 200, { ok: true, next }, {
        'Set-Cookie': cookieHeader(token, config.sessionHours * 3600),
      });
    } catch (error) {
      sendJson(res, 400, { ok: false, error: error.message || 'Ongeldige loginrequest.' });
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/auth/logout') {
    sendJson(res, 200, { ok: true }, {
      'Set-Cookie': cookieHeader('', 0),
    });
    return;
  }

  // Alleen processen die echt via localhost verbinden mogen zonder browserlogin
  // naar de interne API. X-Forwarded-For speelt hierbij bewust geen rol.
  if (loopback) {
    proxyRequest(req, res);
    return;
  }

  if (!config.enabled) {
    proxyRequest(req, res);
    return;
  }

  if (!isConfigured()) {
    if (wantsHtml(req, url)) {
      sendHtml(res, 503, `<!doctype html><html lang="nl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Login instellen</title><body style="font-family:system-ui;background:#090d12;color:#f5f7fb;padding:40px"><h1>Login nog niet ingesteld</h1><p>Voer op de Ubuntu-server <code>bash scripts/set-auth.sh</code> uit en herstart daarna de container.</p></body></html>`);
    } else {
      sendJson(res, 503, { ok: false, error: 'Login nog niet ingesteld.' });
    }
    return;
  }

  if (!session) {
    if (wantsHtml(req, url) && req.method === 'GET') {
      const next = safeNext(url.pathname + url.search + url.hash);
      res.writeHead(302, securityHeaders({ Location: `/login?next=${encodeURIComponent(next)}` }));
      res.end();
    } else {
      sendJson(res, 401, { ok: false, error: 'Niet ingelogd.' });
    }
    return;
  }

  proxyRequest(req, res);
});

server.listen(config.port, '0.0.0.0', () => {
  console.log(`[auth] Security Center login-proxy: http://0.0.0.0:${config.port}`);
  console.log(`[auth] Interne Security Center: http://127.0.0.1:${config.targetPort}`);
  console.log(`[auth] Login: ${config.enabled ? (isConfigured() ? `actief voor ${config.username}` : 'ACTIEF MAAR NOG NIET INGESTELD') : 'uitgeschakeld'}`);
  if (config.cookieSecure) console.log('[auth] Secure-cookie en HSTS actief; gebruik uitsluitend HTTPS.');
});

setInterval(() => {
  const cutoff = Date.now() - 30 * 60 * 1000;
  for (const [ip, state] of failedLogins) {
    if (state.windowStartedAt < cutoff && state.blockedUntil < Date.now()) failedLogins.delete(ip);
  }
}, 10 * 60 * 1000).unref();