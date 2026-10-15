// Security review item 13 — duplicate-order protection (idempotency keys).
//
// Two kinds of test live here:
//   * unit tests (no database) — always run with `npm test`
//   * end-to-end tests against a REAL Postgres — run only when
//     TEST_DATABASE_URL is set, e.g.
//         TEST_DATABASE_URL=postgres://postgres@127.0.0.1:5432/stocksy_test npm test
//     They build a throw-away schema from the real migrations (so 017 is
//     exercised too) and drop it afterwards. Redis prices, the order queue and
//     the market calendar are replaced with in-memory fakes.
//
// The point of the DB tests is CONCURRENCY: a double tap sends two identical
// requests at the same instant, which only a real database can referee.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const express = require('express');

const root = path.join(__dirname, '..');
const resolve = (rel) => require.resolve(path.join(root, rel));
function stubLocal(rel, exportsObj) {
  const id = resolve(rel);
  require.cache[id] = { id, filename: id, loaded: true, exports: exportsObj, children: [], paths: [] };
}

// ═════════════════════════════════════════════════════════════════════════════
// Unit tests — no database
// ═════════════════════════════════════════════════════════════════════════════

const { readIdempotencyKey, fingerprintOrder } = require('../utils/idempotency');
const { ValidationError, mapErrorToResponse, IdempotencyConflictError } = require('../utils/errors');
const reqWith = (headers) => ({ get: (n) => headers[n] });

test('item 13: key is read from Idempotency-Key or X-Idempotency-Key', () => {
  const k = '3f1c2d4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f';
  assert.equal(readIdempotencyKey(reqWith({ 'Idempotency-Key': k }), {}), k);
  assert.equal(readIdempotencyKey(reqWith({ 'X-Idempotency-Key': k }), {}), k);
  assert.equal(readIdempotencyKey(reqWith({ 'X-Idempotency-Key': `  ${k} ` }), {}), k, 'trimmed');
});

test('item 13: no key is allowed by default, required when REQUIRE_IDEMPOTENCY_KEY=true', () => {
  assert.equal(readIdempotencyKey(reqWith({}), {}), null);
  assert.equal(readIdempotencyKey(reqWith({ 'X-Idempotency-Key': '' }), {}), null);
  assert.throws(
    () => readIdempotencyKey(reqWith({}), { REQUIRE_IDEMPOTENCY_KEY: 'true' }),
    ValidationError,
  );
});

test('item 13: malformed keys are rejected', () => {
  for (const bad of ['short', 'x'.repeat(81), 'has space in it', 'semi;colon;key', '../../etc/passwd', 'emoji-🙂-key-123', "quote'quote'quote"]) {
    assert.throws(() => readIdempotencyKey(reqWith({ 'X-Idempotency-Key': bad }), {}), ValidationError, bad);
  }
});

test('item 13: fingerprint ignores number formatting, name and metadata but not real fields', () => {
  const base = { instrument_key: 'NSE_EQ|X', symbol: 'X', order_type: 'LIMIT', side: 'BUY', quantity: 10, price: 100, product_type: 'CNC' };
  const h = fingerprintOrder('w1', base);
  assert.equal(fingerprintOrder('w1', { ...base, quantity: '10', price: '100.00' }), h, 'string numbers');
  assert.equal(fingerprintOrder('w1', { ...base, name: 'Other name', metadata: { a: 1 } }), h, 'cosmetic fields');
  const { product_type, ...noProduct } = base;
  assert.equal(fingerprintOrder('w1', noProduct), h, 'product_type defaults to CNC');
  for (const change of [{ quantity: 11 }, { price: 101 }, { side: 'SELL' }, { symbol: 'Y' }, { order_type: 'MARKET' }, { product_type: 'MIS' }, { trigger_price: 99 }]) {
    assert.notEqual(fingerprintOrder('w1', { ...base, ...change }), h, JSON.stringify(change));
  }
  assert.notEqual(fingerprintOrder('w2', base), h, 'different wallet');
});

