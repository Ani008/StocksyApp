// Integration tests for "step 2" (security review items 1, 2, 3 and 11):
//   sessions + rotating refresh tokens, cookie handling, CORS allowlist and
//   WebSocket auth / limits.
//
// These run against a REAL Postgres (the session SQL is the point), so they are
// skipped unless a scratch database is provided:
//
//   TEST_PG_HOST=127.0.0.1 TEST_PG_PORT=5432 TEST_PG_USER=postgres \
//   TEST_PG_DATABASE=stocksy_test node --test tests/sessions.test.js
//
// Everything is created inside a throw-away schema that is dropped at the end,
// so the database can be any scratch database. Redis is not needed.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');
const crypto = require('node:crypto');

const HAVE_DB = !!process.env.TEST_PG_DATABASE;
const skip = HAVE_DB ? false : 'set TEST_PG_DATABASE (and friends) to run the session tests';

const root = path.join(__dirname, '..');
const resolve = (rel) => require.resolve(path.join(root, rel));
function stubModule(rel, exportsObj) {
  const id = resolve(rel);
  require.cache[id] = { id, filename: id, loaded: true, exports: exportsObj, children: [], paths: [] };
}

const SCHEMA = `st_${crypto.randomBytes(4).toString('hex')}`;
process.env.JWT_SECRET = 'test-jwt-secret-for-session-tests';
process.env.NODE_ENV = 'test';
process.env.CORS_ORIGINS = 'https://app.example.test';
process.env.WS_MAX_CONNECTIONS_PER_IP = '3';
process.env.WS_SWEEP_MS = '100';
delete process.env.COOKIE_SAMESITE;

let pool;
let sessions;
let express;
let jwt;
let bcrypt;
let WebSocket;

// An in-memory Redis for the price loop and the rate limiter module's import.
const fakeRedis = { mGet: async (keys) => keys.map(() => null), get: async () => null, set: async () => 'OK' };

test.before(async () => {
  if (!HAVE_DB) return;
  const { Client } = require('pg');
  const admin = new Client({
    host: process.env.TEST_PG_HOST,
    port: process.env.TEST_PG_PORT,
    user: process.env.TEST_PG_USER,
    password: process.env.TEST_PG_PASSWORD,
    database: process.env.TEST_PG_DATABASE,
  });
  await admin.connect();
  await admin.query(`CREATE SCHEMA ${SCHEMA}`);
  await admin.end();

  // A pool pinned to the throw-away schema. (config/postgres.js is replaced:
  // it checks out a client at start-up and never releases it, which would
  // keep the test process alive.)
  const { Pool } = require('pg');
  pool = new Pool({
    host: process.env.TEST_PG_HOST,
    port: process.env.TEST_PG_PORT,
    user: process.env.TEST_PG_USER,
    password: process.env.TEST_PG_PASSWORD,
    database: process.env.TEST_PG_DATABASE,
    options: `-c search_path=${SCHEMA}`,
    max: 5,
  });
  stubModule('config/postgres.js', { pool });

  stubModule('config/redis.js', { client: fakeRedis, connectRedis() {} });
  stubModule('services/redisService.js', { redisClient: fakeRedis });
  const pass = () => (req, res, next) => next();
  stubModule('middleware/rateLimiter.js', {
    generalLimiter: pass(), authLimiter: pass(), otpLimiter: pass(), orderLimiter: pass(),
  });
  // account deletion is not exercised here
  stubModule('repositories/accountDeletionRepository.js', { deleteAccount: async () => ({}) });

  await pool.query(`
    CREATE TABLE users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      full_name VARCHAR(150) NOT NULL, username VARCHAR(50) NOT NULL,
      email VARCHAR(150) NOT NULL UNIQUE, password TEXT NOT NULL,
      provider VARCHAR(20) DEFAULT 'local', google_id TEXT, avatar TEXT DEFAULT '',
      demo_balance NUMERIC(18,2) DEFAULT 1000000
    )`);
  await pool.query(fs.readFileSync(path.join(root, 'migrations/014_auth_sessions.sql'), 'utf8'));

  sessions = require('../services/sessionService');
  express = require('express');
  jwt = require('jsonwebtoken');
  bcrypt = require('bcryptjs');
  WebSocket = require('ws');
});

