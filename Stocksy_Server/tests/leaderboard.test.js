// Leaderboard — the rules that need no database (scope / limit parsing, the
// response shape, the points weights), then the ranking SQL against a REAL
// Postgres. The SQL tests are skipped unless a scratch database is provided:
//
//   TEST_PG_HOST=127.0.0.1 TEST_PG_PORT=5432 TEST_PG_USER=postgres \
//   TEST_PG_DATABASE=stocksy_test node --test tests/leaderboard.test.js
//
// Everything is created inside a throw-away schema that is dropped at the end,
// so the database can be any scratch database. Redis is not needed.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');

const L = require('../services/leaderboardLogic');

const ID_ME = '0b6f3a52-6a39-4c63-9d1b-6a0e5b6f2f11';
const ID_OTHER = '7d2c1e9a-3f44-4b57-8a0c-1d9e2f3a4b55';

// ═════════════════════════════════════════════════════════════════════════════
// Pure rules
// ═════════════════════════════════════════════════════════════════════════════

test('POINTS are whole, positive numbers (SQL casts them to int)', () => {
  for (const [name, value] of Object.entries(L.POINTS)) {
    assert.ok(Number.isInteger(value) && value > 0, `${name} must be a positive integer`);
  }
});

test('parseScope: friends is the default, both scopes are accepted, anything else is null', () => {
  assert.equal(L.parseScope(undefined), 'friends');
  assert.equal(L.parseScope(''), 'friends');
  assert.equal(L.parseScope('friends'), 'friends');
  assert.equal(L.parseScope('global'), 'global');
  assert.equal(L.parseScope('  GLOBAL '), 'global');
  assert.equal(L.parseScope('everyone'), null);
  assert.equal(L.parseScope('global; DROP TABLE users'), null);
  assert.equal(L.parseScope(['friends', 'global']), null); // ?scope=a&scope=b
  assert.equal(L.parseScope({ x: 'global' }), null); // ?scope[x]=global
  assert.equal(L.parseScope(42), null);
});

test('clampLimit defaults, floors at 1 and caps at the max', () => {
  assert.equal(L.clampLimit(undefined), L.LIMIT.def);
  assert.equal(L.clampLimit(''), L.LIMIT.def);
  assert.equal(L.clampLimit('abc'), L.LIMIT.def);
  assert.equal(L.clampLimit('0'), L.LIMIT.def);
  assert.equal(L.clampLimit('-3'), L.LIMIT.def);
  assert.equal(L.clampLimit('1'), 1);
  assert.equal(L.clampLimit('25'), 25);
  assert.equal(L.clampLimit(String(L.LIMIT.max)), L.LIMIT.max);
  assert.equal(L.clampLimit('99999'), L.LIMIT.max);
});

const row = (over = {}) => ({
  rank: 1,
  id: ID_OTHER,
  full_name: 'Asha Rao',
  handle: 'asha',
  avatar: '',
  avatar_id: 'female_3',
  points: 40,
  total: 7,
  ...over,
});

test('serializeEntry exposes only what the board needs, and flags your own row', () => {
  const entry = L.serializeEntry(row(), ID_ME);
  assert.deepEqual(entry, {
    rank: 1,
    id: ID_OTHER,
    fullName: 'Asha Rao',
    username: 'asha',
    avatar: '',
    avatarId: 'female_3',
    points: 40,
    isSelf: false,
  });
  assert.equal(L.serializeEntry(row({ id: ID_ME }), ID_ME).isSelf, true);
  // no email / balance / provider can leak through
  assert.deepEqual(
    Object.keys(L.serializeEntry({ ...row(), email: 'a@b.c', demo_balance: 1, provider: 'google' }, ID_ME)).sort(),
    ['avatar', 'avatarId', 'fullName', 'id', 'isSelf', 'points', 'rank', 'username'],
  );
});