test('item 13: for MARKET orders the live price at tap time is NOT part of the order', () => {
  const m = { instrument_key: 'NSE_EQ|X', symbol: 'X', order_type: 'MARKET', side: 'BUY', quantity: 10, product_type: 'CNC' };
  // the client sends the current LTP as `price`; it ticks between a tap and its retry
  assert.equal(fingerprintOrder('w1', { ...m, price: 2500.10 }), fingerprintOrder('w1', { ...m, price: 2500.35 }));
  assert.equal(fingerprintOrder('w1', { ...m, price: 2500.10 }), fingerprintOrder('w1', m));
  assert.notEqual(fingerprintOrder('w1', { ...m, quantity: 11 }), fingerprintOrder('w1', m), 'quantity still matters');
  // SL_M: trigger price is the order; the (ignored) price is not
  const sl = { ...m, order_type: 'SL_M', trigger_price: 99 };
  assert.equal(fingerprintOrder('w1', { ...sl, price: 1 }), fingerprintOrder('w1', { ...sl, price: 2 }));
  assert.notEqual(fingerprintOrder('w1', { ...sl, trigger_price: 98 }), fingerprintOrder('w1', sl));
});

test('item 13: a reused key maps to 422 IDEMPOTENCY_KEY_REUSED', () => {
  const { status, body } = mapErrorToResponse(new IdempotencyConflictError());
  assert.equal(status, 422);
  assert.equal(body.code, 'IDEMPOTENCY_KEY_REUSED');
});

test('item 13: migration 017 adds the columns and the partial unique index', () => {
  const sql = fs.readFileSync(path.join(root, 'migrations', '017_order_idempotency.sql'), 'utf8');
  assert.match(sql, /ADD COLUMN IF NOT EXISTS idempotency_key/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS request_hash/);
  assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS uq_orders_user_idempotency[\s\S]*\(user_id, idempotency_key\)[\s\S]*WHERE idempotency_key IS NOT NULL/);
});

test('item 13: server-generated orders (square-off, RMS, alerts) are unaffected', () => {
  // They call placeOrder(user, wallet, payload) with no 4th argument.
  const src = fs.readFileSync(path.join(root, 'services', 'orderService.js'), 'utf8');
  assert.match(src, /placeOrder\(userId, walletId, payload, \{ idempotencyKey = null, onReplay \} = \{\}\)/);
});

// ═════════════════════════════════════════════════════════════════════════════
// End-to-end tests — real Postgres
// ═════════════════════════════════════════════════════════════════════════════

const DB_URL = process.env.TEST_DATABASE_URL;
const SCHEMA = `idem_${crypto.randomBytes(4).toString('hex')}`;
const dbTest = DB_URL ? test : (name) => test(`${name} (skipped: set TEST_DATABASE_URL)`, { skip: true }, () => {});

let pool = null;
let placeOrder, cancelOrder, createOrder, getOrdersViaController;
const queueAdds = [];
const logLines = [];
const market = { open: true };

if (DB_URL) {
  const { Pool } = require('pg');
  pool = new Pool({ connectionString: DB_URL, max: 12, options: `-c search_path=${SCHEMA},public` });

  stubLocal('config/postgres.js', { pool });
  stubLocal('services/redisService.js', {
    get: async () => JSON.stringify({ ltpc: { ltp: 100 } }), // every stock trades at 100
  });
  stubLocal('services/queueService.js', {
    getQueue: () => ({ add: async (name, data, opts) => { queueAdds.push({ name, data, opts }); } }),
  });
  stubLocal('services/marketCalendarService.js', {
    isMarketOpen: () => market.open,
    getClosedReason: () => ({ type: 'WEEKEND', label: 'Weekend' }),
    getNextMarketOpen: () => ({ isoDate: '2030-01-07', time: '09:15', iso: '', dateLabel: 'Mon', timeLabel: '9:15 AM' }),
  });

  process.env.DISABLE_SLIPPAGE = 'true';
  // Record which idempotency layer answered, so tests can prove each one works.
  const logger = require('../utils/logger');
  const realInfo = logger.info.bind(logger);
  logger.info = (msg, ...rest) => { logLines.push(String(msg)); return realInfo(msg, ...rest); };
  ({ placeOrder, cancelOrder } = require('../services/orderService'));
  ({ createOrder } = require('../controllers/orderController'));

  // The app logs emoji/box characters; keep the TAP output clean.
  console.log = () => {};
  console.error = () => {};
  console.warn = () => {};
}

