// Security regression tests for "step 2":
//   item 1  — web sessions in HttpOnly cookies (+ CSRF), native stays on bearer tokens
//   item 2  — short access tokens, rotating refresh tokens, real revocation
//   item 3  — CORS allowlist with credentials
//   item 11 — WebSocket: ticket instead of token in URL, Origin check, per-IP cap,
//             payload cap, one shared feed, sockets dropped when the session ends
//
// No Postgres/Redis needed: sessions use an in-memory store, Redis is a fake.

process.env.JWT_SECRET = 'test-jwt-secret-for-session-tests';
process.env.WS_MAX_CONNECTIONS_PER_IP = '3';
process.env.WS_MAX_PAYLOAD_BYTES = '64';
process.env.CORS_ORIGINS = 'https://app.stocksy.online';
process.env.NODE_ENV = 'production';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const WebSocket = require('ws');

const root = path.join(__dirname, '..');
const resolve = (rel) => require.resolve(path.join(root, rel));
const stubModule = (rel, exportsObj) => {
  const id = resolve(rel);
  require.cache[id] = { id, filename: id, loaded: true, exports: exportsObj, children: [], paths: [] };
};

// ── fakes ────────────────────────────────────────────────────────────────────
const kv = new Map();
const redisCalls = { mGet: 0 };
const fakeRedis = {
  set: async (k, v) => { kv.set(k, v); return 'OK'; },
  getDel: async (k) => { const v = kv.get(k) ?? null; kv.delete(k); return v; },
  get: async (k) => kv.get(k) ?? null,
  mGet: async (keys) => { redisCalls.mGet++; return keys.map(() => null); },
};
stubModule('config/redis.js', { client: fakeRedis, connectRedis() {} });
stubModule('services/redisService.js', fakeRedis);

const USERS = new Map();
const addUser = (name) => {
  const id = crypto.randomUUID();
  const u = { id, full_name: name, username: name, email: `${name}@x.com`, provider: 'local',
              google_id: null, avatar: '', demo_balance: 1000, password: 'x' };
  USERS.set(id, u);
  return u;
};
stubModule('config/postgres.js', { pool: { query: async () => ({ rows: [], rowCount: 0 }) } });
for (const lim of ['authLimiter', 'sessionLimiter', 'generalLimiter', 'otpLimiter', 'orderLimiter']) void lim;
const passthrough = (req, res, next) => next();
stubModule('middleware/rateLimiter.js', {
  authLimiter: passthrough, sessionLimiter: passthrough, generalLimiter: passthrough,
  otpLimiter: passthrough, orderLimiter: passthrough,
});

// in-memory sessionStore with the same contract as services/sessionStore.js
const ROWS = new Map();
const memStore = {
  async insert(r) {
    const row = { id: crypto.randomUUID(), user_id: r.userId, refresh_hash: r.refreshHash, prev_refresh_hash: null,
      rotated_at: null, client_type: r.clientType, expires_at: r.expiresAt, absolute_expires_at: r.absoluteExpiresAt,
      revoked_at: null };
    ROWS.set(row.id, row);
    return { ...row };
  },
  async findByRefreshHash(h) {
    for (const r of ROWS.values()) if (r.refresh_hash === h || r.prev_refresh_hash === h) return { ...r };
    return null;
  },
  async rotate({ id, oldHash, newHash, expiresAt }) {
    const r = ROWS.get(id);
    if (!r || r.refresh_hash !== oldHash || r.revoked_at) return false;
    r.prev_refresh_hash = r.refresh_hash; r.refresh_hash = newHash; r.rotated_at = new Date(); r.expires_at = expiresAt;
    return true;
  },
  async revoke(id) { const r = ROWS.get(id); if (r && !r.revoked_at) r.revoked_at = new Date(); },
  async revokeAllForUser(userId) {
    const ids = [];
    for (const r of ROWS.values()) if (r.user_id === userId && !r.revoked_at) { r.revoked_at = new Date(); ids.push(r.id); }
    return ids;
  },
  async findActiveSessionUser(sid, userId) {
    const r = ROWS.get(sid);
    const now = Date.now();
    if (!r || r.user_id !== userId || r.revoked_at || now > +r.expires_at || now > +r.absolute_expires_at) return null;
    return USERS.get(userId) || null;
  },
  async findUser(id) { return USERS.get(id) || null; },
  async activeIds(ids) { return ids.filter((id) => ROWS.get(id) && !ROWS.get(id).revoked_at); },
  async deleteOld() { return 0; },
};
const sessions = require('../services/sessionService');
sessions.setStore(memStore);