test('serializeEntry: no chosen username → null, no picked avatar → null, numeric strings → numbers', () => {
  const entry = L.serializeEntry(row({ handle: null, avatar_id: null, avatar: null, rank: '3', points: '12' }), ID_ME);
  assert.equal(entry.username, null);
  assert.equal(entry.avatarId, null);
  assert.equal(entry.avatar, '');
  assert.equal(entry.rank, 3);
  assert.equal(entry.points, 12);
});

test('buildResponse: top rows go in entries, your own row (even far down) goes in me', () => {
  const rows = [
    row({ rank: 1, id: ID_OTHER, points: 90, total: 340 }),
    row({ rank: 2, id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', points: 80, total: 340 }),
    row({ rank: 340, id: ID_ME, points: 0, total: 340 }),
  ];
  const res = L.buildResponse('global', rows, 2, ID_ME);
  assert.equal(res.scope, 'global');
  assert.equal(res.total, 340);
  assert.deepEqual(res.entries.map((e) => e.rank), [1, 2]);
  assert.equal(res.me.rank, 340);
  assert.equal(res.me.isSelf, true);
});

test('buildResponse: when you are inside the top rows you are both in entries and in me', () => {
  const rows = [row({ rank: 1, id: ID_ME, total: 1 })];
  const res = L.buildResponse('friends', rows, 50, ID_ME);
  assert.equal(res.entries.length, 1);
  assert.equal(res.me.id, ID_ME);
});

test('buildResponse: an empty table is empty, not an error', () => {
  assert.deepEqual(L.buildResponse('global', [], 50, ID_ME), {
    scope: 'global',
    total: 0,
    entries: [],
    me: null,
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// The ranking SQL, against a real Postgres
// ═════════════════════════════════════════════════════════════════════════════

const HAVE_DB = !!process.env.TEST_PG_DATABASE;
const skip = HAVE_DB ? false : 'set TEST_PG_DATABASE (and friends) to run the leaderboard SQL tests';

const root = path.join(__dirname, '..');
function stubModule(rel, exportsObj) {
  const id = require.resolve(path.join(root, rel));
  require.cache[id] = { id, filename: id, loaded: true, exports: exportsObj, children: [], paths: [] };
}

const SCHEMA = `lb_${crypto.randomBytes(4).toString('hex')}`;
let pool;
let repo;
let controller;
let server;
let baseUrl;

test.before(async () => {
  if (!HAVE_DB) return;
  const conn = {
    host: process.env.TEST_PG_HOST,
    port: process.env.TEST_PG_PORT,
    user: process.env.TEST_PG_USER,
    password: process.env.TEST_PG_PASSWORD,
    database: process.env.TEST_PG_DATABASE,
  };
  const { Client, Pool } = require('pg');
  const admin = new Client(conn);
  await admin.connect();
  await admin.query(`CREATE SCHEMA ${SCHEMA}`);
  await admin.end();

  pool = new Pool({ ...conn, options: `-c search_path=${SCHEMA}`, max: 5 });
  // config/postgres.js is replaced: it checks out a client at start-up and never
  // releases it, which would keep the test process alive.
  stubModule('config/postgres.js', { pool });

  // The same migrations production runs, in order. email_verified comes from
  // 015_account_security.sql, which does a lot more than the leaderboard needs,
  // so only that column is added here.
  const run = (file) => pool.query(fs.readFileSync(path.join(root, 'migrations', file), 'utf8'));
  await run('001_create_users.sql');
  await pool.query(`ALTER TABLE users ADD COLUMN email_verified BOOLEAN NOT NULL DEFAULT FALSE`);
  await run('022_username_avatar.sql');
  await run('021_follows.sql');
  await run('018_nifty_predictions.sql');
  await run('019_user_streak_checkins.sql');
  await run('020_stock_of_the_day.sql');

  repo = require('../repositories/leaderboardRepository');
  controller = require('../controllers/leaderboardController');

  // The real router, mounted the way server.js mounts it. Login and the rate
  // limiter are stand-ins (they need Redis / real sessions): login just reads
  // the user id from a test header, and answers 401 without one.
  stubModule('middleware/auth.js', {
    protect: (req, res, next) => {
      const id = req.headers['x-test-user'];
      if (!id) return res.status(401).json({ code: 'UNAUTHORIZED' });
      req.user = { id };
      return next();
    },
  });
  stubModule('middleware/rateLimiter.js', { leaderboardLimiter: (req, res, next) => next() });

  const express = require('express');
  const app = express();
  app.use('/api/leaderboard', require('../routes/leaderboard'));
  server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  if (!HAVE_DB || !pool) return;
  await pool.query(`DROP SCHEMA ${SCHEMA} CASCADE`).catch(() => {});
  await pool.end().catch(() => {});
});

let counter = 0;
// A verified user with a chosen username, unless told otherwise. created_at is
// spaced one minute apart so "who joined first" is predictable.
async function makeUser({ verified = true, usernameSet = true, avatarId = null } = {}) {
  counter += 1;
  const r = await pool.query(
    `INSERT INTO users (full_name, username, email, password, email_verified, username_set, avatar_id, created_at)
     VALUES ($1, $2, $3, 'x', $4, $5, $6, NOW() - ($7 || ' minutes')::interval)
     RETURNING id`,
    [`Test User ${counter}`, `user${counter}`, `user${counter}@example.test`, verified, verified && usernameSet, avatarId, String(10000 - counter)],
  );
  return r.rows[0].id;
}

const follow = (a, b) => pool.query(`INSERT INTO follows (follower_id, following_id) VALUES ($1, $2)`, [a, b]);

// n distinct check-in days for a user
const checkIns = (userId, n) =>
  pool.query(
    `INSERT INTO user_streak_checkins (user_id, check_in_date)
     SELECT $1, DATE '2026-01-01' + g FROM generate_series(0, $2::int - 1) g`,
    [userId, n],
  );

const niftyCall = (userId, day, status) =>
  pool.query(
    `INSERT INTO nifty_predictions (user_id, trade_date, direction, baseline_price, status)
     VALUES ($1, $2, 'UP', 100, $3)`,
    [userId, day, status],
  );

// A stored Stock of the Day with `rounds` rounds whose winner is always "w<i>".
async function makeDay(playDate, rounds = 3) {
  const payload = {
    version: 2,
    dateKey: playDate,
    sector: 'Test',
    rounds: Array.from({ length: rounds }, (_, i) => ({ index: i, winnerKey: `w${i}` })),
  };
  await pool.query(`INSERT INTO stock_of_the_day (play_date, payload) VALUES ($1, $2::jsonb)`, [playDate, JSON.stringify(payload)]);
}
const answer = (userId, playDate, roundIndex, pickedKey) =>
  pool.query(
    `INSERT INTO stock_of_the_day_answers (user_id, play_date, round_index, picked_key) VALUES ($1, $2, $3, $4)`,
    [userId, playDate, roundIndex, pickedKey],
  );

const board = (viewerId, scope, limit = 100) => repo.getLeaderboard({ viewerId, scope, limit });
const ids = (rows) => rows.map((r) => r.id);

test('points = check-in days, correct rounds of finished days and Nifty wins, each with its weight', { skip }, async () => {
  const me = await makeUser();
  await checkIns(me, 4); // 4 * STREAK_DAY
  await makeDay('2026-03-01', 3);
  await answer(me, '2026-03-01', 0, 'w0'); // right
  await answer(me, '2026-03-01', 1, 'wrong'); // wrong
  await answer(me, '2026-03-01', 2, 'w2'); // right  → 2 correct
  await niftyCall(me, '2026-03-02', 'WON');
  await niftyCall(me, '2026-03-03', 'WON'); //          → 2 wins

  const rows = await board(me, 'global');
  const mine = rows.find((r) => r.id === me);
  assert.equal(mine.points, 4 * L.POINTS.STREAK_DAY + 2 * L.POINTS.STOCK_OF_THE_DAY + 2 * L.POINTS.NIFTY_WIN);
});

test('Nifty calls that are LOST, VOID or still PENDING earn nothing', { skip }, async () => {
  const me = await makeUser();
  await niftyCall(me, '2026-04-01', 'LOST');
  await niftyCall(me, '2026-04-02', 'VOID');
  await niftyCall(me, '2026-04-03', 'PENDING');
  const mine = (await board(me, 'global')).find((r) => r.id === me);
  assert.equal(mine.points, 0);
});

test('a half-played Stock of the Day earns nothing yet (points must not leak the answers)', { skip }, async () => {
  const me = await makeUser();
  await makeDay('2026-05-01', 3);
  await answer(me, '2026-05-01', 0, 'w0'); // correct, but the day is not finished
  await answer(me, '2026-05-01', 1, 'w1'); // correct, but the day is not finished
  assert.equal((await board(me, 'global')).find((r) => r.id === me).points, 0);

  await answer(me, '2026-05-01', 2, 'nope'); // day finished: 2 of 3 right
  assert.equal((await board(me, 'global')).find((r) => r.id === me).points, 2 * L.POINTS.STOCK_OF_THE_DAY);
});

test('global ranks everyone, most points first, ties go to whoever joined first', { skip }, async () => {
  const early = await makeUser(); // joined first
  const late = await makeUser();
  const top = await makeUser();
  await checkIns(top, 3);
  await checkIns(early, 1);
  await checkIns(late, 1); // same points as `early`

  const rows = await board(early, 'global');
  const order = ids(rows.filter((r) => [early, late, top].includes(r.id)));
  assert.deepEqual(order, [top, early, late]);
  // ranks are consecutive and `total` is the size of the whole table
  assert.deepEqual(rows.map((r) => r.rank), rows.map((_, i) => i + 1));
  assert.ok(rows.every((r) => r.total === rows.length));
});

test('unverified accounts are not on the board', { skip }, async () => {
  const me = await makeUser();
  const ghost = await makeUser({ verified: false });
  await checkIns(ghost, 5);
  assert.ok(!ids(await board(me, 'global')).includes(ghost));
});

test('friends = you + the people you follow, ranked against each other', { skip }, async () => {
  const me = await makeUser();
  const friend = await makeUser();
  const stranger = await makeUser();
  const followerOnly = await makeUser(); // follows me, I do not follow them
  await follow(me, friend);
  await follow(followerOnly, me);
  await checkIns(friend, 5);
  await checkIns(stranger, 50); // would top the global board
  await checkIns(followerOnly, 20);
  await checkIns(me, 2);

  const rows = await board(me, 'friends');
  assert.deepEqual(ids(rows), [friend, me]);
  assert.deepEqual(rows.map((r) => r.rank), [1, 2]); // rank among friends, not global
  assert.equal(rows[0].total, 2);
});

test('friends with nobody followed is just you at rank 1', { skip }, async () => {
  const me = await makeUser();
  const rows = await board(me, 'friends');
  assert.deepEqual(rows.map((r) => [r.id, r.rank, r.total]), [[me, 1, 1]]);
});

test('unfollowing takes someone off your friends board straight away', { skip }, async () => {
  const me = await makeUser();
  const friend = await makeUser();
  await follow(me, friend);
  assert.ok(ids(await board(me, 'friends')).includes(friend));
  await pool.query(`DELETE FROM follows WHERE follower_id = $1 AND following_id = $2`, [me, friend]);
  assert.ok(!ids(await board(me, 'friends')).includes(friend));
});

test('your own row comes back with your real rank even when you are below the cut', { skip }, async () => {
  const me = await makeUser(); // 0 points → joined before the others below
  const others = [];
  for (let i = 0; i < 4; i += 1) {
    const u = await makeUser();
    await checkIns(u, 3);
    others.push(u);
  }
  const rows = await board(me, 'friends'); // only me so far → sanity
  assert.equal(rows.length, 1);
  for (const u of others) await follow(me, u);

  const limited = await board(me, 'friends', 2);
  assert.equal(limited.length, 3); // top 2 + me
  assert.equal(limited[limited.length - 1].id, me);
  assert.equal(limited[limited.length - 1].rank, 5);
  assert.equal(limited[0].total, 5);

  const res = L.buildResponse('friends', limited, 2, me);
  assert.equal(res.entries.length, 2);
  assert.equal(res.me.rank, 5);
});

test('handle is the chosen username, and null until one is chosen', { skip }, async () => {
  const chosen = await makeUser();
  const notYet = await makeUser({ usernameSet: false });
  const rows = await board(chosen, 'global');
  const a = rows.find((r) => r.id === chosen);
  const b = rows.find((r) => r.id === notYet);
  assert.match(a.handle, /^user\d+$/);
  assert.equal(b.handle, null);
  assert.equal(b.full_name.startsWith('Test User'), true);
});

test('the avatar the person picked is returned', { skip }, async () => {
  const me = await makeUser({ avatarId: 'female_3' });
  assert.equal((await board(me, 'global')).find((r) => r.id === me).avatar_id, 'female_3');
});

test('deleting an account removes them from every board', { skip }, async () => {
  const me = await makeUser();
  const gone = await makeUser();
  await follow(me, gone);
  await checkIns(gone, 9);
  await pool.query(`DELETE FROM users WHERE id = $1`, [gone]);
  assert.ok(!ids(await board(me, 'friends')).includes(gone));
  assert.ok(!ids(await board(me, 'global')).includes(gone));
});

// ── the HTTP handler ────────────────────────────────────────────────────────

const call = async (user, query) => {
  const res = {
    statusCode: 200,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
  await controller.getLeaderboardHandler({ user: { id: user }, query }, res);
  return res;
};

test('handler: defaults to the friends board and returns the documented shape', { skip }, async () => {
  const me = await makeUser();
  const res = await call(me, {});
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.scope, 'friends');
  assert.equal(res.body.total, 1);
  assert.equal(res.body.entries[0].id, me);
  assert.equal(res.body.entries[0].isSelf, true);
  assert.equal(res.body.me.rank, 1);
});

test('handler: global scope, and a bad scope is a 400 not a 500', { skip }, async () => {
  const me = await makeUser();
  const ok = await call(me, { scope: 'global', limit: '5' });
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.body.scope, 'global');
  assert.ok(ok.body.entries.length <= 5);

  const bad = await call(me, { scope: 'worldwide' });
  assert.equal(bad.statusCode, 400);
  assert.equal(bad.body.entries, undefined);
});

// ── through the real router ─────────────────────────────────────────────────

const get = async (userId, query = '') => {
  const res = await fetch(`${baseUrl}/api/leaderboard${query}`, {
    headers: userId ? { 'x-test-user': userId } : {},
  });
  return { status: res.status, body: await res.json() };
};

test('GET /api/leaderboard needs a login', { skip }, async () => {
  const res = await get(null);
  assert.equal(res.status, 401);
});

test('GET /api/leaderboard?scope=global ranks people and marks you', { skip }, async () => {
  const me = await makeUser();
  const rival = await makeUser();
  await checkIns(rival, 200); // far ahead of anyone else in this schema (earlier tests top out at 50)
  await follow(me, rival);

  const global = await get(me, '?scope=global');
  assert.equal(global.status, 200);
  assert.equal(global.body.scope, 'global');
  assert.equal(global.body.entries[0].id, rival);
  assert.equal(global.body.entries[0].points, 200 * L.POINTS.STREAK_DAY);
  assert.equal(global.body.entries.filter((e) => e.isSelf).length <= 1, true);
  assert.equal(global.body.me.id, me);

  const friends = await get(me, '?scope=friends');
  assert.deepEqual(friends.body.entries.map((e) => e.id), [rival, me]);
  assert.equal(friends.body.me.rank, 2);
  assert.equal(friends.body.total, 2);
});

test('GET /api/leaderboard: a bad scope is a 400 over HTTP too', { skip }, async () => {
  const me = await makeUser();
  const res = await get(me, '?scope=everyone');
  assert.equal(res.status, 400);
  assert.equal(res.body.code, 'VALIDATION_ERROR');
});
