// Security regression tests for "step 3" (account + password flows):
//   item 7  — email verification, lower-cased emails, safe Google linking
//   item 8  — password-reset / verification codes
//   item 12 — password policy, constant-work login, per-account lockout
//
// Two kinds of test live here:
//   * unit tests (no database) — always run with `npm test`
//   * end-to-end tests against a REAL Postgres — run only when
//     TEST_DATABASE_URL is set, e.g.
//         TEST_DATABASE_URL=postgres://postgres@127.0.0.1:5432/stocksy_test npm test
//     They build their own throw-away schema from migrations/001, 014 and 015
//     (so the migrations are exercised too) and drop it afterwards.
//     Redis, e-mail and Google are replaced with in-memory fakes.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const express = require('express');
const bcrypt = require('bcryptjs');

const root = path.join(__dirname, '..');
const resolve = (rel) => require.resolve(path.join(root, rel));

function stubModule(id, exportsObj) {
  require.cache[id] = { id, filename: id, loaded: true, exports: exportsObj, children: [], paths: [] };
}
const stubLocal = (rel, exportsObj) => stubModule(resolve(rel), exportsObj);

process.env.JWT_SECRET = 'test-jwt-secret-for-account-security-tests';
process.env.BCRYPT_COST = '4'; // fast hashing in tests; one test checks the real default
delete process.env.OTP_PEPPER;

// ── fakes ────────────────────────────────────────────────────────────────────
// Just enough of the redis client for services/loginThrottle.js.
function makeFakeRedis() {
  const store = new Map(); // key -> { value, expiresAt }
  const live = (key) => {
    const entry = store.get(key);
    if (!entry) return null;
    if (entry.expiresAt && entry.expiresAt <= Date.now()) {
      store.delete(key);
      return null;
    }
    return entry;
  };
  return {
    failing: false,
    reset() { store.clear(); this.failing = false; },
    _check() { if (this.failing) throw new Error('redis is down'); },
    async ttl(key) {
      this._check();
      const e = live(key);
      if (!e) return -2;
      return e.expiresAt ? Math.ceil((e.expiresAt - Date.now()) / 1000) : -1;
    },
    async incr(key) {
      this._check();
      const e = live(key);
      const value = (e ? e.value : 0) + 1;
      store.set(key, { value, expiresAt: e ? e.expiresAt : null });
      return value;
    },
    async expire(key, seconds) {
      this._check();
      const e = live(key);
      if (e) e.expiresAt = Date.now() + seconds * 1000;
      return e ? 1 : 0;
    },
    async set(key, value, opts = {}) {
      this._check();
      store.set(key, { value, expiresAt: opts.EX ? Date.now() + opts.EX * 1000 : null });
      return 'OK';
    },
    async del(keys) {
      this._check();
      for (const k of [].concat(keys)) store.delete(k);
    },
  };
}
const fakeRedis = makeFakeRedis();
stubLocal('config/redis.js', { client: fakeRedis, connectRedis() {} });

// no rate limiting here — it is tested on its own; we want to hit the account logic
const passThrough = (_req, _res, next) => next();
stubLocal('middleware/rateLimiter.js', {
  generalLimiter: passThrough, authLimiter: passThrough, otpLimiter: passThrough, orderLimiter: passThrough,
});

// every e-mail the app "sends" lands here instead
const sent = [];
stubLocal('utils/sendForgotPasswordEmail.js', async (m) => { sent.push({ kind: 'reset', ...m }); });
stubLocal('utils/sendVerificationEmail.js', async (m) => { sent.push({ kind: 'verify', ...m }); });

// Google: the "ID token" is just base64(JSON payload)
stubModule(require.resolve('google-auth-library'), {
  OAuth2Client: class {
    async verifyIdToken({ idToken }) {
      const payload = JSON.parse(Buffer.from(idToken, 'base64').toString('utf8'));
      return { getPayload: () => payload };
    }
  },
});
const googleToken = (payload) => Buffer.from(JSON.stringify(payload)).toString('base64');

// ── database (only when TEST_DATABASE_URL is set) ────────────────────────────
const DB_URL = process.env.TEST_DATABASE_URL;
const SCHEMA = `acct_sec_${crypto.randomBytes(4).toString('hex')}`;
let pool = null;
if (DB_URL) {
  const { Pool } = require('pg');
  pool = new Pool({ connectionString: DB_URL, max: 6, options: `-c search_path=${SCHEMA}` });
  stubLocal('config/postgres.js', { pool });
}
const dbTest = DB_URL ? test : (name) => test(`${name} (skipped: set TEST_DATABASE_URL)`, { skip: true }, () => {});

// The controllers log progress lines with emoji and box-drawing characters.
// Under `node --test` that output can trip a Node test-runner reporting bug
// ("Unable to deserialize cloned data"), and it buries the results anyway, so
// the end-to-end tests run with app logging off.
const realConsole = { log: console.log, error: console.error, warn: console.warn };
if (DB_URL) {
  console.log = () => {};
  console.error = () => {};
  console.warn = () => {};
}

// ═════════════════════════════════════════════════════════════════════════════
// Unit tests — no database
// ═════════════════════════════════════════════════════════════════════════════

test('item 7: normalizeEmail trims, lower-cases and rejects junk', () => {
  const { normalizeEmail } = require('../utils/email');
  assert.equal(normalizeEmail('  A@X.com '), 'a@x.com');
  assert.equal(normalizeEmail('Mixed.Case@Example.COM'), 'mixed.case@example.com');
  for (const bad of [undefined, null, 42, {}, [], '', ' ', 'nope', 'a@b', 'a b@c.com', '@x.com', 'x'.repeat(200) + '@x.com']) {
    assert.equal(normalizeEmail(bad), null, JSON.stringify(bad));
  }
});