// the real login controller reads users from pg; for tests log in through startSession directly
const { startSession, refresh, getSession, logout, logoutAll, wsTicket } = require('../controllers/session');
const { protect } = require('../middleware/auth');

function buildApp() {
  const app = express();
  app.use(cors(require('../config/cors')));
  app.use(cookieParser());
  app.use(express.json());
  // stand-in for /login: skips password checking, uses the real session issuing code
  app.post('/api/auth/test-login/:name', async (req, res) => {
    const u = [...USERS.values()].find((x) => x.username === req.params.name);
    res.json(await startSession(req, res, u));
  });
  app.post('/api/auth/refresh', refresh);
  app.get('/api/auth/session', protect, getSession);
  app.post('/api/auth/logout', logout);
  app.post('/api/auth/logout-all', protect, logoutAll);
  app.post('/api/auth/ws-ticket', protect, wsTicket);
  app.post('/api/thing', protect, (req, res) => res.json({ ok: true, user: req.user.id }));
  app.get('/api/thing', protect, (req, res) => res.json({ ok: true, user: req.user.id }));
  return app;
}

async function withApp(fn) {
  const app = buildApp();
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try { return await fn(base, server); } finally { server.closeAllConnections?.(); await new Promise((r) => server.close(r)); }
}

// tiny cookie jar
const jarOf = (res, jar = {}) => {
  for (const line of res.headers.getSetCookie()) {
    const [pair, ...attrs] = line.split(';').map((s) => s.trim());
    const [k, ...v] = pair.split('=');
    const value = v.join('=');
    const expired = attrs.some((a) => /^expires=/i.test(a) && new Date(a.slice(8)) < new Date()) || attrs.some((a) => /^max-age=0$/i.test(a));
    if (expired || !value) delete jar[k]; else jar[k] = value;
  }
  return jar;
};
const cookieHeader = (jar) => Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
const WEB = { 'X-Client-Type': 'web', Origin: 'https://app.stocksy.online' };

async function webLogin(base, name) {
  const res = await fetch(`${base}/api/auth/test-login/${name}`, { method: 'POST', headers: WEB });
  const body = await res.json();
  return { res, body, jar: jarOf(res) };
}
const nativeLogin = async (base, name) => (await fetch(`${base}/api/auth/test-login/${name}`, { method: 'POST' })).json();

// ═════════════════════════ item 1: web = cookies, native = bearer ═══════════
test('item 1: web login puts tokens ONLY in HttpOnly cookies, never in the JSON body', async () => {
  const alice = addUser('alice');
  await withApp(async (base) => {
    const { res, body } = await webLogin(base, 'alice');
    assert.equal(body.token, undefined);
    assert.equal(body.refreshToken, undefined);
    assert.ok(body.csrfToken, 'page gets a CSRF token');
    assert.equal(body.id, alice.id);

    const raw = res.headers.getSetCookie();
    const at = raw.find((c) => c.startsWith('stocksy_at='));
    const rt = raw.find((c) => c.startsWith('stocksy_rt='));
    assert.ok(at && rt, 'both cookies set');
    for (const c of [at, rt]) {
      assert.match(c, /HttpOnly/i);
      assert.match(c, /Secure/i);          // NODE_ENV=production
      assert.match(c, /SameSite=Lax/i);
    }
    assert.match(rt, /Path=\/api\/auth/i);   // refresh cookie only travels to auth routes
    assert.doesNotMatch(rt, /Path=\/;/i);
  });
});