async function makeUserAndWallet(balance = 100000) {
  const email = `${crypto.randomBytes(6).toString('hex')}@example.com`;
  const u = await pool.query(
    `INSERT INTO users (full_name, username, email, password) VALUES ('T', 't', $1, 'x') RETURNING id`,
    [email],
  );
  const w = await pool.query(
    `INSERT INTO wallets (user_id, name, balance, initial_balance) VALUES ($1, 'W', $2, $2) RETURNING id`,
    [u.rows[0].id, balance],
  );
  return { userId: u.rows[0].id, walletId: w.rows[0].id };
}

const order = (over = {}) => ({
  instrument_key: 'NSE_EQ|INE002A01018',
  symbol: 'RELIANCE',
  order_type: 'LIMIT',
  side: 'BUY',
  quantity: 10,
  price: 100,
  product_type: 'CNC',
  ...over,
});
const newKey = () => crypto.randomUUID();
const balanceOf = async (walletId) =>
  parseFloat((await pool.query('SELECT balance FROM wallets WHERE id=$1', [walletId])).rows[0].balance);
const countOrders = async (userId) =>
  (await pool.query('SELECT count(*)::int AS n FROM orders WHERE user_id=$1', [userId])).rows[0].n;

if (DB_URL) {
  test.before(async () => {
    const admin = new (require('pg').Pool)({ connectionString: DB_URL, max: 1 });
    await admin.query(`CREATE SCHEMA ${SCHEMA}`);
    await admin.query(`SET search_path = ${SCHEMA}, public`);
    // 005 is skipped: it only redefines a reporting view and does not apply
    // cleanly on a schema built from scratch (pre-existing, unrelated).
    for (const f of [
      '001_oms_schema', '002_add_product_type', '003_account_transactions', '004_account_deletion',
      '006_alert', '007_gtt_orders', '008_platform_revenue', '009_platform_revenue_full_charges',
      '010_wallet_tx_direction', '011_trade_journal', '012_stop_loss_position_link',
      '014_auth_sessions', '015_account_security', '017_order_idempotency',
    ]) {
      const sql = fs.readFileSync(path.join(root, 'migrations', `${f}.sql`), 'utf8');
      const c = await admin.connect();
      try { await c.query(`SET search_path = ${SCHEMA}, public`); await c.query(sql); }
      finally { c.release(); }
    }
    await admin.end();

    // Open every connection up front. With a cold pool the first request
    // finishes before the others have even connected, which would make the
    // "concurrent" tests below sequential.
    await Promise.all(Array.from({ length: 12 }, () => pool.query('SELECT pg_sleep(0.05)')));
  });

  test.after(async () => {
    await pool.end();
    const admin = new (require('pg').Pool)({ connectionString: DB_URL, max: 1 });
    await admin.query(`DROP SCHEMA ${SCHEMA} CASCADE`);
    await admin.end();
  });
}