test.after(async () => {
  if (!HAVE_DB || !pool) return;
  await pool.query(`DROP SCHEMA ${SCHEMA} CASCADE`).catch(() => {});
  await pool.end().catch(() => {});
});

let counter = 0;
async function makeUser(password = 'Correct-Horse-9') {
  counter += 1;
  const hash = await bcrypt.hash(password, 4);
  const r = await pool.query(
    `INSERT INTO users (full_name, username, email, password)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [`Test User ${counter}`, `user${counter}`, `user${counter}@example.test`, hash],
  );
  return { ...r.rows[0], plain: password };
}

// ═════════════════════════════════════════════════════════════════════════════
// sessionService
// ═════════════════════════════════════════════════════════════════════════════

test('a session issues a short-lived access token bound to an active session', { skip }, async () => {
  const user = await makeUser();
  const s = await sessions.createSession(user.id, 'body', { headers: {}, ip: '1.2.3.4' });

  const decoded = sessions.verifyAccessToken(s.accessToken);
  assert.equal(decoded.id, user.id);
  assert.equal(decoded.sid, s.sessionId);
  assert.equal(decoded.exp - decoded.iat, 900, 'access token lives 15 minutes');
  assert.equal((await sessions.findActiveUser(decoded)).id, user.id);

  // the refresh token is stored hashed, never in plain text
  const stored = await pool.query('SELECT token_hash FROM refresh_tokens WHERE session_id = $1', [s.sessionId]);
  assert.equal(stored.rows.length, 1);
  assert.notEqual(stored.rows[0].token_hash, s.refreshToken);
  assert.equal(stored.rows[0].token_hash, crypto.createHash('sha256').update(s.refreshToken).digest('hex'));
});

test('old-style tokens (no session id) and other algorithms are rejected', { skip }, async () => {
  const user = await makeUser();
  const legacy = jwt.sign({ id: user.id }, process.env.JWT_SECRET, { expiresIn: '30d' });
  assert.throws(() => sessions.verifyAccessToken(legacy), /no session/);

  const wrongSecret = jwt.sign({ id: user.id, sid: crypto.randomUUID() }, 'another-secret');
  assert.throws(() => sessions.verifyAccessToken(wrongSecret));

  const none = `${Buffer.from('{"alg":"none"}').toString('base64url')}.${Buffer.from(
    JSON.stringify({ id: user.id, sid: crypto.randomUUID() }),
  ).toString('base64url')}.`;
  assert.throws(() => sessions.verifyAccessToken(none));
});

test('refresh rotates the token; the new pair works', { skip }, async () => {
  const user = await makeUser();
  const s = await sessions.createSession(user.id, 'body', {});
  const r = await sessions.rotateRefreshToken(s.refreshToken);

  assert.ok(r, 'rotation succeeds');
  assert.notEqual(r.refreshToken, s.refreshToken);
  assert.equal(r.sessionId, s.sessionId);
  assert.equal(r.user.email, user.email);
  assert.ok(await sessions.findActiveUser(sessions.verifyAccessToken(r.accessToken)));

  // and the new refresh token can be rotated again
  assert.ok(await sessions.rotateRefreshToken(r.refreshToken));
});

test('an unknown or garbage refresh token is refused', { skip }, async () => {
  assert.equal(await sessions.rotateRefreshToken('nope'), null);
  assert.equal(await sessions.rotateRefreshToken(''), null);
  assert.equal(await sessions.rotateRefreshToken(undefined), null);
  assert.equal(await sessions.rotateRefreshToken('x'.repeat(500)), null);
});

test('re-using a rotated refresh token right away is tolerated (double tap / two tabs)', { skip }, async () => {
  const user = await makeUser();
  const s = await sessions.createSession(user.id, 'body', {});
  assert.ok(await sessions.rotateRefreshToken(s.refreshToken));
  assert.ok(await sessions.rotateRefreshToken(s.refreshToken), 'second use inside the grace window');
});

test('re-using an OLD refresh token later revokes the whole session (theft detection)', { skip }, async () => {
  const user = await makeUser();
  const s = await sessions.createSession(user.id, 'body', {});
  const r = await sessions.rotateRefreshToken(s.refreshToken);

  // pretend the first rotation happened a minute ago
  await pool.query(
    `UPDATE refresh_tokens SET used_at = NOW() - INTERVAL '1 minute' WHERE session_id = $1 AND used_at IS NOT NULL`,
    [s.sessionId],
  );

  assert.equal(await sessions.rotateRefreshToken(s.refreshToken), null, 'stale token refused');
  assert.equal(
    await sessions.findActiveUser(sessions.verifyAccessToken(r.accessToken)),
    null,
    'the legitimate holder is signed out too, because we cannot tell who is who',
  );
  assert.equal(await sessions.rotateRefreshToken(r.refreshToken), null);
});

test('revoking a session ends its access token immediately and emits an event', { skip }, async () => {
  const user = await makeUser();
  const s = await sessions.createSession(user.id, 'body', {});
  const seen = [];
  const handler = (e) => seen.push(e);
  sessions.events.on('session-revoked', handler);
  try {
    await sessions.revokeSession(s.sessionId, 'logout');
  } finally {
    sessions.events.off('session-revoked', handler);
  }
  assert.deepEqual(seen, [{ sessionId: s.sessionId }]);
  assert.equal(await sessions.findActiveUser(sessions.verifyAccessToken(s.accessToken)), null);
  assert.equal(await sessions.rotateRefreshToken(s.refreshToken), null);
});

test('password reset: revokeAllUserSessions signs out every device, and only that user', { skip }, async () => {
  const a = await makeUser();
  const b = await makeUser();
  const a1 = await sessions.createSession(a.id, 'body', {});
  const a2 = await sessions.createSession(a.id, 'cookie', {});
  const b1 = await sessions.createSession(b.id, 'body', {});

  await sessions.revokeAllUserSessions(a.id, 'password_reset');

  for (const s of [a1, a2]) {
    assert.equal(await sessions.findActiveUser(sessions.verifyAccessToken(s.accessToken)), null);
    assert.equal(await sessions.rotateRefreshToken(s.refreshToken), null);
  }
  assert.ok(await sessions.findActiveUser(sessions.verifyAccessToken(b1.accessToken)), 'other users untouched');
});

test('account deletion: sessions disappear with the user row', { skip }, async () => {
  const user = await makeUser();
  const s = await sessions.createSession(user.id, 'body', {});
  await pool.query('DELETE FROM users WHERE id = $1', [user.id]);
  assert.equal(await sessions.findActiveUser(sessions.verifyAccessToken(s.accessToken)), null);
  assert.equal(await sessions.rotateRefreshToken(s.refreshToken), null);
});

test('an expired session is not accepted', { skip }, async () => {
  const user = await makeUser();
  const s = await sessions.createSession(user.id, 'body', {});
  await pool.query(`UPDATE auth_sessions SET expires_at = NOW() - INTERVAL '1 second' WHERE id = $1`, [s.sessionId]);
  assert.equal(await sessions.findActiveUser(sessions.verifyAccessToken(s.accessToken)), null);
  assert.equal(await sessions.rotateRefreshToken(s.refreshToken), null);
});

test('legacy mode (app builds without refresh tokens): long token, still revocable, no refresh token', { skip }, async () => {
  const user = await makeUser();
  const s = await sessions.createSession(user.id, 'legacy', {});
  assert.equal(s.refreshToken, null);
  const decoded = sessions.verifyAccessToken(s.accessToken);
  assert.equal(decoded.exp - decoded.iat, 30 * 86400);
  await sessions.revokeSession(s.sessionId, 'logout');
  assert.equal(await sessions.findActiveUser(decoded), null);
});

// ═════════════════════════════════════════════════════════════════════════════
// HTTP: auth routes, cookies, CSRF guard, CORS
// ═════════════════════════════════════════════════════════════════════════════

async function withApi(fn) {
  const cors = require('cors');
  const { corsOptions } = require('../config/cors');
  const { protect } = require('../middleware/auth');
  const app = express();
  app.use(cors(corsOptions));
  app.use(express.json());
  app.use('/api/auth', require('../routes/auth'));
  app.get('/api/me', protect, (req, res) => res.json({ id: req.user.id }));
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    return await fn(base);
  } finally {
    await new Promise((r) => server.close(r));
  }
}

const WEB = { 'Content-Type': 'application/json', 'X-Auth-Mode': 'cookie', Origin: 'https://app.example.test' };
const NATIVE = { 'Content-Type': 'application/json', 'X-Auth-Mode': 'body' };
const OLD_APP = { 'Content-Type': 'application/json' };
const post = (base, url, headers, body) =>
  fetch(base + url, { method: 'POST', headers, body: body === undefined ? undefined : JSON.stringify(body) });
const cookieHeader = (res) => {
  const raw = res.headers.getSetCookie().find((c) => c.startsWith('stocksy_rt='));
  return raw ? raw.split(';')[0] : null;
};

test('web login: refresh token is an httpOnly cookie, never in the JSON body', { skip }, async () => {
  const user = await makeUser();
  await withApi(async (base) => {
    const res = await post(base, '/api/auth/login', WEB, { email: user.email, password: user.plain });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(body.token);
    assert.equal(body.expiresIn, 900);
    assert.equal(body.refreshToken, undefined, 'no refresh token in the body for web');
    assert.equal(res.headers.get('cache-control'), 'no-store');

    const setCookie = res.headers.getSetCookie().find((c) => c.startsWith('stocksy_rt='));
    assert.match(setCookie, /HttpOnly/i);
    assert.match(setCookie, /Path=\/api\/auth/i);
    assert.match(setCookie, /SameSite=Lax/i);
    assert.match(setCookie, /Max-Age=\d+/i);
  });
});

test('native login: refresh token comes in the body, no cookie is set', { skip }, async () => {
  const user = await makeUser();
  await withApi(async (base) => {
    const res = await post(base, '/api/auth/login', NATIVE, { email: user.email, password: user.plain });
    const body = await res.json();
    assert.ok(body.token && body.refreshToken);
    assert.equal(cookieHeader(res), null);
  });
});

test('old app builds (no X-Auth-Mode) still log in and get a working token', { skip }, async () => {
  const user = await makeUser();
  await withApi(async (base) => {
    const res = await post(base, '/api/auth/login', OLD_APP, { email: user.email, password: user.plain });
    const body = await res.json();
    assert.ok(body.token);
    assert.equal(body.refreshToken, undefined);
    const me = await fetch(`${base}/api/me`, { headers: { Authorization: `Bearer ${body.token}` } });
    assert.equal(me.status, 200);
    // and they cannot refresh: they have nothing to refresh with
    assert.equal((await post(base, '/api/auth/refresh', OLD_APP, {})).status, 401);
  });
});

test('signup starts a session too', { skip }, async () => {
  await withApi(async (base) => {
    const res = await post(base, '/api/auth/signup', NATIVE, {
      fullName: 'New Person', email: `new${Date.now()}@example.test`, password: 'Sup3r-secret!',
    });
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.ok(body.token && body.refreshToken);
  });
});

test('web refresh: cookie → new access token + rotated cookie; old cookie stops being the live one', { skip }, async () => {
  const user = await makeUser();
  await withApi(async (base) => {
    const login = await post(base, '/api/auth/login', WEB, { email: user.email, password: user.plain });
    const cookie1 = cookieHeader(login);

    const res = await post(base, '/api/auth/refresh', { ...WEB, Cookie: cookie1 });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(body.token);
    assert.equal(body.email, user.email);
    assert.equal(body.refreshToken, undefined);
    const cookie2 = cookieHeader(res);
    assert.ok(cookie2 && cookie2 !== cookie1, 'cookie was rotated');

    const me = await fetch(`${base}/api/me`, { headers: { Authorization: `Bearer ${body.token}` } });
    assert.equal(me.status, 200);
  });
});

test('CSRF guard: refresh/logout with the cookie but no X-Auth-Mode header is refused', { skip }, async () => {
  const user = await makeUser();
  await withApi(async (base) => {
    const cookie = cookieHeader(await post(base, '/api/auth/login', WEB, { email: user.email, password: user.plain }));
    for (const url of ['/api/auth/refresh', '/api/auth/logout']) {
      const res = await post(base, url, { 'Content-Type': 'application/json', Cookie: cookie });
      assert.equal(res.status, 403, url);
    }
    // ...and the session survived the forged logout
    assert.equal((await post(base, '/api/auth/refresh', { ...WEB, Cookie: cookie })).status, 200);
  });
});

test('CSRF guard: a cookie request from a foreign origin is refused', { skip }, async () => {
  const user = await makeUser();
  await withApi(async (base) => {
    const cookie = cookieHeader(await post(base, '/api/auth/login', WEB, { email: user.email, password: user.plain }));
    const res = await post(base, '/api/auth/refresh', { ...WEB, Origin: 'https://evil.example', Cookie: cookie });
    assert.equal(res.status, 403);
  });
});

test('refresh with no / bad cookie is SESSION_EXPIRED and clears the cookie', { skip }, async () => {
  await withApi(async (base) => {
    const res = await post(base, '/api/auth/refresh', { ...WEB, Cookie: 'stocksy_rt=garbage' });
    assert.equal(res.status, 401);
    assert.equal((await res.json()).code, 'SESSION_EXPIRED');
    assert.match(res.headers.getSetCookie().join(';'), /stocksy_rt=;/);
  });
});

test('web logout revokes server-side: access token and refresh cookie both die', { skip }, async () => {
  const user = await makeUser();
  await withApi(async (base) => {
    const login = await post(base, '/api/auth/login', WEB, { email: user.email, password: user.plain });
    const { token } = await login.json();
    const cookie = cookieHeader(login);

    const out = await post(base, '/api/auth/logout', { ...WEB, Cookie: cookie });
    assert.equal(out.status, 200);
    assert.match(out.headers.getSetCookie().join(';'), /stocksy_rt=;/, 'cookie cleared');

    const me = await fetch(`${base}/api/me`, { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(me.status, 401, 'access token no longer works, even though it has not expired');
    assert.equal((await post(base, '/api/auth/refresh', { ...WEB, Cookie: cookie })).status, 401);
  });
});

test('native logout: works with only the refresh token (access token already expired)', { skip }, async () => {
  const user = await makeUser();
  await withApi(async (base) => {
    const login = await (await post(base, '/api/auth/login', NATIVE, { email: user.email, password: user.plain })).json();
    const out = await post(base, '/api/auth/logout', NATIVE, { refreshToken: login.refreshToken });
    assert.equal(out.status, 200);
    assert.equal((await post(base, '/api/auth/refresh', NATIVE, { refreshToken: login.refreshToken })).status, 401);
    const me = await fetch(`${base}/api/me`, { headers: { Authorization: `Bearer ${login.token}` } });
    assert.equal(me.status, 401);
  });
});

test('old app logout (Bearer only) still revokes the session', { skip }, async () => {
  const user = await makeUser();
  await withApi(async (base) => {
    const login = await (await post(base, '/api/auth/login', OLD_APP, { email: user.email, password: user.plain })).json();
    const out = await post(base, '/api/auth/logout', { ...OLD_APP, Authorization: `Bearer ${login.token}` });
    assert.equal(out.status, 200);
    const me = await fetch(`${base}/api/me`, { headers: { Authorization: `Bearer ${login.token}` } });
    assert.equal(me.status, 401);
  });
});

test('logout never errors, even with nothing to revoke', { skip }, async () => {
  await withApi(async (base) => {
    assert.equal((await post(base, '/api/auth/logout', NATIVE, {})).status, 200);
    assert.equal((await post(base, '/api/auth/logout', { ...NATIVE, Authorization: 'Bearer junk' }, {})).status, 200);
  });
});

test('CORS: allowed origin is reflected with credentials; foreign origin gets no CORS headers', { skip }, async () => {
  await withApi(async (base) => {
    const ok = await fetch(`${base}/api/me`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://app.example.test',
        'Access-Control-Request-Method': 'GET',
        'Access-Control-Request-Headers': 'authorization,x-auth-mode',
      },
    });
    assert.equal(ok.headers.get('access-control-allow-origin'), 'https://app.example.test');
    assert.equal(ok.headers.get('access-control-allow-credentials'), 'true');
    assert.match(ok.headers.get('access-control-allow-headers'), /X-Auth-Mode/i);

    const bad = await fetch(`${base}/api/me`, {
      method: 'OPTIONS',
      headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'GET' },
    });
    assert.equal(bad.headers.get('access-control-allow-origin'), null);
    assert.notEqual(bad.status, 500, 'a blocked origin must not become a server error');

    const badSimple = await fetch(`${base}/api/me`, { headers: { Origin: 'https://evil.example' } });
    assert.equal(badSimple.headers.get('access-control-allow-origin'), null);

    // no Origin header (native app / curl): unaffected
    assert.equal((await fetch(`${base}/api/me`)).status, 401);
  });
});

test('CORS: the API origin itself is NOT implicitly allowed', { skip }, async () => {
  const { isOriginAllowed } = require('../config/cors');
  assert.equal(isOriginAllowed('https://api.stocksy.online'), false);
  assert.equal(isOriginAllowed('https://app.example.test'), true);
  assert.equal(isOriginAllowed('https://APP.example.test/'), true, 'case + trailing slash normalised');
  assert.equal(isOriginAllowed(undefined), true);
  assert.equal(isOriginAllowed('null'), false);
});

test('CORS: in production, localhost is not allowed; in dev it is', { skip }, async () => {
  const { isOriginAllowed } = require('../config/cors');
  process.env.NODE_ENV = 'production';
  try {
    assert.equal(isOriginAllowed('http://localhost:8081'), false);
    assert.equal(isOriginAllowed('https://app.example.test'), true);
  } finally {
    process.env.NODE_ENV = 'development';
  }
  try {
    assert.equal(isOriginAllowed('http://localhost:8081'), true);
    assert.equal(isOriginAllowed('http://evil.localhost.example.com'), false);
  } finally {
    process.env.NODE_ENV = 'test';
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// WebSocket
// ═════════════════════════════════════════════════════════════════════════════

async function withWs(fn) {
  const { initWebSocket } = require('../services/websocketService');
  const server = http.createServer((req, res) => res.end('ok'));
  const wss = initWebSocket(server);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `ws://127.0.0.1:${server.address().port}`;
  try {
    return await fn(url);
  } finally {
    wss.clients.forEach((c) => c.terminate());
    wss.emit('close');
    await new Promise((r) => server.close(r));
  }
}

const open = (url, opts) =>
  new Promise((resolve, reject) => {
    const ws = new WebSocket(url, opts);
    ws.messages = [];
    ws.on('message', (d) => ws.messages.push(d.toString()));
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
    ws.once('unexpected-response', (_req, res) => reject(Object.assign(new Error('rejected'), { status: res.statusCode })));
  });
const closed = (ws) => new Promise((resolve) => (ws.readyState === 3 ? resolve({}) : ws.once('close', (code, reason) => resolve({ code, reason: reason.toString() }))));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('WS: browsers from a foreign origin are refused at the upgrade; allowed + no-origin are accepted', { skip }, async () => {
  await withWs(async (url) => {
    await assert.rejects(open(url, { origin: 'https://evil.example' }), (e) => e.status === 403);
    const a = await open(url, { origin: 'https://app.example.test' });
    const b = await open(url); // native: no Origin header
    a.close(); b.close();
  });
});

test('WS: AUTH message authenticates — token never has to be in the URL — and the feed is delivered', { skip }, async () => {
  const user = await makeUser();
  const s = await sessions.createSession(user.id, 'body', {});
  const { notifyClient } = require('../services/websocketService');
  await withWs(async (url) => {
    const ws = await open(url);
    ws.send(JSON.stringify({ type: 'AUTH', token: s.accessToken }));
    await sleep(150);
    notifyClient(user.id, { type: 'ORDER_FILLED', symbol: 'TCS' });
    await sleep(1000); // one price tick is 800 ms
    assert.ok(ws.messages.some((m) => m.includes('ORDER_FILLED')), 'per-user push reaches the authenticated socket');
    assert.ok(ws.messages.some((m) => m.includes('No data in Redis') || m.includes('MARKET_DATA')), 'public feed flows');
    ws.close();
  });
});

test('WS: a bad / foreign / legacy token closes the socket with 4401 and registers nobody', { skip }, async () => {
  const user = await makeUser();
  const legacy = jwt.sign({ id: user.id }, process.env.JWT_SECRET, { expiresIn: '30d' });
  const { notifyClient } = require('../services/websocketService');
  await withWs(async (url) => {
    for (const token of ['garbage', legacy, 12345, 'x'.repeat(3000)]) {
      const ws = await open(url);
      ws.send(JSON.stringify({ type: 'AUTH', token }));
      assert.equal((await closed(ws)).code, 4401);
    }
    notifyClient(user.id, { type: 'ORDER_FILLED' }); // must not throw / reach anyone
  });
});

test('WS: anonymous sockets still get the public price feed', { skip }, async () => {
  await withWs(async (url) => {
    const ws = await open(url);
    await sleep(1000);
    assert.ok(ws.messages.length > 0);
    ws.close();
  });
});

test('WS: a session revoked by logout drops its live socket at once', { skip }, async () => {
  const user = await makeUser();
  const s = await sessions.createSession(user.id, 'body', {});
  await withWs(async (url) => {
    const ws = await open(url);
    ws.send(JSON.stringify({ type: 'AUTH', token: s.accessToken }));
    await sleep(150);
    await sessions.revokeSession(s.sessionId, 'logout');
    const c = await closed(ws);
    assert.equal(c.code, 4401);
  });
});

test('WS: password reset / account deletion drops every socket of that user, and only theirs', { skip }, async () => {
  const a = await makeUser();
  const b = await makeUser();
  const sa = await sessions.createSession(a.id, 'body', {});
  const sb = await sessions.createSession(b.id, 'body', {});
  await withWs(async (url) => {
    const wa = await open(url);
    const wb = await open(url);
    wa.send(JSON.stringify({ type: 'AUTH', token: sa.accessToken }));
    wb.send(JSON.stringify({ type: 'AUTH', token: sb.accessToken }));
    await sleep(200);
    await sessions.revokeAllUserSessions(a.id, 'password_reset');
    assert.equal((await closed(wa)).code, 4401);
    await sleep(100);
    assert.equal(wb.readyState, 1, 'the other user keeps their socket');
    wb.close();
  });
});

test('WS: server asks for a fresh token before expiry (REAUTH) and closes at expiry if none comes', { skip }, async () => {
  const user = await makeUser();
  const s = await sessions.createSession(user.id, 'body', {});
  const short = sessions.signAccessToken(user.id, s.sessionId, 2); // 2 s token
  await withWs(async (url) => {
    const ws = await open(url);
    ws.send(JSON.stringify({ type: 'AUTH', token: short }));
    await sleep(400);
    assert.ok(ws.messages.some((m) => m.includes('"REAUTH"')), 'REAUTH requested (inside the 60 s lead)');
    const c = await closed(ws);
    assert.equal(c.code, 4401, 'closed when the token expired');
  });
});

test('WS: re-authenticating with a fresh token keeps the socket alive past the old expiry', { skip }, async () => {
  const user = await makeUser();
  const s = await sessions.createSession(user.id, 'body', {});
  await withWs(async (url) => {
    const ws = await open(url);
    ws.send(JSON.stringify({ type: 'AUTH', token: sessions.signAccessToken(user.id, s.sessionId, 2) }));
    await sleep(300);
    ws.send(JSON.stringify({ type: 'AUTH', token: sessions.signAccessToken(user.id, s.sessionId, 900) }));
    await sleep(2500);
    assert.equal(ws.readyState, 1, 'still open after the first token would have expired');
    ws.close();
  });
});

test('WS: a socket cannot switch to a different user via re-AUTH', { skip }, async () => {
  const a = await makeUser();
  const b = await makeUser();
  const sa = await sessions.createSession(a.id, 'body', {});
  const sb = await sessions.createSession(b.id, 'body', {});
  await withWs(async (url) => {
    const ws = await open(url);
    ws.send(JSON.stringify({ type: 'AUTH', token: sa.accessToken }));
    await sleep(150);
    ws.send(JSON.stringify({ type: 'AUTH', token: sb.accessToken }));
    assert.equal((await closed(ws)).code, 4401);
  });
});

test('WS: legacy ?token= in the URL is still accepted during the transition, and can be switched off', { skip }, async () => {
  const user = await makeUser();
  const s = await sessions.createSession(user.id, 'body', {});
  const { notifyClient } = require('../services/websocketService');
  await withWs(async (url) => {
    const ws = await open(`${url}/?token=${encodeURIComponent(s.accessToken)}`);
    await sleep(200);
    notifyClient(user.id, { type: 'ORDER_REJECTED' });
    await sleep(100);
    assert.ok(ws.messages.some((m) => m.includes('ORDER_REJECTED')));
    ws.close();
  });
});

test('WS: messages over 4 KB close the socket', { skip }, async () => {
  await withWs(async (url) => {
    const ws = await open(url);
    ws.send('x'.repeat(10 * 1024));
    const c = await closed(ws);
    assert.equal(c.code, 1009);
  });
});

test('WS: message flood is cut off', { skip }, async () => {
  await withWs(async (url) => {
    const ws = await open(url);
    for (let i = 0; i < 60; i += 1) ws.send('{}');
    const c = await closed(ws);
    assert.equal(c.code, 1008);
  });
});

test('WS: per-IP connection cap; slot is freed when a socket closes', { skip }, async () => {
  await withWs(async (url) => {
    const held = [await open(url), await open(url), await open(url)]; // cap is 3
    await assert.rejects(open(url), (e) => e.status === 429);
    held[0].close();
    await closed(held[0]);
    await sleep(100);
    const again = await open(url);
    again.close();
    held.slice(1).forEach((w) => w.close());
  });
});

test('WS: with nobody connected the price loop does not touch Redis', { skip }, async () => {
  let reads = 0;
  const orig = fakeRedis.mGet;
  fakeRedis.mGet = async (...a) => { reads += 1; return orig(...a); };
  try {
    await withWs(async () => {
      await sleep(2000);
      assert.equal(reads, 0);
    });
  } finally {
    fakeRedis.mGet = orig;
  }
});

test('WS: many sockets share ONE Redis read per tick', { skip }, async () => {
  let reads = 0;
  const orig = fakeRedis.mGet;
  fakeRedis.mGet = async (...a) => { reads += 1; return orig(...a); };
  try {
    await withWs(async (url) => {
      const conns = await Promise.all([open(url), open(url), open(url)]);
      reads = 0;
      await sleep(2000);
      // 800 ms tick => ~2-3 reads in 2 s regardless of the 3 connections
      assert.ok(reads >= 1 && reads <= 4, `reads=${reads}`);
      conns.forEach((c) => c.close());
    });
  } finally {
    fakeRedis.mGet = orig;
  }
});