test('item 1: native login still returns bearer token + refresh token and sets no cookies', async () => {
  addUser('bob');
  await withApp(async (base) => {
    const res = await fetch(`${base}/api/auth/test-login/bob`, { method: 'POST' });
    const body = await res.json();
    assert.ok(body.token && body.refreshToken);
    assert.equal(body.csrfToken, undefined);
    assert.equal(res.headers.getSetCookie().length, 0);

    const ok = await fetch(`${base}/api/thing`, { method: 'POST', headers: { Authorization: `Bearer ${body.token}` } });
    assert.equal(ok.status, 200, 'bearer POST needs no CSRF token');
  });
});

test('item 1: cookie-authenticated GET works; writes need the CSRF token AND a trusted Origin', async () => {
  addUser('carol');
  await withApp(async (base) => {
    const { body, jar } = await webLogin(base, 'carol');
    const ck = { Cookie: cookieHeader(jar) };

    assert.equal((await fetch(`${base}/api/thing`, { headers: ck })).status, 200);

    const noCsrf = await fetch(`${base}/api/thing`, { method: 'POST', headers: { ...ck, ...WEB } });
    assert.equal(noCsrf.status, 403);
    assert.equal((await noCsrf.json()).code, 'CSRF_FAILED');

    const wrong = await fetch(`${base}/api/thing`, { method: 'POST', headers: { ...ck, ...WEB, 'X-CSRF-Token': 'a'.repeat(64) } });
    assert.equal(wrong.status, 403);

    const evil = await fetch(`${base}/api/thing`, { method: 'POST',
      headers: { ...ck, 'X-CSRF-Token': body.csrfToken, Origin: 'https://evil.example' } });
    assert.equal(evil.status, 403, 'right token from the wrong site is still refused');

    const good = await fetch(`${base}/api/thing`, { method: 'POST', headers: { ...ck, ...WEB, 'X-CSRF-Token': body.csrfToken } });
    assert.equal(good.status, 200);
  });
});

test('item 1: a CSRF token from one session does not work for another', async () => {
  addUser('dave'); addUser('erin');
  await withApp(async (base) => {
    const d = await webLogin(base, 'dave');
    const e = await webLogin(base, 'erin');
    const res = await fetch(`${base}/api/thing`, { method: 'POST',
      headers: { Cookie: cookieHeader(d.jar), ...WEB, 'X-CSRF-Token': e.body.csrfToken } });
    assert.equal(res.status, 403);
  });
});

test('item 1: GET /session returns the user and a fresh CSRF token for a cookie session', async () => {
  const u = addUser('frank');
  await withApp(async (base) => {
    const { body, jar } = await webLogin(base, 'frank');
    const res = await fetch(`${base}/api/auth/session`, { headers: { Cookie: cookieHeader(jar) } });
    const s = await res.json();
    assert.equal(s.user.id, u.id);
    assert.equal(s.csrfToken, body.csrfToken);
    assert.equal(s.user.password, undefined);
  });
});

// ═════════════════════ item 2: short tokens, rotation, revocation ═══════════
test('item 2: access tokens are short-lived and tied to a session id', async () => {
  addUser('gina');
  await withApp(async (base) => {
    const { token } = await nativeLogin(base, 'gina');
    const d = jwt.decode(token);
    assert.ok(d.sid, 'carries a session id');
    assert.ok(d.exp - d.iat <= 15 * 60, `access token lives ${d.exp - d.iat}s`);
  });
});

test('item 2: an old 30-day token without a session id is no longer accepted', async () => {
  const u = addUser('hank');
  await withApp(async (base) => {
    const legacy = jwt.sign({ id: u.id }, process.env.JWT_SECRET, { expiresIn: '30d' });
    const res = await fetch(`${base}/api/thing`, { headers: { Authorization: `Bearer ${legacy}` } });
    assert.equal(res.status, 401);
    assert.equal((await res.json()).code, 'SESSION_EXPIRED');
  });
});