dbTest('item 13: the same key twice places ONE order and reserves margin ONCE', async () => {
  const { userId, walletId } = await makeUserAndWallet();
  const key = newKey();
  const before = queueAdds.length;

  let replays = 0;
  const first = await placeOrder(userId, walletId, order(), { idempotencyKey: key, onReplay: () => replays++ });
  const balanceAfterFirst = await balanceOf(walletId);
  const second = await placeOrder(userId, walletId, order(), { idempotencyKey: key, onReplay: () => replays++ });

  assert.equal(second.id, first.id, 'same order returned');
  assert.equal(replays, 1, 'second call flagged as a replay, first was not');
  assert.equal(await countOrders(userId), 1);
  assert.equal(await balanceOf(walletId), balanceAfterFirst, 'no second margin reservation');
  assert.ok(balanceAfterFirst < 100000, 'first call really did reserve margin');
  assert.equal(queueAdds.length - before, 1, 'queued for fill once');
});

dbTest('item 13: a double tap — 10 identical requests at the same instant — places exactly ONE order', async () => {
  const { userId, walletId } = await makeUserAndWallet();
  const key = newKey();
  const before = queueAdds.length;
  const innerBefore = lines('idempotent, concurrent') + lines('unique-index');

  const results = await Promise.all(
    Array.from({ length: 10 }, () => placeOrder(userId, walletId, order(), { idempotencyKey: key })),
  );

  assert.equal(new Set(results.map((o) => o.id)).size, 1, 'all ten got the same order back');
  // With a warm pool the duplicates really do overlap, so most are answered by
  // the inner layers, not the cheap early check (that would mean no concurrency).
  const inner = lines('idempotent, concurrent') + lines('unique-index') - innerBefore;
  assert.ok(inner >= 1, `expected overlap to reach the inner layers (got ${inner})`);
  assert.equal(await countOrders(userId), 1, 'only one row in the database');
  const events = await pool.query(`SELECT count(*)::int n FROM order_events WHERE order_id=$1 AND event='PLACED'`, [results[0].id]);
  assert.equal(events.rows[0].n, 1);
  assert.equal(queueAdds.length - before, 1, 'queued once');

  const tx = await pool.query(`SELECT count(*)::int n FROM wallet_transactions WHERE wallet_id=$1 AND type='order_reserve'`, [walletId]);
  assert.equal(tx.rows[0].n, 1, 'margin reserved exactly once');
  const bal = await balanceOf(walletId);
  assert.ok(bal > 98000 && bal < 100000, `balance debited once (was ${bal})`);
});

dbTest('item 13: same key but a DIFFERENT order is refused, nothing is placed or charged', async () => {
  const { userId, walletId } = await makeUserAndWallet();
  const key = newKey();
  await placeOrder(userId, walletId, order({ quantity: 10 }), { idempotencyKey: key });
  const bal = await balanceOf(walletId);

  await assert.rejects(
    placeOrder(userId, walletId, order({ quantity: 500 }), { idempotencyKey: key }),
    IdempotencyConflictError,
  );
  assert.equal(await countOrders(userId), 1);
  assert.equal(await balanceOf(walletId), bal);
});

dbTest('item 13: different keys = different intents: two identical orders ARE both placed', async () => {
  const { userId, walletId } = await makeUserAndWallet();
  await placeOrder(userId, walletId, order(), { idempotencyKey: newKey() });
  await placeOrder(userId, walletId, order(), { idempotencyKey: newKey() });
  assert.equal(await countOrders(userId), 2);
});

dbTest('item 13: a MARKET retry whose live price ticked in the meantime is still the same order', async () => {
  const { userId, walletId } = await makeUserAndWallet();
  const key = newKey();
  const market$ = (price) => order({ order_type: 'MARKET', price });
  const first = await placeOrder(userId, walletId, market$(100.0), { idempotencyKey: key });
  let replayed = false;
  const retry = await placeOrder(userId, walletId, market$(100.4), { idempotencyKey: key, onReplay: () => { replayed = true; } });
  assert.equal(retry.id, first.id);
  assert.equal(replayed, true);
  assert.equal(await countOrders(userId), 1);
});