test('item 12: password policy rejects short, common, personal and oversized passwords', () => {
  const { validatePassword } = require('../utils/password');
  const ctx = { email: 'johnsmith@example.com', fullName: 'John Smith' };

  for (const bad of ['short', '1234567', 'password', 'Password', 'PASSWORD123', '12345678', 'qwertyuiop', 'aaaaaaaaaa',
    'johnsmith', 'JohnSmith', 'john', 'johnsmith@example.com', 'John Smith', 'x'.repeat(73), 'é'.repeat(37)]) {
    assert.equal(validatePassword(bad, ctx).ok, false, `should reject ${bad.slice(0, 20)}`);
  }
  assert.equal(validatePassword(undefined, ctx).ok, false);
  assert.equal(validatePassword(12345678, ctx).ok, false);

  // 'é' is 2 bytes in UTF-8: 18 + 18 = exactly 72 bytes, the most bcrypt can use
  for (const good of ['correct horse battery', 'Tr0ub4dor&3x', 'a-long-passphrase-with-words', 'é'.repeat(18) + 'ü'.repeat(18), 'mN8!qLz2']) {
    assert.equal(validatePassword(good, ctx).ok, true, `should accept ${good.slice(0, 20)}`);
  }
  // no forced "capital + symbol" rules: a long lower-case passphrase is fine
  assert.equal(validatePassword('purple elephants dance quietly', ctx).ok, true);
});

test('item 12: bcrypt cost defaults to 12 and old hashes are flagged for upgrade', async () => {
  const saved = process.env.BCRYPT_COST;
  delete process.env.BCRYPT_COST;
  try {
    const { hashPassword, needsRehash, isBcryptHash } = require('../utils/password');
    const hash = await hashPassword('some password 1');
    assert.equal(bcrypt.getRounds(hash), 12);
    assert.equal(needsRehash(hash), false);
    assert.equal(needsRehash(await bcrypt.hash('x', 10)), true);
    assert.equal(needsRehash(''), false);
    assert.equal(isBcryptHash(hash), true);
    assert.equal(isBcryptHash(''), false);
    assert.equal(isBcryptHash('plaintext'), false);
  } finally { process.env.BCRYPT_COST = saved; }
});

test('item 8: codes are 6 digits from a CSPRNG, not Math.random', () => {
  const src = fs.readFileSync(path.join(root, 'services', 'otpService.js'), 'utf8');
  assert.ok(src.includes('crypto.randomInt'));
  assert.ok(!/Math\.random/.test(src));
  const forgot = fs.readFileSync(path.join(root, 'controllers', 'forgotPasswordController.js'), 'utf8');
  assert.ok(!/Math\.random/.test(forgot));
  assert.ok(!/\botp\s*=\s*\$1|SET otp/.test(forgot), 'no more plain-text otp column');
});

test('item 8: no controller answers "no account found" / "user not found"', () => {
  for (const f of ['controllers/forgotPasswordController.js', 'controllers/auth.js']) {
    const src = fs.readFileSync(path.join(root, f), 'utf8');
    assert.ok(!/USER_NOT_FOUND|No account found|User not found/.test(src), f);
  }
});

test('item 8: the e-mail template escapes the name (no HTML injection through signup)', () => {
  const { verifyEmailTemplate, forgotPasswordTemplate } = require('../utils/emailTemplates');
  const evil = '<a href="https://evil.example">click</a>';
  for (const html of [verifyEmailTemplate(evil, '123456'), forgotPasswordTemplate(evil, '123456')]) {
    assert.ok(!html.includes(evil));
    assert.ok(html.includes('&lt;a href=&quot;https://evil.example&quot;&gt;'));
    assert.ok(html.includes('123456'));
  }
});