test('item 2: expired access token → 401 SESSION_EXPIRED with reason access_expired', async () => {
  const u = addUser('ivy');
  await withApp(async (base) => {
    const { token } = await nativeLogin(base, 'ivy');
    const sid = jwt.decode(token).sid;
    const expired = jwt.sign({ id: u.id, sid }, process.env.JWT_SECRET, { expiresIn: -10 });
    const res = await fetch(`${base}/api/thing`, { headers: { Authorization: `Bearer ${expired}` } });
    const b = await res.json();
    assert.equal(res.status, 401);
    assert.equal(b.code, 'SESSION_EXPIRED');
    assert.equal(b.reason, 'access_expired');
  });
});

test('item 2: native refresh rotates the refresh token and the old one is dead', async () => {
  addUser('jack');
  await withApp(async (base) => {
    const first = await nativeLogin(base, 'jack');
    const r1 = await (await fetch(`${base}/api/auth/refresh`, { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refreshToken: first.refreshToken }) })).json();
    assert.ok(r1.token && r1.refreshToken && r1.refreshToken !== first.refreshToken);

    const ok = await fetch(`${base}/api/thing`, { headers: { Authorization: `Bearer ${r1.token}` } });
    assert.equal(ok.status, 200);

    // the new one keeps working
    const r2 = await fetch(`${base}/api/auth/refresh`, { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refreshToken: r1.refreshToken }) });
    assert.equal(r2.status, 200);
  });
});

test('item 2: a refresh token shown twice AFTER the grace window revokes the whole session', async () => {
  addUser('kate');
  await withApp(async (base) => {
    const first = await nativeLogin(base, 'kate');
    const post = (rt) => fetch(`${base}/api/auth/refresh`, { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refreshToken: rt }) });

    const r1 = await (await post(first.refreshToken)).json();

    // right away = two tabs racing: told to retry, session NOT revoked
    const race = await post(first.refreshToken);
    assert.equal(race.status, 401);
    assert.equal((await race.json()).code, 'REFRESH_RETRY');
    assert.equal((await fetch(`${base}/api/thing`, { headers: { Authorization: `Bearer ${r1.token}` } })).status, 200);

    // age the rotation past the grace window → looks like a stolen copy
    for (const row of ROWS.values()) if (row.rotated_at) row.rotated_at = new Date(Date.now() - 60_000);
    const reuse = await post(first.refreshToken);
    assert.equal(reuse.status, 401);
    assert.equal((await reuse.json()).reason, 'refresh_reused');

    // attacker AND the real user lose the session: access token and newest refresh token both dead
    assert.equal((await fetch(`${base}/api/thing`, { headers: { Authorization: `Bearer ${r1.token}` } })).status, 401);
    assert.equal((await post(r1.refreshToken)).status, 401);
  });
});

test('item 2: refresh with garbage / missing token is a clean 401', async () => {
  await withApp(async (base) => {
    for (const body of [{}, { refreshToken: 'nope' }, { refreshToken: 123 }]) {
      const res = await fetch(`${base}/api/auth/refresh`, { method: 'POST',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      assert.equal(res.status, 401);
    }
  });
});

test('item 2: expired refresh token (sliding or absolute) is refused', async () => {
  addUser('liam');
  await withApp(async (base) => {
    for (const col of ['expires_at', 'absolute_expires_at']) {
      const t = await nativeLogin(base, 'liam');
      for (const row of ROWS.values()) if (!row.revoked_at && row.user_id === t.id) row[col] = new Date(Date.now() - 1000);
      const res = await fetch(`${base}/api/auth/refresh`, { method: 'POST',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refreshToken: t.refreshToken }) });
      assert.equal(res.status, 401, col);
    }
  });
});

test('item 2: logout kills the access token IMMEDIATELY and the refresh token (native)', async () => {
  addUser('mona');
  await withApp(async (base) => {
    const t = await nativeLogin(base, 'mona');
    const auth = { Authorization: `Bearer ${t.token}` };
    assert.equal((await fetch(`${base}/api/thing`, { headers: auth })).status, 200);

    const out = await fetch(`${base}/api/auth/logout`, { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refreshToken: t.refreshToken }) });
    assert.equal(out.status, 200);

    assert.equal((await fetch(`${base}/api/thing`, { headers: auth })).status, 401, 'stolen access token is dead at once');
    const again = await fetch(`${base}/api/auth/refresh`, { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refreshToken: t.refreshToken }) });
    assert.equal(again.status, 401);
  });
});