dbTest('item 13: no key = old behaviour (older app builds keep working)', async () => {
  const { userId, walletId } = await makeUserAndWallet();
  await placeOrder(userId, walletId, order());
  await placeOrder(userId, walletId, order());
  assert.equal(await countOrders(userId), 2);
  const rows = await pool.query('SELECT idempotency_key, request_hash FROM orders WHERE user_id=$1', [userId]);
  assert.ok(rows.rows.every((r) => r.idempotency_key === null && r.request_hash === null));
});

dbTest('item 13: keys are scoped per user — another user can use the same key', async () => {
  const a = await makeUserAndWallet();
  const b = await makeUserAndWallet();
  const key = newKey();
  const oa = await placeOrder(a.userId, a.walletId, order(), { idempotencyKey: key });
  const ob = await placeOrder(b.userId, b.walletId, order(), { idempotencyKey: key });
  assert.notEqual(oa.id, ob.id);
  assert.equal(ob.user_id, b.userId);
});

dbTest('item 13: a retry after the market closes gets the original order, not "market closed"', async () => {
  const { userId, walletId } = await makeUserAndWallet();
  const key = newKey();
  const first = await placeOrder(userId, walletId, order(), { idempotencyKey: key });

  market.open = false;
  try {
    const retry = await placeOrder(userId, walletId, order(), { idempotencyKey: key });
    assert.equal(retry.id, first.id);
    // ...while a genuinely NEW order is still refused
    await assert.rejects(placeOrder(userId, walletId, order(), { idempotencyKey: newKey() }), /closed/i);
  } finally { market.open = true; }
});

dbTest('item 13: a rejected attempt leaves nothing behind, so the same key can be retried', async () => {
  const { userId, walletId } = await makeUserAndWallet(50); // far too little
  const key = newKey();
  await assert.rejects(placeOrder(userId, walletId, order(), { idempotencyKey: key }), /Insufficient funds/);
  assert.equal(await countOrders(userId), 0, 'rejected order was not stored under the key');

  await pool.query('UPDATE wallets SET balance = 100000 WHERE id=$1', [walletId]);
  const ok = await placeOrder(userId, walletId, order(), { idempotencyKey: key });
  assert.ok(ok.id);
});

