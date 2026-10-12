// Security regression tests for "step 1" fixes:
//   item 4 — POST /api/fundamentals needs the internal key
//   item 5 — /api/revenue/* is admin only
//   item 6 — the unauthenticated debug square-off route is gone
//   item 9 — request headers/bodies (tokens, passwords) are not logged
//
// No database or Redis is needed: config/redis, config/postgres and the
// revenue service are replaced with in-memory fakes before the routes load.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const express = require('express');
const jwt = require('jsonwebtoken');

const root = path.join(__dirname, '..');
const resolve = (rel) => require.resolve(path.join(root, rel));

function stubModule(rel, exportsObj) {
  const id = resolve(rel);
  require.cache[id] = { id, filename: id, loaded: true, exports: exportsObj, children: [], paths: [] };
}

// ── fakes ────────────────────────────────────────────────────────────────────
const redisCalls = { set: [] };
const fakeRedis = {
  set: async (...args) => { redisCalls.set.push(args); return 'OK'; },
  get: async () => null,
};
stubModule('config/redis.js', { client: fakeRedis, connectRedis() {} });

const ADMIN_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
stubModule('config/postgres.js', {
  pool: {
    query: async (_sql, params) => ({
      rows: [{ id: params[0], full_name: 'T', username: 't', email: 't@x.com', provider: 'local' }],
    }),
  },
});
stubModule('services/revenueService.js', {
  getRevenueSummary: async () => ({ total: 1 }),
  getMonthlyRevenue: async () => [],
  getDailyRevenue: async () => [],
  getRevenueBySymbol: async () => [],
  getRevenueLedger: async () => [],
});

process.env.JWT_SECRET = 'test-jwt-secret-for-security-tests';
const INTERNAL_KEY = 'k'.repeat(32);

// ── helpers ──────────────────────────────────────────────────────────────────
async function withServer(mount, fn) {
  const app = express();
  app.use(express.json());
  mount(app);
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    return await fn(base);
  } finally {
    await new Promise((r) => server.close(r));
  }
}

