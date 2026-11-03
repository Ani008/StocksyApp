// Usernames, display names, profile edits and the avatar catalog — the rules
// that need no database. (The SQL and the signup / email-confirmation / Google
// flows are exercised against a real Postgres engine separately.)
const test = require('node:test');
const assert = require('node:assert/strict');

const P = require('../services/profileLogic');
const { AVATARS, isAvatarId } = require('../config/avatars');
const { ValidationError, ConflictError, mapErrorToResponse } = require('../utils/errors');

// ── username ────────────────────────────────────────────────────────────────
test('checkUsername accepts good usernames and lowercases them', () => {
  assert.deepEqual(P.checkUsername('Rahul_21'), { ok: true, username: 'rahul_21' });
  assert.deepEqual(P.checkUsername('  a.b_c9  '), { ok: true, username: 'a.b_c9' });
  assert.equal(P.checkUsername('abc').ok, true); // min length
  assert.equal(P.checkUsername('a'.repeat(20)).ok, true); // max length
  assert.equal(P.checkUsername('9lives').ok, true); // may start with a digit
});

test('checkUsername rejects bad usernames with a reason and a showable message', () => {
  const cases = [
    [undefined, 'REQUIRED'], [null, 'REQUIRED'], ['', 'REQUIRED'], ['   ', 'REQUIRED'], [42, 'REQUIRED'], [['a', 'b'], 'REQUIRED'],
    ['ab', 'TOO_SHORT'],
    ['a'.repeat(21), 'TOO_LONG'],
    ['has space', 'INVALID_CHARACTERS'], ['rahul!', 'INVALID_CHARACTERS'], ['राहुल', 'INVALID_CHARACTERS'],
    ['a-b-c', 'INVALID_CHARACTERS'], ['x@y', 'INVALID_CHARACTERS'], ["a';drop", 'INVALID_CHARACTERS'], ['😀😀😀', 'INVALID_CHARACTERS'],
    ['.abc', 'INVALID_FORMAT'], ['abc.', 'INVALID_FORMAT'], ['a..b', 'INVALID_FORMAT'],
    ['admin', 'RESERVED'], ['Stocksy', 'RESERVED'], ['ADMIN', 'RESERVED'], ['leaderboard', 'RESERVED'],
    ['me', 'TOO_SHORT'], // "me" is the URL alias for yourself: too short to ever be a username
  ];
  for (const [input, reason] of cases) {
    const r = P.checkUsername(input);
    assert.equal(r.ok, false, `should reject ${JSON.stringify(input)}`);
    assert.equal(r.reason, reason, `reason for ${JSON.stringify(input)}`);
    assert.equal(typeof r.message, 'string');
    assert.ok(r.message.length > 0);
  }
});

test('reserved words are only blocked when they are the WHOLE username', () => {
  assert.equal(P.checkUsername('admin_rahul').ok, true);
  assert.equal(P.checkUsername('stocksy1').ok, true);
});

// ── full name ───────────────────────────────────────────────────────────────
test('cleanFullName trims, collapses spaces and keeps real-world names intact', () => {
  assert.equal(P.cleanFullName('  Ani   Chakke '), 'Ani Chakke');
  assert.equal(P.cleanFullName('राहुल पाटील'), 'राहुल पाटील');
  assert.equal(P.cleanFullName("D'Souza-Smith Jr."), "D'Souza-Smith Jr.");
});

test('cleanFullName rejects empty, non-strings, too long and hidden control characters', () => {
  for (const bad of [undefined, null, 42, ['a'], {}, '', '   ', 'x'.repeat(151), 'a\u0000b', 'a‮b', 'a⁦b']) {
    assert.throws(() => P.cleanFullName(bad), ValidationError, `should reject ${JSON.stringify(bad)}`);
  }
  assert.equal(P.cleanFullName('x'.repeat(150)).length, 150);
});

// ── profile edit body ───────────────────────────────────────────────────────
test('parseProfileUpdate returns only the changed, cleaned fields', () => {
  assert.deepEqual(P.parseProfileUpdate({ fullName: '  New  Name ' }), { fullName: 'New Name' });
  assert.deepEqual(P.parseProfileUpdate({ username: 'Cool_Name' }), { username: 'cool_name' });
  assert.deepEqual(P.parseProfileUpdate({ avatarId: 'male_2' }), { avatarId: 'male_2' });
  assert.deepEqual(
    P.parseProfileUpdate({ fullName: 'A B', username: 'abc', avatarId: 'female_1' }),
    { fullName: 'A B', username: 'abc', avatarId: 'female_1' },
  );
});