dbTest('item 13: the unique index is the backstop — duplicate (user,key) is impossible, NULLs are fine', async () => {
  const { userId, walletId } = await makeUserAndWallet();
  const insert = (key) => pool.query(
    `INSERT INTO orders (user_id, wallet_id, instrument_key, symbol, order_type, side, quantity, product_type, idempotency_key)
     VALUES ($1,$2,'k','S','MARKET','BUY',1,'CNC',$3)`, [userId, walletId, key]);
  await insert('dup-key-12345');
  await assert.rejects(insert('dup-key-12345'), (e) => e.code === '23505' && e.constraint === 'uq_orders_user_idempotency');
  await insert(null);
  await insert(null); // many orders without a key are fine
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const lines = (needle) => logLines.filter((l) => l.includes(needle)).length;

// A row exactly as a first, successful request would have left it.
async function insertCommittedOrder(db, { userId, walletId, key, hash }) {
  const r = await db.query(
    `INSERT INTO orders (user_id, wallet_id, instrument_key, symbol, order_type, side, quantity, price, product_type, status, idempotency_key, request_hash)
     VALUES ($1,$2,'NSE_EQ|INE002A01018','RELIANCE','LIMIT','BUY',10,100,'CNC','PENDING',$3,$4) RETURNING id`,
    [userId, walletId, key, hash],
  );
  return r.rows[0].id;
}

dbTest('item 13 (layer 2): a duplicate that is waiting on the wallet lock is answered from the winner\'s order', async () => {
  const { userId, walletId } = await makeUserAndWallet();
  const key = newKey();
  const hash = fingerprintOrder(walletId, order());
  const before = lines('idempotent, concurrent');

  // Play "request #1": take the wallet lock and hold it.
  const first = await pool.connect();
  await first.query('BEGIN');
  await first.query('SELECT id FROM wallets WHERE id=$1 FOR UPDATE', [walletId]);

  // Request #2 passes the early check (no order exists yet) and blocks on the lock.
  let replays = 0;
  const second = placeOrder(userId, walletId, order(), { idempotencyKey: key, onReplay: () => replays++ });
  await sleep(300);

  // Request #1 now places its order and commits, releasing the lock.
  const winnerId = await insertCommittedOrder(first, { userId, walletId, key, hash });
  await first.query('COMMIT');
  first.release();

  const res = await second;
  assert.equal(res.id, winnerId, 'got the winner\'s order');
  assert.equal(replays, 1);
  assert.equal(lines('idempotent, concurrent') - before, 1, 'answered by the under-lock re-check');
  assert.equal(await countOrders(userId), 1);
  assert.equal(await balanceOf(walletId), 100000, 'loser reserved nothing');
});

dbTest('item 13 (layer 3): the unique index stops a duplicate that slipped past both checks, and undoes its margin reservation', async () => {
  // Same key on two different wallets of one user: the wallet lock cannot
  // serialise these, so both pass the early check AND the under-lock check.
  // Only the unique index stands between them. (On the SAME wallet the lock
  // always makes layer 2 answer first, which is why this needs two wallets.)
  const { userId, walletId: walletA } = await makeUserAndWallet();
  const walletB = (await pool.query(
    `INSERT INTO wallets (user_id, name, balance, initial_balance) VALUES ($1,'B',100000,100000) RETURNING id`, [userId],
  )).rows[0].id;
  const key = newKey();

  // "Request #1" (wallet A) has inserted its order but not committed: invisible to #2.
  const first = await pool.connect();
  await first.query('BEGIN');
  await insertCommittedOrder(first, { userId, walletId: walletA, key, hash: fingerprintOrder(walletA, order()) });

  // #2 (wallet B) reserves margin, then blocks inside INSERT on the unique index.
  const second = placeOrder(userId, walletB, order(), { idempotencyKey: key });
  const settled = second.then(() => null, (e) => e); // attach handler before it can reject
  await sleep(300);
  await first.query('COMMIT'); // #2's INSERT now fails with a unique violation
  first.release();

  const err = await settled;
  assert.ok(err instanceof IdempotencyConflictError, `expected a clean 422-type conflict, got: ${err && err.message}`);
  assert.equal(await countOrders(userId), 1, 'only the winner exists');
  assert.equal(await balanceOf(walletB), 100000, 'the loser\'s margin reservation was rolled back');
  const tx = await pool.query(`SELECT count(*)::int n FROM wallet_transactions WHERE wallet_id=$1`, [walletB]);
  assert.equal(tx.rows[0].n, 0, 'no ledger entry survived');
});

dbTest('item 13: cancelling twice is a success the second time and refunds only once', async () => {
  const { userId, walletId } = await makeUserAndWallet();
  const placed = await placeOrder(userId, walletId, order(), { idempotencyKey: newKey() });
  const reserved = await balanceOf(walletId);

  const c1 = await cancelOrder(userId, placed.id);
  const afterFirst = await balanceOf(walletId);
  const c2 = await cancelOrder(userId, placed.id);

  assert.equal(c1.success, true);
  assert.equal(c1.alreadyCancelled, undefined);
  assert.deepEqual({ success: c2.success, already: c2.alreadyCancelled }, { success: true, already: true });
  assert.ok(afterFirst > reserved, 'first cancel released the margin');
  assert.equal(await balanceOf(walletId), afterFirst, 'second cancel released nothing more');
  assert.equal(afterFirst, 100000);
});

dbTest('item 13: cancel still refuses orders that are genuinely not cancellable', async () => {
  const { userId, walletId } = await makeUserAndWallet();
  const placed = await placeOrder(userId, walletId, order(), { idempotencyKey: newKey() });
  await pool.query(`UPDATE orders SET status='FILLED' WHERE id=$1`, [placed.id]);
  await assert.rejects(cancelOrder(userId, placed.id), /Cannot cancel order with status FILLED/);
});

// ── through the real HTTP controller ─────────────────────────────────────────
async function withController(userId, env, fn) {
  const saved = process.env.REQUIRE_IDEMPOTENCY_KEY;
  if (env.REQUIRE_IDEMPOTENCY_KEY === undefined) delete process.env.REQUIRE_IDEMPOTENCY_KEY;
  else process.env.REQUIRE_IDEMPOTENCY_KEY = env.REQUIRE_IDEMPOTENCY_KEY;

  const app = express();
  app.use(express.json());
  app.use((req, res, next) => { req.user = { id: userId }; next(); });
  app.post('/api/orders', createOrder);
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  const post = (body, headers = {}) =>
    fetch(`http://127.0.0.1:${port}/api/orders`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
    });
  try { return await fn(post); }
  finally {
    await new Promise((r) => server.close(r));
    if (saved === undefined) delete process.env.REQUIRE_IDEMPOTENCY_KEY; else process.env.REQUIRE_IDEMPOTENCY_KEY = saved;
  }
}

dbTest('item 13 (HTTP): retry returns 201 + same order + Idempotent-Replayed, and hides internal fields', async () => {
  const { userId, walletId } = await makeUserAndWallet();
  const body = { wallet_id: walletId, ...order() };
  const key = newKey();

  await withController(userId, {}, async (post) => {
    const r1 = await post(body, { 'X-Idempotency-Key': key });
    const j1 = await r1.json();
    const r2 = await post(body, { 'X-Idempotency-Key': key });
    const j2 = await r2.json();

    assert.equal(r1.status, 201);
    assert.equal(r2.status, 201);
    assert.equal(r1.headers.get('idempotent-replayed'), null);
    assert.equal(r2.headers.get('idempotent-replayed'), 'true');
    assert.equal(j2.order.id, j1.order.id);
    for (const j of [j1, j2]) {
      assert.ok(!('idempotency_key' in j.order) && !('request_hash' in j.order), 'internal fields not exposed');
    }
    assert.equal(await countOrders(userId), 1);
  });
});

dbTest('item 13 (HTTP): key reuse for another order -> 422 IDEMPOTENCY_KEY_REUSED', async () => {
  const { userId, walletId } = await makeUserAndWallet();
  const key = newKey();
  await withController(userId, {}, async (post) => {
    await post({ wallet_id: walletId, ...order({ quantity: 5 }) }, { 'Idempotency-Key': key });
    const r = await post({ wallet_id: walletId, ...order({ quantity: 50 }) }, { 'Idempotency-Key': key });
    assert.equal(r.status, 422);
    assert.equal((await r.json()).code, 'IDEMPOTENCY_KEY_REUSED');
    assert.equal(await countOrders(userId), 1);
  });
});

dbTest('item 13 (HTTP): malformed key -> 400; missing key OK unless REQUIRE_IDEMPOTENCY_KEY=true', async () => {
  const { userId, walletId } = await makeUserAndWallet();
  const body = { wallet_id: walletId, ...order() };

  await withController(userId, {}, async (post) => {
    assert.equal((await post(body, { 'Idempotency-Key': 'bad key!' })).status, 400);
    assert.equal((await post(body)).status, 201, 'no header still works while not enforced');
  });
  await withController(userId, { REQUIRE_IDEMPOTENCY_KEY: 'true' }, async (post) => {
    const r = await post(body);
    assert.equal(r.status, 400);
    assert.equal((await r.json()).code, 'VALIDATION_ERROR');
    assert.equal((await post(body, { 'Idempotency-Key': newKey() })).status, 201);
  });
});
