// Follow system — the rules that need no database: validating ids / search
// text / paging cursors, and the shape of what other users are allowed to see.
// (The SQL itself is exercised against a real Postgres engine separately.)
const test = require('node:test');
const assert = require('node:assert/strict');

const L = require('../services/followLogic');
const { ValidationError } = require('../utils/errors');

const ID_A = '0b6f3a52-6a39-4c63-9d1b-6a0e5b6f2f11';
const ID_B = '7d2c1e9a-3f44-4b57-8a0c-1d9e2f3a4b55';
const TS = '2026-11-03T07:55:10.123456Z';

// ── ids ─────────────────────────────────────────────────────────────────────
test('isUuid accepts UUIDs and rejects everything else', () => {
  assert.equal(L.isUuid(ID_A), true);
  assert.equal(L.isUuid(ID_A.toUpperCase()), true);
  assert.equal(L.isUuid('me'), false);
  assert.equal(L.isUuid('123'), false);
  assert.equal(L.isUuid(`${ID_A}; DROP TABLE users`), false);
  assert.equal(L.isUuid(undefined), false);
  assert.equal(L.isUuid(null), false);
  assert.equal(L.isUuid(42), false);
});

// ── limit ───────────────────────────────────────────────────────────────────
test('clampLimit defaults, floors at 1 and caps at max', () => {
  const lim = L.LIST_LIMIT; // { def: 20, max: 50 }
  assert.equal(L.clampLimit(undefined, lim), 20);
  assert.equal(L.clampLimit('', lim), 20);
  assert.equal(L.clampLimit('abc', lim), 20);
  assert.equal(L.clampLimit('0', lim), 20);
  assert.equal(L.clampLimit('-5', lim), 20);
  assert.equal(L.clampLimit('1', lim), 1);
  assert.equal(L.clampLimit('35', lim), 35);
  assert.equal(L.clampLimit('50', lim), 50);
  assert.equal(L.clampLimit('51', lim), 50);
  assert.equal(L.clampLimit('99999', lim), 50);
  assert.equal(L.clampLimit('12.9', lim), 12);
  assert.equal(L.clampLimit('99999', L.SEARCH_LIMIT), 30);
});

// ── search text ─────────────────────────────────────────────────────────────
test('cleanSearch trims, collapses spaces and caps the length', () => {
  assert.equal(L.cleanSearch('  Ani   Chakke  '), 'Ani Chakke');
  assert.equal(L.cleanSearch(''), '');
  assert.equal(L.cleanSearch('x'.repeat(500)).length, 50);
});

test('cleanSearch treats non-string query values as no search', () => {
  assert.equal(L.cleanSearch(undefined), '');
  assert.equal(L.cleanSearch(['a', 'b']), ''); // ?q=a&q=b
  assert.equal(L.cleanSearch({ x: '1' }), ''); // ?q[x]=1
  assert.equal(L.cleanSearch(42), '');
});

test('escapeLike makes %, _ and \\ literal', () => {
  assert.equal(L.escapeLike('50%'), '50\\%');
  assert.equal(L.escapeLike('a_b'), 'a\\_b');
  assert.equal(L.escapeLike('a\\b'), 'a\\\\b');
  assert.equal(L.escapeLike('%_\\'), '\\%\\_\\\\');
  assert.equal(L.escapeLike('plain name'), 'plain name');
});

// ── cursor ──────────────────────────────────────────────────────────────────
test('cursor round-trips and keeps microsecond precision', () => {
  const cursor = L.encodeCursor(TS, ID_A);
  assert.equal(typeof cursor, 'string');
  assert.deepEqual(L.decodeCursor(cursor), { ts: TS, id: ID_A });
  assert.ok(L.decodeCursor(cursor).ts.endsWith('123456Z')); // not cut to milliseconds
});

test('decodeCursor: no cursor means first page', () => {
  assert.equal(L.decodeCursor(undefined), null);
  assert.equal(L.decodeCursor(null), null);
  assert.equal(L.decodeCursor(''), null);
});