function setEnv(vars) {
  const before = {};
  for (const [k, v] of Object.entries(vars)) {
    before[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  return () => {
    for (const [k, v] of Object.entries(before)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  };
}

// Since step 2 an access token must carry a session id that is still alive.
const sessions = require('../services/sessionService');
sessions.setStore({
  findActiveSessionUser: async (_sid, userId) => ({ id: userId, full_name: 'T', username: 't', email: 't@x.com', provider: 'local' }),
});
const bearer = (id) => ({ Authorization: `Bearer ${jwt.sign({ id, sid: 'test-session' }, process.env.JWT_SECRET)}` });
const validSnapshot = { stocks: { TCS: { pe: 30 }, INFY: { pe: 25 } } };
const post = (base, body, headers = {}) =>
  fetch(`${base}/api/fundamentals`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });

const mountFundamentals = (app) => app.use('/api/fundamentals', require('../routes/fundamentals'));
const mountRevenue = (app) => app.use('/api/revenue', require('../routes/revenue'));

// ── item 4: fundamentals ingest ──────────────────────────────────────────────
test('item 4: POST /api/fundamentals without a key is rejected and writes nothing', async () => {
  const restore = setEnv({ INTERNAL_API_KEY: INTERNAL_KEY });
  redisCalls.set.length = 0;
  try {
    await withServer(mountFundamentals, async (base) => {
      const res = await post(base, validSnapshot);
      assert.equal(res.status, 401);
      assert.equal((await res.json()).code, 'UNAUTHORIZED');
    });
    assert.equal(redisCalls.set.length, 0, 'redis.set must not be called');
  } finally { restore(); }
});

test('item 4: wrong key is rejected, including a key of a different length', async () => {
  const restore = setEnv({ INTERNAL_API_KEY: INTERNAL_KEY });
  redisCalls.set.length = 0;
  try {
    await withServer(mountFundamentals, async (base) => {
      assert.equal((await post(base, validSnapshot, { 'X-Internal-Key': 'wrong' })).status, 401);
      assert.equal((await post(base, validSnapshot, { 'X-Internal-Key': INTERNAL_KEY + 'x' })).status, 401);
      assert.equal((await post(base, validSnapshot, { 'X-Internal-Key': INTERNAL_KEY.slice(1) })).status, 401);
    });
    assert.equal(redisCalls.set.length, 0);
  } finally { restore(); }
});

test('item 4: a logged-in user\'s JWT is NOT enough to overwrite fundamentals', async () => {
  const restore = setEnv({ INTERNAL_API_KEY: INTERNAL_KEY });
  redisCalls.set.length = 0;
  try {
    await withServer(mountFundamentals, async (base) => {
      const res = await post(base, validSnapshot, bearer(USER_ID));
      assert.equal(res.status, 401);
    });
    assert.equal(redisCalls.set.length, 0);
  } finally { restore(); }
});

test('item 4: correct key + valid snapshot is accepted and cached', async () => {
  const restore = setEnv({ INTERNAL_API_KEY: INTERNAL_KEY });
  redisCalls.set.length = 0;
  try {
    await withServer(mountFundamentals, async (base) => {
      const res = await post(base, validSnapshot, { 'X-Internal-Key': INTERNAL_KEY });
      assert.equal(res.status, 200);
      assert.deepEqual(await res.json(), { success: true, stocks: 2 });
    });
    assert.equal(redisCalls.set.length, 1);
    assert.equal(redisCalls.set[0][0], 'fundamentals:ALL');
  } finally { restore(); }
});

test('item 4: correct key but malformed body is a 400 and does not overwrite the cache', async () => {
  const restore = setEnv({ INTERNAL_API_KEY: INTERNAL_KEY });
  redisCalls.set.length = 0;
  try {
    await withServer(mountFundamentals, async (base) => {
      const h = { 'X-Internal-Key': INTERNAL_KEY };
      for (const bad of [{}, { stocks: null }, { stocks: [] }, { stocks: {} }, { stocks: 'x' }, []]) {
        const res = await post(base, bad, h);
        assert.equal(res.status, 400, JSON.stringify(bad));
      }
    });
    assert.equal(redisCalls.set.length, 0);
  } finally { restore(); }
});

test('item 4: fails closed when INTERNAL_API_KEY is unset or too short', async () => {
  for (const value of [undefined, '', 'short']) {
    const restore = setEnv({ INTERNAL_API_KEY: value });
    redisCalls.set.length = 0;
    try {
      await withServer(mountFundamentals, async (base) => {
        // even sending the same weak value must not work
        const res = await post(base, validSnapshot, { 'X-Internal-Key': value || '' });
        assert.equal(res.status, 503);
      });
      assert.equal(redisCalls.set.length, 0);
    } finally { restore(); }
  }
});

test('item 4: reading fundamentals (GET) stays public', async () => {
  const restore = setEnv({ INTERNAL_API_KEY: INTERNAL_KEY });
  try {
    await withServer(mountFundamentals, async (base) => {
      const res = await fetch(`${base}/api/fundamentals/TCS`);
      assert.notEqual(res.status, 401);
      assert.notEqual(res.status, 403);
    });
  } finally { restore(); }
});

// ── item 5: revenue is admin only ────────────────────────────────────────────
const REVENUE_PATHS = ['summary', 'monthly', 'daily', 'by-symbol', 'ledger'];

test('item 5: not logged in → 401 on every revenue route', async () => {
  const restore = setEnv({ ADMIN_USER_IDS: ADMIN_ID });
  try {
    await withServer(mountRevenue, async (base) => {
      for (const p of REVENUE_PATHS) {
        assert.equal((await fetch(`${base}/api/revenue/${p}`)).status, 401, p);
      }
    });
  } finally { restore(); }
});

test('item 5: logged-in non-admin → 403 on every revenue route', async () => {
  const restore = setEnv({ ADMIN_USER_IDS: ADMIN_ID });
  try {
    await withServer(mountRevenue, async (base) => {
      for (const p of REVENUE_PATHS) {
        const res = await fetch(`${base}/api/revenue/${p}`, { headers: bearer(USER_ID) });
        assert.equal(res.status, 403, p);
        assert.equal((await res.json()).code, 'FORBIDDEN');
      }
    });
  } finally { restore(); }
});

test('item 5: admin user id → 200 on every revenue route', async () => {
  const restore = setEnv({ ADMIN_USER_IDS: ` ${USER_ID.toUpperCase().replace(/2/g, '3')} , ${ADMIN_ID} ` });
  try {
    await withServer(mountRevenue, async (base) => {
      for (const p of REVENUE_PATHS) {
        const res = await fetch(`${base}/api/revenue/${p}`, { headers: bearer(ADMIN_ID) });
        assert.equal(res.status, 200, p);
      }
    });
  } finally { restore(); }
});

test('item 5: fails closed — with ADMIN_USER_IDS unset or blank nobody gets in', async () => {
  for (const value of [undefined, '', ' , ,']) {
    const restore = setEnv({ ADMIN_USER_IDS: value });
    try {
      await withServer(mountRevenue, async (base) => {
        for (const id of [ADMIN_ID, USER_ID]) {
          const res = await fetch(`${base}/api/revenue/summary`, { headers: bearer(id) });
          assert.equal(res.status, 403);
        }
      });
    } finally { restore(); }
  }
});

test('item 5: an admin\'s EMAIL being in the env var grants nothing (ids only)', async () => {
  const restore = setEnv({ ADMIN_USER_IDS: 't@x.com' });
  try {
    await withServer(mountRevenue, async (base) => {
      const res = await fetch(`${base}/api/revenue/summary`, { headers: bearer(USER_ID) });
      assert.equal(res.status, 403);
    });
  } finally { restore(); }
});

// ── item 6: debug route removed ──────────────────────────────────────────────
test('item 6: the debug square-off route file and mount are gone', () => {
  assert.equal(fs.existsSync(path.join(root, 'routes', 'debug.js')), false);
  const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
  assert.ok(!/require\(["']\.\/routes\/debug["']\)/.test(server), 'server.js must not mount routes/debug');
  assert.ok(!/app\.use\(\s*["']\/api\/debug/.test(server), 'no /api/debug mount');
});

// ── item 9: no secrets in logs ───────────────────────────────────────────────
function loggedExpressions(source) {
  // every console.* / logger.* call, including multi-line ones, up to the matching ");"
  return source.match(/(?:console|logger)\.\w+\([\s\S]*?\);/g) || [];
}

for (const file of ['server.js', 'controllers/auth.js']) {
  test(`item 9: ${file} never logs request headers, bodies or the password`, () => {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    for (const call of loggedExpressions(source)) {
      assert.ok(!/req\.headers|req\.body|authorization/i.test(call), `leaks request data: ${call.slice(0, 120)}`);
      assert.ok(!/\bpassword\s*[,)]|JSON\.stringify\(req/i.test(call.replace(/"[^"]*"|'[^']*'/g, '""')),
        `may log a password: ${call.slice(0, 120)}`);
    }
  });
}

test('item 9: login/signup do not log the full error object or the email', () => {
  const source = fs.readFileSync(path.join(root, 'controllers', 'auth.js'), 'utf8');
  assert.ok(!/Full error/.test(source));
  assert.ok(!/console\.\w+\([^;]*\bemail\b\s*[,)]/.test(source.replace(/"[^"]*"/g, '""')));
});