test('item 2: web logout revokes the session and clears both cookies', async () => {
  addUser('nina');
  await withApp(async (base) => {
    const { jar } = await webLogin(base, 'nina');
    const ck = { Cookie: cookieHeader(jar) };
    const out = await fetch(`${base}/api/auth/logout`, { method: 'POST', headers: { ...ck, ...WEB } });
    assert.equal(out.status, 200);
    const after = jarOf(out, { ...jar });
    assert.equal(after.stocksy_at, undefined);
    assert.equal(after.stocksy_rt, undefined);
    // a copy of the old cookies (e.g. stolen) no longer works
    assert.equal((await fetch(`${base}/api/thing`, { headers: ck })).status, 401);
    const rf = await fetch(`${base}/api/auth/refresh`, { method: 'POST', headers: { ...ck, ...WEB } });
    assert.equal(rf.status, 401);
  });
});

test('item 2: web refresh needs the web header and a trusted Origin, and sets fresh cookies', async () => {
  addUser('omar');
  await withApp(async (base) => {
    const { jar } = await webLogin(base, 'omar');
    const ck = { Cookie: cookieHeader(jar) };

    const evil = await fetch(`${base}/api/auth/refresh`, { method: 'POST',
      headers: { ...ck, 'X-Client-Type': 'web', Origin: 'https://evil.example' } });
    assert.equal(evil.status, 403);

    // without the web header the cookie is simply not used (native path wants a body token)
    const noHeader = await fetch(`${base}/api/auth/refresh`, { method: 'POST', headers: ck });
    assert.equal(noHeader.status, 401);

    const good = await fetch(`${base}/api/auth/refresh`, { method: 'POST', headers: { ...ck, ...WEB } });
    assert.equal(good.status, 200);
    const b = await good.json();
    assert.equal(b.token, undefined);
    assert.ok(b.csrfToken && b.user);
    const fresh = jarOf(good, { ...jar });
    assert.notEqual(fresh.stocksy_rt, jar.stocksy_rt, 'refresh cookie rotated');
  });
});