test('decodeCursor rejects anything that is not one of ours (400, not a DB error)', () => {
  const enc = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const bad = [
    'garbage',
    '!!!not base64!!!',
    Buffer.from('not json').toString('base64url'),
    enc({ ts: TS, id: ID_A }), // object, not [ts, id]
    enc([TS]), // too short
    enc([TS, ID_A, 'extra']), // too long
    enc([123, ID_A]), // ts not a string
    enc(['2026-11-03', ID_A]), // wrong ts format
    enc(['2026-11-03T07:55:10Z', ID_A]), // no microseconds
    enc([TS, 'not-a-uuid']),
    enc([TS, `${ID_A}'; DROP TABLE follows;--`]),
    enc(['2026-02-30T07:55:10.123456Z', ID_A]), // impossible date
    enc(['2026-13-01T07:55:10.123456Z', ID_A]), // impossible month
    enc(['2026-11-03T25:00:00.123456Z', ID_A]), // impossible hour
    'A'.repeat(500), // too long
    ['a', 'b'], // ?cursor=a&cursor=b
    { x: 1 },
    42,
  ];

  for (const value of bad) {
    assert.throws(() => L.decodeCursor(value), ValidationError, `should reject: ${String(value).slice(0, 40)}`);
  }
});

// ── response shapes ─────────────────────────────────────────────────────────
const row = (over = {}) => ({
  id: ID_B,
  full_name: 'Riya Sharma',
  avatar: 'https://example.com/a.png',
  is_following: true,
  follows_you: false,
  cursor_ts: TS,
  ...over,
});

test('serializeUser exposes only the public fields', () => {
  const dirty = row({
    email: 'riya@example.com',
    demo_balance: '1000000.00',
    password: 'hash',
    google_id: 'g-123',
    provider: 'google',
    username: 'Riya',
  });

  const out = L.serializeUser(dirty, ID_A);

  assert.deepEqual(out, {
    id: ID_B,
    fullName: 'Riya Sharma',
    avatar: 'https://example.com/a.png',
    isSelf: false,
    isFollowing: true,
    followsYou: false,
  });
  assert.equal(JSON.stringify(out).includes('riya@example.com'), false);
});

test('serializeUser: isSelf, missing avatar and flag coercion', () => {
  assert.equal(L.serializeUser(row(), ID_B).isSelf, true);
  assert.equal(L.serializeUser(row(), ID_A).isSelf, false);
  assert.equal(L.serializeUser(row({ avatar: null }), ID_A).avatar, '');
  assert.equal(L.serializeUser(row({ avatar: undefined }), ID_A).avatar, '');
  assert.equal(L.serializeUser(row({ is_following: undefined, follows_you: null }), ID_A).isFollowing, false);
  assert.equal(L.serializeUser(row({ is_following: undefined, follows_you: null }), ID_A).followsYou, false);
});

test('serializeProfile adds the two counts and still leaks nothing private', () => {
  const out = L.serializeProfile(
    row({ followers_count: 12, following_count: 0, email: 'riya@example.com', demo_balance: '5' }),
    ID_A,
  );
  assert.equal(out.followersCount, 12);
  assert.equal(out.followingCount, 0); // zero stays zero, not undefined
  assert.equal('email' in out, false);
  assert.equal('demo_balance' in out, false);
  assert.equal('demoBalance' in out, false);
});

// ── paging ──────────────────────────────────────────────────────────────────
const rows = (n) =>
  Array.from({ length: n }, (_, i) =>
    row({
      id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
      full_name: `User ${i}`,
      cursor_ts: `2026-11-03T07:55:${String(59 - i).padStart(2, '0')}.000001Z`,
    }),
  );

test('buildPage: an extra row means more pages, and is not returned', () => {
  const fetched = rows(4); // limit 3 → 4 fetched
  const page = L.buildPage(fetched, 3, ID_A);

  assert.equal(page.users.length, 3);
  assert.deepEqual(
    page.users.map((u) => u.fullName),
    ['User 0', 'User 1', 'User 2'],
  );
  // the cursor points at the LAST row returned (User 2), not the dropped one
  assert.deepEqual(L.decodeCursor(page.nextCursor), { ts: fetched[2].cursor_ts, id: fetched[2].id });
});

test('buildPage: exactly a full page with nothing after it has no next cursor', () => {
  const page = L.buildPage(rows(3), 3, ID_A);
  assert.equal(page.users.length, 3);
  assert.equal(page.nextCursor, null);
});

test('buildPage: short page and empty page', () => {
  assert.equal(L.buildPage(rows(2), 3, ID_A).nextCursor, null);

  const empty = L.buildPage([], 3, ID_A);
  assert.deepEqual(empty, { users: [], nextCursor: null });
});