test('parseProfileUpdate never lets anything else through', () => {
  const out = P.parseProfileUpdate({
    fullName: 'A B', demoBalance: 9e9, demo_balance: 9e9, provider: 'x', id: 'other', isAdmin: true,
    password: 'x', google_id: 'g', email_verified: true, usernameSet: false, username_set: false,
  });
  assert.deepEqual(out, { fullName: 'A B' });
});

test('parseProfileUpdate refuses an email change outright, even with other valid fields', () => {
  assert.throws(() => P.parseProfileUpdate({ email: 'x@y.com' }), /email/i);
  assert.throws(() => P.parseProfileUpdate({ fullName: 'A B', email: 'x@y.com' }), /email/i);
  assert.throws(() => P.parseProfileUpdate({ email: undefined }), ValidationError); // key present at all
});

test('parseProfileUpdate rejects empty, non-object and invalid values', () => {
  for (const bad of [undefined, null, 'str', 42, [], {}, { unknown: 1 }, { fullName: '' }, { username: 'a' }, { avatarId: 'nope' }, { avatarId: 5 }, { avatarId: null }, { fullName: null }]) {
    assert.throws(() => P.parseProfileUpdate(bad), ValidationError, `should reject ${JSON.stringify(bad)}`);
  }
});

// ── avatars ─────────────────────────────────────────────────────────────────
test('avatar catalog: ids are unique, grouped by gender, and validated strictly', () => {
  assert.ok(AVATARS.length >= 2);
  const ids = AVATARS.map((a) => a.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(AVATARS.some((a) => a.gender === 'male') && AVATARS.some((a) => a.gender === 'female'));
  for (const a of AVATARS) {
    assert.equal(isAvatarId(a.id), true);
    assert.ok(a.id.startsWith(`${a.gender}_`));
  }
  for (const bad of ['male_999', 'MALE_1', '', null, undefined, 1, {}, '__proto__', 'constructor', 'toString']) {
    assert.equal(isAvatarId(bad), false, `should reject ${String(bad)}`);
  }
  assert.throws(() => { AVATARS.push({ id: 'x', gender: 'male' }); }, TypeError); // frozen
});

// ── own-account response ────────────────────────────────────────────────────
test('serializeAccount: keeps every original login field and adds usernameSet / avatarId', () => {
  const out = P.serializeAccount({
    id: 'u1', username: 'Rahul', username_set: false, full_name: 'Rahul P', email: 'r@x.com',
    avatar: 'https://g/p.png', avatar_id: null, demo_balance: '1000000.00',
  });
  assert.deepEqual(out, {
    id: 'u1', username: 'Rahul', usernameSet: false, fullName: 'Rahul P', email: 'r@x.com',
    avatar: 'https://g/p.png', avatarId: null, demoBalance: '1000000.00',
  });
});

test('serializeAccount: missing columns degrade safely (old rows, partial selects)', () => {
  const out = P.serializeAccount({ id: 'u1', username: 'x', full_name: 'X', email: 'x@y.z' });
  assert.equal(out.usernameSet, false);
  assert.equal(out.avatarId, null);
});

test('serializeAccount never leaks credentials or internal columns', () => {
  const json = JSON.stringify(P.serializeAccount({
    id: 'u1', username: 'x', full_name: 'X', email: 'x@y.z', password: 'HASH', google_id: 'G123',
    signup_username: 'secret_pending', email_verified: true, provider: 'google',
  }));
  for (const leak of ['HASH', 'G123', 'secret_pending', 'signup_username', 'google_id', 'provider']) {
    assert.equal(json.includes(leak), false, `leaked ${leak}`);
  }
});

// ── error contract ──────────────────────────────────────────────────────────
test('ConflictError maps to 409 with its own machine-readable code', () => {
  const { status, body } = mapErrorToResponse(new ConflictError('That username is already taken.', 'USERNAME_TAKEN'));
  assert.equal(status, 409);
  assert.deepEqual(body, { message: 'That username is already taken.', code: 'USERNAME_TAKEN', severity: 'error' });
  assert.equal(mapErrorToResponse(new ConflictError('x')).body.code, 'CONFLICT');
});