test('item 2: logout-all signs out every device; password reset / account deletion call it', async () => {
  const u = addUser('pete');
  await withApp(async (base) => {
    const a = await nativeLogin(base, 'pete');
    const b = await nativeLogin(base, 'pete');
    const out = await fetch(`${base}/api/auth/logout-all`, { method: 'POST', headers: { Authorization: `Bearer ${a.token}` } });
    assert.equal(out.status, 200);
    for (const t of [a, b]) {
      assert.equal((await fetch(`${base}/api/thing`, { headers: { Authorization: `Bearer ${t.token}` } })).status, 401);
    }
  });
  // reset + delete must revoke (checked at source level: they hit a real DB in production)
  for (const f of ['controllers/forgotPasswordController.js', 'controllers/accountController.js']) {
    assert.match(fs.readFileSync(path.join(root, f), 'utf8'), /sessions\.revokeAllForUser\(/, f);
  }
  void u;
});

test('item 2: revoking all sessions of a user leaves other users alone', async () => {
  const a = addUser('quinn'); const b = addUser('rosa');
  await withApp(async (base) => {
    const ta = await nativeLogin(base, 'quinn');
    const tb = await nativeLogin(base, 'rosa');
    await sessions.revokeAllForUser(a.id, 'password_reset');
    assert.equal((await fetch(`${base}/api/thing`, { headers: { Authorization: `Bearer ${ta.token}` } })).status, 401);
    assert.equal((await fetch(`${base}/api/thing`, { headers: { Authorization: `Bearer ${tb.token}` } })).status, 200);
  });
  void b;
});

test('item 2: tokens are stored hashed — the refresh secret is not in the table', async () => {
  addUser('sam');
  await withApp(async (base) => {
    const t = await nativeLogin(base, 'sam');
    for (const row of ROWS.values()) assert.notEqual(row.refresh_hash, t.refreshToken);
    assert.ok([...ROWS.values()].some((r) => r.refresh_hash === sessions.sha256(t.refreshToken)));
  });
});

// ═════════════════════════════ item 3: CORS ═════════════════════════════════
test('item 3: the web app origin is allowed WITH credentials; others get no CORS headers', async () => {
  await withApp(async (base) => {
    const ok = await fetch(`${base}/api/thing`, { headers: { Origin: 'https://app.stocksy.online' } });
    assert.equal(ok.headers.get('access-control-allow-origin'), 'https://app.stocksy.online');
    assert.equal(ok.headers.get('access-control-allow-credentials'), 'true');

    for (const evil of ['https://evil.example', 'https://app.stocksy.online.evil.example', 'http://app.stocksy.online',
                        'https://api.stocksy.online', 'null']) {
      const r = await fetch(`${base}/api/thing`, { headers: { Origin: evil } });
      assert.equal(r.headers.get('access-control-allow-origin'), null, evil);
    }
  });
});

test('item 3: preflight from another site is not approved (it cannot send the CSRF/web headers)', async () => {
  await withApp(async (base) => {
    const pre = (origin) => fetch(`${base}/api/thing`, { method: 'OPTIONS', headers: {
      Origin: origin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'x-csrf-token,x-client-type' } });
    const good = await pre('https://app.stocksy.online');
    assert.equal(good.headers.get('access-control-allow-origin'), 'https://app.stocksy.online');
    assert.match(good.headers.get('access-control-allow-headers') || '', /x-csrf-token/i);
    const bad = await pre('https://evil.example');
    assert.equal(bad.headers.get('access-control-allow-origin'), null);
  });
});

test('item 3: no Origin (native app, curl, Python workers) is unaffected', async () => {
  addUser('tess');
  await withApp(async (base) => {
    const t = await nativeLogin(base, 'tess');
    assert.equal((await fetch(`${base}/api/thing`, { headers: { Authorization: `Bearer ${t.token}` } })).status, 200);
  });
});

test('item 3: production fails closed (empty list = no browser origin); dev allows localhost only', () => {
  const origins = require('../config/origins');
  const save = { e: process.env.NODE_ENV, c: process.env.CORS_ORIGINS };
  try {
    process.env.NODE_ENV = 'production'; process.env.CORS_ORIGINS = '';
    assert.equal(origins.isAllowedOrigin('http://localhost:8081'), false);
    assert.equal(origins.isAllowedOrigin('https://app.stocksy.online'), false);

    process.env.NODE_ENV = 'development';
    assert.equal(origins.isAllowedOrigin('http://localhost:8081'), true);
    assert.equal(origins.isAllowedOrigin('http://127.0.0.1:19006'), true);
    assert.equal(origins.isAllowedOrigin('http://localhost.evil.com'), false);
    assert.equal(origins.isAllowedOrigin('https://evil.com'), false);

    process.env.CORS_ORIGINS = ' https://A.example/ , https://b.example ';
    assert.equal(origins.isAllowedOrigin('https://a.example'), true);
    assert.equal(origins.isAllowedOrigin('https://b.example'), true);
  } finally { process.env.NODE_ENV = save.e; process.env.CORS_ORIGINS = save.c; }
});

test('item 3: server.js no longer uses cors() with no options', () => {
  const src = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
  assert.ok(!/app\.use\(\s*cors\(\s*\)\s*\)/.test(src));
  assert.match(src, /config\/cors/);
});

// ══════════════════════════ item 11: WebSocket ══════════════════════════════
const { initWebSocket, notifyClient, clientIp } = require('../services/websocketService');

async function withWs(fn, opts = {}) {
  const server = http.createServer(buildApp());
  const wss = initWebSocket(server, { pushIntervalMs: 50, sessionCheckMs: 100000, ...opts });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const url = (q = '') => `ws://127.0.0.1:${port}/${q}`;
  const open = (q = '', headers = {}) => new Promise((resolve, reject) => {
    const ws = new WebSocket(url(q), { headers });
    ws.once('open', () => resolve(ws));
    ws.once('unexpected-response', (_req, res) => reject(Object.assign(new Error(`HTTP ${res.statusCode}`), { status: res.statusCode })));
    ws.once('error', reject);
  });
  try { return await fn({ open, base: `http://127.0.0.1:${port}`, wss }); }
  finally {
    for (const c of wss.clients) c.terminate();
    wss.close(); server.closeAllConnections?.(); await new Promise((r) => server.close(r));
  }
}
const nextMessage = (ws) => new Promise((r) => ws.once('message', (d) => r(JSON.parse(d.toString()))));
const closed = (ws) => new Promise((r) => ws.once('close', (code) => r(code)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('item 11: anonymous visitors still get the public price feed', async () => {
  await withWs(async ({ open }) => {
    const ws = await open();
    const m = await nextMessage(ws);
    assert.ok(m.error || m.type === 'MARKET_DATA');
    ws.close();
  });
});

test('item 11: a ticket (not the JWT) registers the socket for private notifications — and works once', async () => {
  const u = addUser('uma');
  await withWs(async ({ open, base }) => {
    const t = await nativeLogin(base, 'uma');
    const tk = await (await fetch(`${base}/api/auth/ws-ticket`, { method: 'POST', headers: { Authorization: `Bearer ${t.token}` } })).json();
    assert.ok(tk.ticket && tk.expiresIn <= 30);

    const ws = await open(`?ticket=${tk.ticket}`);
    await nextMessage(ws);
    const got = new Promise((r) => { ws.on('message', (d) => { const m = JSON.parse(d.toString()); if (m.type === 'ORDER_FILLED') r(m); }); });
    notifyClient(u.id, { type: 'ORDER_FILLED', id: 1 });
    assert.equal((await got).id, 1);

    // reusing the same ticket gives an anonymous socket (no notifications)
    const ws2 = await open(`?ticket=${tk.ticket}`);
    let leaked = false;
    ws2.on('message', (d) => { if (JSON.parse(d.toString()).type === 'ORDER_FILLED') leaked = true; });
    notifyClient(u.id, { type: 'ORDER_FILLED', id: 2 });
    await sleep(150);
    assert.equal(leaked, false);
    ws.close(); ws2.close();
  });
});

test('item 11: the old ?token=<JWT> in the URL is ignored (no identity from it)', async () => {
  const u = addUser('vera');
  await withWs(async ({ open, base }) => {
    const t = await nativeLogin(base, 'vera');
    const ws = await open(`?token=${t.token}`);
    let got = false;
    ws.on('message', (d) => { if (JSON.parse(d.toString()).type === 'ORDER_FILLED') got = true; });
    notifyClient(u.id, { type: 'ORDER_FILLED' });
    await sleep(150);
    assert.equal(got, false);
    ws.close();
  });
});

test('item 11: ws-ticket requires a logged-in session', async () => {
  await withWs(async ({ base }) => {
    assert.equal((await fetch(`${base}/api/auth/ws-ticket`, { method: 'POST' })).status, 401);
  });
});

test('item 11: a web page on another origin cannot open the socket; ours and native can', async () => {
  await withWs(async ({ open }) => {
    await assert.rejects(open('', { Origin: 'https://evil.example' }), { status: 403 });
    await assert.rejects(open('', { Origin: 'https://app.stocksy.online.evil.example' }), { status: 403 });
    (await open('', { Origin: 'https://app.stocksy.online' })).close();
    (await open('')).close(); // no Origin header = native app
  });
});

test('item 11: at most N connections per IP, and slots are freed when sockets close', async () => {
  await withWs(async ({ open }) => {
    const socks = [await open(), await open(), await open()]; // limit is 3
    await assert.rejects(open(), { status: 429 });
    socks[0].close();
    await closed(socks[0]);
    await sleep(30);
    socks.push(await open()); // slot is free again
    socks.forEach((s) => s.terminate());
  });
});

test('item 11: a burst of simultaneous handshakes cannot slip past the per-IP cap', async () => {
  await withWs(async ({ open }) => {
    const results = await Promise.allSettled(Array.from({ length: 8 }, () => open()));
    const okc = results.filter((r) => r.status === 'fulfilled');
    assert.equal(okc.length, 3);
    okc.forEach((r) => r.value.terminate());
  });
});

test('item 11: X-Forwarded-For can only add to, never replace, the real client address', () => {
  const fake = (xff, remote) => ({ headers: xff ? { 'x-forwarded-for': xff } : {}, socket: { remoteAddress: remote } });
  assert.equal(clientIp(fake('1.2.3.4', '10.0.0.1')), '1.2.3.4');
  assert.equal(clientIp(fake('6.6.6.6, 1.2.3.4', '10.0.0.1')), '1.2.3.4', 'forged first hop ignored');
  assert.equal(clientIp(fake('', '9.9.9.9')), '9.9.9.9');
});

test('item 11: oversize messages close the connection (1009)', async () => {
  await withWs(async ({ open }) => {
    const ws = await open();
    const c = closed(ws);
    ws.send('x'.repeat(5000));
    assert.equal(await c, 1009);
  });
});

test('item 11: message flooding is cut off', async () => {
  await withWs(async ({ open }) => {
    const ws = await open();
    const c = closed(ws);
    for (let i = 0; i < 40; i++) ws.send('hi');
    assert.equal(await c, 1008);
  });
});

test('item 11: ONE shared Redis read per tick no matter how many clients; none when nobody is connected', async () => {
  await withWs(async ({ open }) => {
    await sleep(250);
    redisCalls.mGet = 0;
    await sleep(250);
    assert.equal(redisCalls.mGet, 0, 'idle server does no Redis work');

    const socks = await Promise.all([open(), open(), open()]);
    redisCalls.mGet = 0;
    await sleep(500); // ~10 ticks at 50ms
    const calls = redisCalls.mGet;
    socks.forEach((s) => s.terminate());
    // the old code did 3 reads per connection per tick: 3 clients x 10 ticks x 3 = ~90
    assert.ok(calls <= 14, `expected ~10 shared reads, saw ${calls}`);
    assert.ok(calls >= 3, `feed should be running (${calls})`);
  });
});

test('item 11: logging out ends that user\'s live socket immediately (4401)', async () => {
  addUser('wes');
  await withWs(async ({ open, base }) => {
    const t = await nativeLogin(base, 'wes');
    const tk = await (await fetch(`${base}/api/auth/ws-ticket`, { method: 'POST', headers: { Authorization: `Bearer ${t.token}` } })).json();
    const ws = await open(`?ticket=${tk.ticket}`);
    const c = closed(ws);
    await fetch(`${base}/api/auth/logout`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: t.refreshToken }) });
    assert.equal(await c, 4401);
  });
});

test('item 11: the periodic check closes sockets whose session died elsewhere or expired', async () => {
  addUser('xena');
  await withWs(async ({ open, base }) => {
    const t = await nativeLogin(base, 'xena');
    const tk = await (await fetch(`${base}/api/auth/ws-ticket`, { method: 'POST', headers: { Authorization: `Bearer ${t.token}` } })).json();
    const ws = await open(`?ticket=${tk.ticket}`);
    const c = closed(ws);
    // revoke in the database only (as another server process would): no event fires here
    for (const row of ROWS.values()) if (row.user_id && !row.revoked_at && row.id === jwt.decode(t.token).sid) row.revoked_at = new Date();
    assert.equal(await c, 4401);
  }, { sessionCheckMs: 60 });
});

test('item 11: the WebSocket URL no longer carries the JWT (client builds ?ticket=)', () => {
  const core = fs.readFileSync(path.join(root, '..', 'Stocksy_Mobile', 'services', 'marketSocketCore.js'), 'utf8');
  assert.ok(!/\?token=/.test(core), 'marketSocketCore must not put ?token= in the URL');
  assert.match(core, /\?ticket=/);
});