test('item 12: login lockout counts, locks, expires and clears (fake redis)', async () => {
  fakeRedis.reset();
  const saved = { m: process.env.LOGIN_MAX_FAILURES, s: process.env.LOGIN_LOCK_SECONDS };
  process.env.LOGIN_MAX_FAILURES = '3';
  process.env.LOGIN_LOCK_SECONDS = '1';
  try {
    const t = require('../services/loginThrottle');
    assert.deepEqual(await t.check('a@x.com'), { locked: false });
    assert.equal(await t.recordFailure('a@x.com'), false);
    assert.equal(await t.recordFailure('a@x.com'), false);
    assert.equal(await t.recordFailure('a@x.com'), true);
    const state = await t.check('a@x.com');
    assert.equal(state.locked, true);
    assert.ok(state.retryAfterSeconds >= 1 && state.retryAfterSeconds <= 1);
    assert.deepEqual(await t.check('b@x.com'), { locked: false }, 'other accounts unaffected');
    // does not extend while locked: still expires after ~1s
    await new Promise((r) => setTimeout(r, 1100));
    assert.deepEqual(await t.check('a@x.com'), { locked: false });
    // clear() forgets failures
    await t.recordFailure('c@x.com'); await t.recordFailure('c@x.com');
    await t.clear('c@x.com');
    assert.equal(await t.recordFailure('c@x.com'), false);
  } finally {
    for (const [k, v] of [['LOGIN_MAX_FAILURES', saved.m], ['LOGIN_LOCK_SECONDS', saved.s]]) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
});

test('item 12: lockout still works (in memory) when Redis is down', async () => {
  fakeRedis.reset();
  fakeRedis.failing = true;
  try {
    const t = require('../services/loginThrottle');
    for (let i = 0; i < 4; i++) assert.equal(await t.recordFailure('down@x.com'), false);
    assert.equal(await t.recordFailure('down@x.com'), true);
    assert.equal((await t.check('down@x.com')).locked, true);
    await t.clear('down@x.com');
    assert.equal((await t.check('down@x.com')).locked, false);
  } finally { fakeRedis.reset(); }
});

test('migration 015 guards case collisions, is re-runnable and keeps codes hashed', () => {
  const sql = fs.readFileSync(path.join(root, 'migrations', '015_account_security.sql'), 'utf8');
  assert.ok(/RAISE EXCEPTION/.test(sql));
  assert.ok(/CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_key ON users \(lower\(email\)\)/.test(sql));
  assert.ok(/code_hash\s+CHAR\(64\)/.test(sql));
  assert.ok(!/\bcode\s+(VARCHAR|TEXT|CHAR)\b/i.test(sql), 'plain code must not be a column');
  const drop = fs.readFileSync(path.join(root, 'migrations', '016_drop_plaintext_otp.sql'), 'utf8');
  assert.ok(/DROP COLUMN IF EXISTS otp\b/.test(drop) && /DROP COLUMN IF EXISTS otp_expires_at/.test(drop));
});

// ═════════════════════════════════════════════════════════════════════════════
// End-to-end tests — real Postgres
// ═════════════════════════════════════════════════════════════════════════════

let server;
let base;

async function startServer() {
  const app = express();
  app.use(express.json());
  app.use('/api/auth/forgot-password', require('../routes/forgotPasswordRoutes'));
  app.use('/api/auth/google', require('../routes/googleAuth'));
  app.use('/api/auth', require('../routes/auth'));
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
}

async function setupDatabase() {
  const admin = new (require('pg').Pool)({ connectionString: DB_URL, max: 1 });
  await admin.query(`CREATE SCHEMA ${SCHEMA}`);
  await admin.end();
  for (const f of ['001_create_users.sql', '014_auth_sessions.sql', '015_account_security.sql']) {
    await pool.query(fs.readFileSync(path.join(root, 'migrations', f), 'utf8'));
  }
}

async function teardownDatabase() {
  if (server) await new Promise((r) => server.close(r));
  if (pool) {
    await pool.end();
    const admin = new (require('pg').Pool)({ connectionString: DB_URL, max: 1 });
    await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await admin.end();
  }
}

if (DB_URL) {
  test.before(async () => {
    await setupDatabase();
    await startServer();
  });
  test.after(async () => {
    Object.assign(console, realConsole);
    await teardownDatabase();
  });
}

const post = async (route, body, headers = {}) => {
  const res = await fetch(`${base}${route}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Auth-Mode': 'body', ...headers },
    body: JSON.stringify(body),
  });
  return { status: res.status, headers: res.headers, body: await res.json().catch(() => null) };
};
const signup = (b) => post('/api/auth/signup', b);
const login = (email, password) => post('/api/auth/login', { email, password });
const verifyEmail = (email, code, password) => post('/api/auth/verify-email', { email, code, password });
const sendOtp = (email) => post('/api/auth/forgot-password/send-otp', { email });
const verifyOtp = (email, otp) => post('/api/auth/forgot-password/verify-otp', { email, otp });
const resetPassword = (email, otp, password) => post('/api/auth/forgot-password/reset-password', { email, otp, password });
const google = (payload) => post('/api/auth/google', { idToken: googleToken(payload) });

const unique = (p = 'u') => `${p}${crypto.randomBytes(4).toString('hex')}@example.com`;
const GOOD = 'correct horse battery 7';
const lastCode = (email, kind) => {
  const m = [...sent].reverse().find((s) => s.email === email.toLowerCase() && s.kind === kind);
  return m ? m.otp : null;
};
const wrongCodeFor = (code) => String((Number(code) + 1) % 1000000).padStart(6, '0');
const q = async (sql, params) => (await pool.query(sql, params)).rows;
const userByEmail = async (email) => (await q('SELECT * FROM users WHERE lower(email) = $1', [email.toLowerCase()]))[0];
const ageCodes = (interval = '1 minute') =>
  pool.query(`UPDATE auth_codes SET issued_at = issued_at - INTERVAL '${interval}'`);

async function createVerifiedUser(email, password = GOOD, extra = {}) {
  const hash = await bcrypt.hash(password, extra.cost || 4);
  const rows = await q(
    `INSERT INTO users (full_name, username, email, password, provider, google_id, email_verified)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [extra.fullName || 'Test User', 'Test', email.toLowerCase(), hash, extra.provider || 'local', extra.googleId || null, extra.verified !== false],
  );
  return rows[0];
}

async function signupAndVerify(email, password = GOOD) {
  const s = await signup({ fullName: 'Sam Signup', email, password });
  assert.equal(s.status, 202, JSON.stringify(s.body));
  const v = await verifyEmail(email, lastCode(email, 'verify'), password);
  assert.equal(v.status, 200, JSON.stringify(v.body));
  return v.body;
}

// ── item 12: password policy on the server ───────────────────────────────────
dbTest('item 12: signup refuses weak passwords with WEAK_PASSWORD and creates nothing', async () => {
  const email = unique('weak');
  for (const password of ['short', 'password', '12345678', email.split('@')[0], 'x'.repeat(80)]) {
    const res = await signup({ fullName: 'Weak Person', email, password });
    assert.equal(res.status, 400, password.slice(0, 12));
    assert.equal(res.body.code, 'WEAK_PASSWORD');
  }
  assert.equal(await userByEmail(email), undefined);
  assert.equal(sent.filter((s) => s.email === email).length, 0);
});

dbTest('item 12: signup validates the other fields too', async () => {
  assert.equal((await signup({ fullName: 'A', email: 'not-an-email', password: GOOD })).status, 400);
  assert.equal((await signup({ fullName: '', email: unique(), password: GOOD })).status, 400);
  assert.equal((await signup({ fullName: 'A', email: unique() })).status, 400);
  assert.equal((await signup({ fullName: { a: 1 }, email: unique(), password: GOOD })).status, 400);
  assert.equal((await signup({ fullName: 'A', email: unique(), password: ['x'] })).status, 400);
  assert.equal((await signup({ fullName: 'N'.repeat(200), email: unique(), password: GOOD })).status, 400);
});

dbTest('item 12: a new password is hashed with bcrypt (never stored as given)', async () => {
  const email = unique('hash');
  await signupAndVerify(email);
  const u = await userByEmail(email);
  assert.notEqual(u.password, GOOD);
  assert.equal(bcrypt.getRounds(u.password), 4);
  assert.ok(await bcrypt.compare(GOOD, u.password));
});

dbTest('item 12: logging in upgrades an old low-cost hash to the current cost', async () => {
  const email = unique('rehash');
  const u = await createVerifiedUser(email, GOOD, { cost: 4 });
  process.env.BCRYPT_COST = '6';
  try {
    assert.equal((await login(email, GOOD)).status, 200);
    const after = await userByEmail(email);
    assert.equal(after.id, u.id);
    assert.equal(bcrypt.getRounds(after.password), 6);
    assert.ok(await bcrypt.compare(GOOD, after.password), 'same password still works');
  } finally { process.env.BCRYPT_COST = '4'; }
});

// ── item 12: login does the same work for every failure ──────────────────────
dbTest('item 12: unknown email, wrong password and Google-only accounts all answer identically', async () => {
  const known = unique('known');
  const googleOnly = unique('gonly');
  await createVerifiedUser(known);
  await q(`INSERT INTO users (full_name, username, email, password, provider, google_id, email_verified)
           VALUES ('G','G',$1,'','google','g-only-1',TRUE)`, [googleOnly]);

  const compare = bcrypt.compare;
  let calls = 0;
  bcrypt.compare = (...a) => { calls++; return compare.apply(bcrypt, a); };
  try {
    fakeRedis.reset();
    const results = [];
    for (const [email, pw] of [[known, 'wrong password 1'], [unique('ghost'), 'wrong password 1'], [googleOnly, 'wrong password 1'], [googleOnly, '']]) {
      calls = 0;
      const res = await login(email, pw);
      if (pw) assert.equal(calls, 1, `exactly one bcrypt comparison for ${email}`);
      results.push(res);
    }
    for (const r of results.slice(0, 3)) {
      assert.equal(r.status, 401);
      assert.deepEqual(r.body, { message: 'Invalid credentials', code: 'INVALID_CREDENTIALS', severity: 'error' });
    }
    assert.equal(results[3].status, 400); // empty password is a validation error, not a lookup
  } finally { bcrypt.compare = compare; }
});

dbTest('item 12: malformed login input is a 400, never a crash', async () => {
  for (const body of [{}, { email: 'a@b.com' }, { password: 'x' }, { email: ['a@b.com'], password: 'x' },
    { email: 'a@b.com', password: { $ne: 1 } }, { email: 'nope', password: 'x' }, { email: 'a@b.com', password: 'x'.repeat(2000) }]) {
    const res = await post('/api/auth/login', body);
    assert.equal(res.status, 400, JSON.stringify(body).slice(0, 60));
  }
});

// ── item 12: per-account lockout ─────────────────────────────────────────────
dbTest('item 12: 5 wrong passwords lock the account, even for the correct password', async () => {
  fakeRedis.reset();
  const email = unique('lock');
  await createVerifiedUser(email);

  for (let i = 1; i <= 4; i++) {
    const res = await login(email, `wrong guess ${i}`);
    assert.equal(res.status, 401, `attempt ${i}`);
  }
  const fifth = await login(email, 'wrong guess 5');
  assert.equal(fifth.status, 429);
  assert.equal(fifth.body.code, 'ACCOUNT_LOCKED');
  assert.ok(Number(fifth.headers.get('retry-after')) > 0);

  const correct = await login(email, GOOD);
  assert.equal(correct.status, 429, 'locked means locked');
  assert.equal(correct.body.code, 'ACCOUNT_LOCKED');
  assert.equal(await q('SELECT 1 FROM auth_sessions s JOIN users u ON u.id = s.user_id WHERE u.email = $1', [email]).then((r) => r.length), 0);
});

dbTest('item 12: an email with no account locks the same way, so lockout reveals nothing', async () => {
  fakeRedis.reset();
  const ghost = unique('ghost');
  const codes = [];
  for (let i = 1; i <= 6; i++) codes.push((await login(ghost, `wrong guess ${i}`)).status);
  assert.deepEqual(codes, [401, 401, 401, 401, 429, 429]);
});

dbTest('item 12: other accounts are unaffected by someone else\'s lock', async () => {
  fakeRedis.reset();
  const a = unique('la'); const b = unique('lb');
  await createVerifiedUser(a); await createVerifiedUser(b);
  for (let i = 0; i < 5; i++) await login(a, `nope ${i}`);
  assert.equal((await login(a, GOOD)).status, 429);
  assert.equal((await login(b, GOOD)).status, 200);
});

dbTest('item 12: a successful login resets the failure counter', async () => {
  fakeRedis.reset();
  const email = unique('reset');
  await createVerifiedUser(email);
  for (let i = 0; i < 3; i++) assert.equal((await login(email, `bad ${i}`)).status, 401);
  assert.equal((await login(email, GOOD)).status, 200);
  for (let i = 0; i < 4; i++) assert.equal((await login(email, `bad again ${i}`)).status, 401);
  assert.equal((await login(email, GOOD)).status, 200, 'only 4 fresh failures, not locked');
});

dbTest('item 12: the lock expires on its own', async () => {
  fakeRedis.reset();
  process.env.LOGIN_LOCK_SECONDS = '1';
  const email = unique('expire');
  await createVerifiedUser(email);
  try {
    for (let i = 0; i < 5; i++) await login(email, `nope ${i}`);
    assert.equal((await login(email, GOOD)).status, 429);
    await new Promise((r) => setTimeout(r, 1200));
    assert.equal((await login(email, GOOD)).status, 200);
  } finally { delete process.env.LOGIN_LOCK_SECONDS; }
});

dbTest('item 12: a password reset lifts the lockout', async () => {
  fakeRedis.reset();
  const email = unique('liftlock');
  await createVerifiedUser(email);
  for (let i = 0; i < 5; i++) await login(email, `nope ${i}`);
  assert.equal((await login(email, GOOD)).status, 429);

  await sendOtp(email);
  const NEW = 'a brand new passphrase 42';
  assert.equal((await resetPassword(email, lastCode(email, 'reset'), NEW)).status, 200);
  assert.equal((await login(email, NEW)).status, 200);
});

// ── item 7: email verification + lower-cased emails ──────────────────────────
dbTest('item 7: signup does not log anyone in; it e-mails a 6-digit code', async () => {
  const email = unique('new');
  const res = await signup({ fullName: 'Nia New', email, password: GOOD });
  assert.equal(res.status, 202);
  assert.equal(res.body.requiresVerification, true);
  assert.equal(res.body.email, email);
  assert.equal(res.body.token, undefined);
  assert.equal(res.body.refreshToken, undefined);
  assert.match(lastCode(email, 'verify'), /^\d{6}$/);
  const u = await userByEmail(email);
  assert.equal(u.email_verified, false);
  assert.equal((await q('SELECT 1 FROM auth_sessions WHERE user_id = $1', [u.id])).length, 0, 'no session before verification');
});

dbTest('item 7: the correct password is not enough until the email is confirmed', async () => {
  const email = unique('unver');
  await signup({ fullName: 'Una Verified', email, password: GOOD });
  const before = sent.length;

  const wrong = await login(email, 'not the password');
  assert.equal(wrong.status, 401);
  assert.equal(wrong.body.code, 'INVALID_CREDENTIALS');

  const right = await login(email, GOOD);
  assert.equal(right.status, 403);
  assert.equal(right.body.code, 'EMAIL_NOT_VERIFIED');
  assert.equal(right.body.token, undefined);
  assert.ok(sent.length >= before, 'a (new) code may have been sent');
});

dbTest('item 7: verify-email with the right code logs in; the code works once', async () => {
  const email = unique('verify');
  await signup({ fullName: 'Vera Fy', email, password: GOOD });
  const code = lastCode(email, 'verify');

  const bad = await verifyEmail(email, wrongCodeFor(code), GOOD);
  assert.equal(bad.status, 400);
  assert.equal(bad.body.code, 'OTP_INVALID');

  const ok = await verifyEmail(email, code, GOOD);
  assert.equal(ok.status, 200);
  assert.ok(ok.body.token && ok.body.refreshToken && ok.body.id);
  assert.equal(ok.body.email, email);
  assert.equal((await userByEmail(email)).email_verified, true);

  assert.equal((await verifyEmail(email, code, GOOD)).status, 400, 'used code is dead');
  assert.equal((await login(email, GOOD)).status, 200, 'normal login works now');
});

dbTest('item 7: emails are case-insensitive (login, signup, one account)', async () => {
  const lower = unique('case');
  const mixed = lower.replace(/^./, (c) => c.toUpperCase()).replace('example.com', 'EXAMPLE.com');
  await signupAndVerify(mixed);
  assert.equal((await q('SELECT email FROM users WHERE lower(email) = $1', [lower])).length, 1);
  assert.equal((await userByEmail(lower)).email, lower, 'stored lower-cased');

  assert.equal((await login(lower, GOOD)).status, 200);
  assert.equal((await login(mixed, GOOD)).status, 200);
  assert.equal((await login(`  ${mixed.toUpperCase()}  `, GOOD)).status, 200);

  const again = await signup({ fullName: 'Dup', email: mixed.toUpperCase(), password: GOOD });
  assert.equal(again.status, 400);
  assert.equal(again.body.code, 'EMAIL_ALREADY_EXISTS');
  assert.equal((await q('SELECT 1 FROM users WHERE lower(email) = $1', [lower])).length, 1);
});

dbTest('item 7: the database itself refuses two accounts that differ only by case', async () => {
  const email = unique('idx');
  await createVerifiedUser(email);
  await assert.rejects(
    pool.query(`INSERT INTO users (full_name, username, email, password) VALUES ('x','x',$1,'x')`, [email.toUpperCase()]),
    (err) => err.code === '23505',
  );
});

dbTest('item 7: verify-email never reveals whether an account exists or is already verified', async () => {
  const verified = unique('already');
  await createVerifiedUser(verified);
  const answers = [];
  answers.push(await verifyEmail(unique('ghost'), '123456', GOOD));
  answers.push(await verifyEmail(verified, '123456', GOOD));
  const pending = unique('pending');
  await signup({ fullName: 'Pen Ding', email: pending, password: GOOD });
  answers.push(await verifyEmail(pending, wrongCodeFor(lastCode(pending, 'verify')), GOOD));
  answers.push(await verifyEmail(pending, wrongCodeFor(lastCode(pending, 'verify')), 'a totally different password 9'));
  for (const a of answers) {
    assert.equal(a.status, 400);
    assert.deepEqual(a.body, { message: 'That code is invalid or has expired.', code: 'OTP_INVALID', severity: 'error' });
  }
});

dbTest('item 7: resend-verification answers the same for every address', async () => {
  const pending = unique('rs');
  await signup({ fullName: 'Re Send', email: pending, password: GOOD });
  await ageCodes();
  const before = sent.length;
  const a = await post('/api/auth/resend-verification', { email: pending });
  const b = await post('/api/auth/resend-verification', { email: unique('nobody') });
  const verified = unique('rsv'); await createVerifiedUser(verified);
  const c = await post('/api/auth/resend-verification', { email: verified });
  for (const r of [a, b, c]) assert.equal(r.status, 200);
  assert.deepEqual(a.body, b.body); assert.deepEqual(b.body, c.body);
  assert.equal(sent.length, before + 1, 'only the pending account got a code');
  assert.equal((await post('/api/auth/resend-verification', { email: 'bad' })).status, 400);
});

dbTest('item 7: the verification code is single-use and dies after 5 wrong guesses', async () => {
  const email = unique('burn');
  await signup({ fullName: 'Bur N', email, password: GOOD });
  const code = lastCode(email, 'verify');
  for (let i = 0; i < 5; i++) assert.equal((await verifyEmail(email, wrongCodeFor(code), GOOD)).status, 400);
  const late = await verifyEmail(email, code, GOOD);
  assert.equal(late.status, 400, 'even the right code is dead after 5 wrong guesses');
  assert.equal((await userByEmail(email)).email_verified, false);
});

dbTest('item 7: verify-email rejects a weak password but keeps the code usable', async () => {
  const email = unique('weakv');
  await signup({ fullName: 'Wea Kv', email, password: GOOD });
  const code = lastCode(email, 'verify');
  const weak = await verifyEmail(email, code, 'password');
  assert.equal(weak.status, 400);
  assert.equal(weak.body.code, 'WEAK_PASSWORD');
  assert.equal((await verifyEmail(email, code, 'a stronger passphrase 88')).status, 200);
  assert.equal((await login(email, 'a stronger passphrase 88')).status, 200);
});

// ── item 7: pre-registration attacks ─────────────────────────────────────────
dbTest('item 7: pre-registered email + victim signs in with Google -> attacker loses access', async () => {
  fakeRedis.reset();
  const victim = unique('victim');
  const ATTACKER_PW = 'attackers secret passphrase 1';

  // attacker pre-registers the victim's address (cannot confirm it: no mailbox)
  await signup({ fullName: 'Not The Victim', email: victim, password: ATTACKER_PW });
  const planted = await userByEmail(victim);
  assert.equal(planted.email_verified, false);
  assert.equal((await login(victim, ATTACKER_PW)).status, 403, 'attacker cannot log in unverified');
  // (a session from before verification existed would also have to die:)
  await q(`INSERT INTO auth_sessions (user_id, expires_at) VALUES ($1, NOW() + INTERVAL '1 day')`, [planted.id]);

  // victim signs in with Google
  const g = await google({ sub: 'google-victim-1', email: victim, email_verified: true, name: 'Vic Tim', picture: 'p' });
  assert.equal(g.status, 200, JSON.stringify(g.body));
  assert.equal(g.body.id, planted.id, 'the same account, now claimed');

  const after = await userByEmail(victim);
  assert.equal(after.google_id, 'google-victim-1');
  assert.equal(after.provider, 'google');
  assert.equal(after.email_verified, true);
  assert.equal(after.password, '', 'attacker password removed');

  const attacker = await login(victim, ATTACKER_PW);
  assert.equal(attacker.status, 401);
  assert.equal(attacker.body.code, 'INVALID_CREDENTIALS');

  const live = await q(`SELECT 1 FROM auth_sessions WHERE user_id = $1 AND revoked_at IS NULL AND revoke_reason IS NULL AND id NOT IN (SELECT id FROM auth_sessions WHERE revoke_reason = 'google_claim')`, [planted.id]);
  const planted_session = await q(`SELECT revoke_reason FROM auth_sessions WHERE user_id = $1 ORDER BY created_at ASC LIMIT 1`, [planted.id]);
  assert.equal(planted_session[0].revoke_reason, 'google_claim', 'pre-existing session revoked');
  assert.ok(live.length <= 1, 'only the victim\'s fresh Google session is alive');

  // and the attacker's pending verification code no longer verifies anything
  const code = lastCode(victim, 'verify');
  if (code) assert.equal((await verifyEmail(victim, code, ATTACKER_PW)).status, 400);
});

dbTest('item 7: pre-registered email + victim signs up by email -> the owner\'s password wins', async () => {
  const victim = unique('prehijack');
  const ATTACKER_PW = 'attackers secret passphrase 2';
  const VICTIM_PW = 'the real owners passphrase 3';

  await signup({ fullName: 'Attacker', email: victim, password: ATTACKER_PW });
  const attackerHash = (await userByEmail(victim)).password;

  await ageCodes(); // get past the resend cooldown
  const second = await signup({ fullName: 'Real Owner', email: victim, password: VICTIM_PW });
  assert.equal(second.status, 202);
  assert.equal((await userByEmail(victim)).password, attackerHash, 'signing up again must not overwrite the stored password');

  // only the mailbox owner has the code; they confirm with THEIR password
  const ok = await verifyEmail(victim, lastCode(victim, 'verify'), VICTIM_PW);
  assert.equal(ok.status, 200);

  assert.equal((await login(victim, ATTACKER_PW)).status, 401, 'attacker password is gone');
  assert.equal((await login(victim, VICTIM_PW)).status, 200);
});

dbTest('item 7: re-signup cannot be used to overwrite an existing unverified (legacy) account', async () => {
  const email = unique('legacy');
  const legacy = await createVerifiedUser(email, 'old legacy pass 1', { verified: false });
  await signup({ fullName: 'Stranger', email, password: 'stranger chosen pass 2' });
  const after = await userByEmail(email);
  assert.equal(after.password, legacy.password);
  assert.equal(after.full_name, 'Test User');
  // the legacy owner can still get in: right password -> asked to confirm email
  const res = await login(email, 'old legacy pass 1');
  assert.equal(res.status, 403);
  assert.equal(res.body.code, 'EMAIL_NOT_VERIFIED');
});

dbTest('item 7: a legacy owner with an old short password can confirm without changing it', async () => {
  const email = unique('legacy2');
  await createVerifiedUser(email, 'abc123', { verified: false }); // would fail today's policy
  const res = await login(email, 'abc123');
  assert.equal(res.status, 403);
  const ok = await verifyEmail(email, lastCode(email, 'verify'), 'abc123');
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal((await login(email, 'abc123')).status, 200);
});

// ── item 7: Google linking ───────────────────────────────────────────────────
dbTest('item 7: Google links to an account whose email was confirmed (password kept)', async () => {
  const email = unique('link');
  await signupAndVerify(email);
  const before = await userByEmail(email);

  const g = await google({ sub: 'g-link-1', email: email.toUpperCase(), email_verified: true, name: 'Lin K', picture: 'p' });
  assert.equal(g.status, 200);
  assert.equal(g.body.id, before.id);

  const after = await userByEmail(email);
  assert.equal(after.google_id, 'g-link-1');
  assert.equal(after.provider, 'local', 'provider unchanged so account deletion still asks for the password');
  assert.equal(after.password, before.password);
  assert.equal((await login(email, GOOD)).status, 200);
  assert.equal((await q('SELECT 1 FROM users WHERE lower(email) = $1', [email])).length, 1);
});

dbTest('item 7: Google refuses an unverified Google email (boolean false and string "false")', async () => {
  for (const flag of [false, 'false', undefined, 0]) {
    const email = unique('gnv');
    const res = await google({ sub: `g-nv-${String(flag)}`, email, email_verified: flag, name: 'No Ver' });
    assert.equal(res.status, 401, String(flag));
    assert.equal(res.body.code, 'GOOGLE_EMAIL_NOT_VERIFIED');
    assert.equal(await userByEmail(email), undefined);
  }
});

dbTest('item 7: a different Google identity is never merged into an existing account', async () => {
  const email = unique('mismatch');
  await createVerifiedUser(email, GOOD, { provider: 'google', googleId: 'g-original' });
  const res = await google({ sub: 'g-someone-else', email, email_verified: true, name: 'Other' });
  assert.equal(res.status, 409);
  assert.equal(res.body.code, 'GOOGLE_ACCOUNT_MISMATCH');
  assert.equal((await userByEmail(email)).google_id, 'g-original');
});

dbTest('item 7: a new Google user is created verified, with a lower-cased email', async () => {
  const email = unique('gnew');
  const mixed = email.replace(/^./, (c) => c.toUpperCase());
  const res = await google({ sub: 'g-new-1', email: mixed, email_verified: true, name: 'New Gee' });
  assert.equal(res.status, 200);
  const u = await userByEmail(email);
  assert.equal(u.email, email);
  assert.equal(u.email_verified, true);
  assert.equal(u.provider, 'google');
  // signing in again finds the same account
  const again = await google({ sub: 'g-new-1', email: mixed, email_verified: true, name: 'New Gee' });
  assert.equal(again.body.id, u.id);
  // a Google-only account has no password to log in with
  assert.equal((await login(email, GOOD)).status, 401);
});

// ── item 8: password-reset codes ─────────────────────────────────────────────
dbTest('item 8: send-otp answers identically for known and unknown emails, and e-mails only the real one', async () => {
  const known = unique('known'); await createVerifiedUser(known);
  const ghost = unique('ghost');
  const before = sent.length;
  const a = await sendOtp(known);
  const b = await sendOtp(ghost);
  assert.equal(a.status, 200); assert.equal(b.status, 200);
  assert.deepEqual(a.body, b.body);
  assert.equal(a.body.success, true);
  assert.equal(sent.length, before + 1);
  assert.equal(sent.at(-1).email, known);
  assert.equal((await sendOtp('not-an-email')).status, 400);
  assert.equal((await post('/api/auth/forgot-password/send-otp', {})).status, 400);
});

dbTest('item 8: the reset code is 6 digits, and only a keyed hash is stored', async () => {
  const email = unique('hashed'); const u = await createVerifiedUser(email);
  await sendOtp(email);
  const code = lastCode(email, 'reset');
  assert.match(code, /^\d{6}$/);
  const [row] = await q(`SELECT * FROM auth_codes WHERE user_id = $1 AND purpose = 'password_reset'`, [u.id]);
  assert.match(row.code_hash, /^[0-9a-f]{64}$/);
  assert.notEqual(row.code_hash, code);
  const asText = JSON.stringify(row);
  assert.ok(!asText.includes(`"${code}"`));
  // it is an HMAC with a secret, not a bare SHA-256 anyone could precompute
  assert.notEqual(row.code_hash, crypto.createHash('sha256').update(code).digest('hex'));
  assert.notEqual(row.code_hash, crypto.createHash('sha256').update(`${u.id}:password_reset:${code}`).digest('hex'));
});

dbTest('item 8: codes are random (not sequential, not constant)', async () => {
  const seen = new Set();
  for (let i = 0; i < 12; i++) {
    const email = unique('rand'); await createVerifiedUser(email);
    await sendOtp(email); seen.add(lastCode(email, 'reset'));
  }
  assert.ok(seen.size >= 10, `got ${seen.size} distinct codes out of 12`);
});

dbTest('item 8: 5 wrong guesses burn the code; the right one no longer works', async () => {
  const email = unique('guess'); await createVerifiedUser(email);
  await sendOtp(email);
  const code = lastCode(email, 'reset');
  const wrong = wrongCodeFor(code);
  for (let i = 0; i < 5; i++) {
    const r = await verifyOtp(email, wrong);
    assert.equal(r.status, 400); assert.equal(r.body.code, 'OTP_INVALID');
  }
  assert.equal((await verifyOtp(email, code)).status, 400, 'burned');
  assert.equal((await resetPassword(email, code, 'whatever new passphrase 5')).status, 400);
  assert.equal((await login(email, GOOD)).status, 200, 'password unchanged');
});

dbTest('item 8: the attempt limit is per account, not per caller', async () => {
  // many "different callers" (the limiter is stubbed out, so these are unthrottled) get 5 tries total
  const email = unique('multi'); await createVerifiedUser(email);
  await sendOtp(email);
  const code = lastCode(email, 'reset');
  const results = await Promise.all(Array.from({ length: 20 }, (_, i) =>
    verifyOtp(email, String((Number(code) + 1 + i) % 1000000).padStart(6, '0'))));
  assert.ok(results.every((r) => r.status === 400));
  assert.equal((await verifyOtp(email, code)).status, 400, 'real code is dead after the burst');
});

dbTest('item 8: asking for a new code gives fresh guesses only after the cooldown, and is capped per hour', async () => {
  const email = unique('cool'); const u = await createVerifiedUser(email);
  await sendOtp(email);
  const first = lastCode(email, 'reset');

  const n = sent.length;
  await sendOtp(email); // inside the 30 s cooldown
  assert.equal(sent.length, n, 'no second e-mail inside the cooldown');
  assert.equal((await verifyOtp(email, first)).status, 200, 'first code still the live one');

  for (let i = 0; i < 4; i++) { await ageCodes('1 minute'); await sendOtp(email); }
  const [row] = await q(`SELECT sends_in_window FROM auth_codes WHERE user_id = $1 AND purpose = 'password_reset'`, [u.id]);
  assert.equal(row.sends_in_window, 5);

  await ageCodes('1 minute');
  const m = sent.length;
  await sendOtp(email); // 6th within the hour
  assert.equal(sent.length, m, 'hourly cap reached: nothing sent');

  await pool.query(`UPDATE auth_codes SET window_started_at = window_started_at - INTERVAL '2 hours', issued_at = issued_at - INTERVAL '2 hours'`);
  await sendOtp(email);
  assert.equal(sent.length, m + 1, 'window rolled over, sending works again');
});

dbTest('item 8: an expired code is refused', async () => {
  const email = unique('exp'); const u = await createVerifiedUser(email);
  await sendOtp(email);
  const code = lastCode(email, 'reset');
  await pool.query(`UPDATE auth_codes SET expires_at = NOW() - INTERVAL '1 second' WHERE user_id = $1`, [u.id]);
  assert.equal((await verifyOtp(email, code)).status, 400);
  assert.equal((await resetPassword(email, code, 'fresh passphrase for me 6')).status, 400);
});

dbTest('item 8: reset works once; the code, then, is dead; sessions end; email becomes verified', async () => {
  const email = unique('flow');
  await createVerifiedUser(email, GOOD, { verified: false });
  // a session that existed before the reset
  const session = await q(`INSERT INTO auth_sessions (user_id, expires_at) SELECT id, NOW() + INTERVAL '1 day' FROM users WHERE email = $1 RETURNING id`, [email]);

  await sendOtp(email);
  const code = lastCode(email, 'reset');
  assert.equal((await verifyOtp(email, code)).status, 200);
  assert.equal((await verifyOtp(email, code)).status, 200, 'verify-otp does not use the code up');

  const NEW = 'my new passphrase is long 9';
  const done = await resetPassword(email, code, NEW);
  assert.equal(done.status, 200);
  assert.equal(done.body.success, true);

  assert.equal((await resetPassword(email, code, 'second attempt passphrase 1')).status, 400, 'single use');
  assert.equal((await verifyOtp(email, code)).status, 400);
  assert.equal((await login(email, GOOD)).status, 401, 'old password gone');
  assert.equal((await login(email, NEW)).status, 200);

  const [s] = await q(`SELECT revoked_at, revoke_reason FROM auth_sessions WHERE id = $1`, [session[0].id]);
  assert.ok(s.revoked_at);
  assert.equal(s.revoke_reason, 'password_reset');
  assert.equal((await userByEmail(email)).email_verified, true);
});

dbTest('item 8: reset refuses a weak password but the code stays usable', async () => {
  const email = unique('weakr'); await createVerifiedUser(email);
  await sendOtp(email);
  const code = lastCode(email, 'reset');
  for (const pw of ['short', 'password123', email.split('@')[0]]) {
    const r = await resetPassword(email, code, pw);
    assert.equal(r.status, 400); assert.equal(r.body.code, 'WEAK_PASSWORD');
  }
  assert.equal((await resetPassword(email, code, 'finally a good passphrase 4')).status, 200);
});

dbTest('item 8: two resets racing with one code - exactly one wins', async () => {
  const email = unique('race'); await createVerifiedUser(email);
  await sendOtp(email);
  const code = lastCode(email, 'reset');
  const [a, b] = await Promise.all([
    resetPassword(email, code, 'racing passphrase number one'),
    resetPassword(email, code, 'racing passphrase number two'),
  ]);
  assert.deepEqual([a.status, b.status].sort(), [200, 400]);
});

dbTest('item 8: every failure looks the same (no account, wrong code, no code requested)', async () => {
  const noCodeYet = unique('nocode'); await createVerifiedUser(noCodeYet);
  const withCode = unique('withcode'); await createVerifiedUser(withCode);
  await sendOtp(withCode);
  const wrong = wrongCodeFor(lastCode(withCode, 'reset'));

  const answers = [
    await verifyOtp(unique('ghost'), '123456'),
    await verifyOtp(noCodeYet, '123456'),
    await verifyOtp(withCode, wrong),
    await verifyOtp(withCode, '12345'),     // wrong length
    await verifyOtp(withCode, 'abcdef'),    // not digits
    await resetPassword(unique('ghost'), '123456', GOOD),
    await resetPassword(noCodeYet, '123456', GOOD),
    await resetPassword(withCode, wrong, GOOD),
  ];
  for (const a of answers) {
    assert.equal(a.status, 400);
    assert.deepEqual(a.body, { success: false, message: 'That code is invalid or has expired.', code: 'OTP_INVALID', severity: 'error' });
  }
  assert.equal((await verifyOtp(withCode, undefined)).status, 400);
  assert.equal((await post('/api/auth/forgot-password/verify-otp', { email: withCode, otp: { $gt: '' } })).status, 400);
});

dbTest('item 8: a reset code cannot be used as an email-verification code (or the reverse)', async () => {
  const email = unique('purpose');
  await signup({ fullName: 'Pur Pose', email, password: GOOD });
  await sendOtp(email);
  const resetCode = lastCode(email, 'reset');
  const verifyCode = lastCode(email, 'verify');
  if (resetCode !== verifyCode) {
    assert.equal((await verifyEmail(email, resetCode, GOOD)).status, 400);
    assert.equal((await resetPassword(email, verifyCode, 'cross purpose passphrase 3')).status, 400);
  }
  assert.equal((await verifyEmail(email, verifyCode, GOOD)).status, 200);
});

dbTest('item 8: a reset on a Google-only account sets a password and confirms nothing else changes', async () => {
  const email = unique('gset');
  await q(`INSERT INTO users (full_name, username, email, password, provider, google_id, email_verified) VALUES ('G','G',$1,'','google','g-set-1',TRUE)`, [email]);
  await sendOtp(email);
  assert.equal((await resetPassword(email, lastCode(email, 'reset'), 'google user new passphrase 5')).status, 200);
  assert.equal((await login(email, 'google user new passphrase 5')).status, 200);
  assert.equal((await userByEmail(email)).google_id, 'g-set-1');
});

// ── existing flows keep working ──────────────────────────────────────────────
dbTest('refresh + logout still work for a session created through verify-email', async () => {
  const email = unique('sess');
  const session = await signupAndVerify(email);
  const refreshed = await post('/api/auth/refresh', { refreshToken: session.refreshToken });
  assert.equal(refreshed.status, 200);
  assert.ok(refreshed.body.token && refreshed.body.refreshToken);
  const out = await post('/api/auth/logout', { refreshToken: refreshed.body.refreshToken });
  assert.equal(out.status, 200);
  assert.equal((await post('/api/auth/refresh', { refreshToken: refreshed.body.refreshToken })).status, 401);
});
