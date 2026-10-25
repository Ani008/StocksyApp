// Stock of the Day — the whole flow through the service, with Postgres and Redis
// swapped for in-memory fakes (no database, no network).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// ── fakes, installed BEFORE the service is loaded ───────────────────────────
function stubModule(relPath, exports) {
  const resolved = require.resolve(relPath);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}

const SNAPSHOT_PATH = path.join(__dirname, '..', '..', 'backend_py', 'fundamentals_snapshot.json');
const hasSnapshot = fs.existsSync(SNAPSHOT_PATH);
const SNAPSHOT_JSON = hasSnapshot ? fs.readFileSync(SNAPSHOT_PATH, 'utf8') : null;

const fakeRedis = { value: SNAPSHOT_JSON, reads: 0 };
stubModule('../services/redisService', {
  get: async (key) => {
    fakeRedis.reads += 1;
    return key === 'fundamentals:ALL' ? fakeRedis.value : null;
  },
});
stubModule('../utils/logger', { error() {}, warn() {}, info() {}, debug() {} });

const db = { days: new Map(), answers: [], dayInserts: 0 };
stubModule('../repositories/stockOfTheDayRepository', {
  getDay: async (d) => db.days.get(d) || null,
  insertDay: async (d, payload) => {
    db.dayInserts += 1;
    if (!db.days.has(d)) db.days.set(d, JSON.parse(JSON.stringify(payload)));
    return db.days.get(d);
  },
  getAnswers: async (userId, d) =>
    db.answers.filter((a) => a.userId === userId && a.playDate === d)
      .map((a) => ({ roundIndex: a.roundIndex, pickedKey: a.pickedKey }))
      .sort((a, b) => a.roundIndex - b.roundIndex),
  insertAnswer: async ({ userId, playDate, roundIndex, pickedKey }) => {
    const dup = db.answers.find((a) => a.userId === userId && a.playDate === playDate && a.roundIndex === roundIndex);
    if (dup) return { created: false };
    db.answers.push({ userId, playDate, roundIndex, pickedKey });
    return { created: true };
  },
});

const service = require('../services/stockOfTheDayService');
const { ValidationError } = require('../utils/errors');

const skip = !hasSnapshot && 'snapshot not in this checkout';
const NOW = new Date('2026-10-23T10:00:00+05:30');
const reset = () => {
  db.days.clear(); db.answers.length = 0; db.dayInserts = 0;
  fakeRedis.value = SNAPSHOT_JSON; fakeRedis.reads = 0;
};

test('today is the IST date, even when UTC is still on the previous day', () => {
  assert.equal(service.todayKey(new Date('2026-10-23T00:10:00+05:30')), '2026-10-23');
  assert.equal(service.todayKey(new Date('2026-10-22T18:40:00Z')), '2026-10-23');
});

test('first look builds and stores the day; the answers stay hidden', { skip }, async () => {
  reset();
  const state = await service.getState('u1', NOW);
  assert.equal(state.date, '2026-10-23');
  assert.equal(state.total, 5);
  assert.equal(state.answered, 0);
  assert.equal(state.complete, false);
  assert.equal(state.result, null);
  assert.equal(db.dayInserts, 1);
  assert.doesNotMatch(JSON.stringify(state), /winnerKey|leftValue|rightValue/);
});

test('the day is built once and reused, even if the data later changes', { skip }, async () => {
  reset();
  const first = await service.getState('u1', NOW);
  fakeRedis.value = null; // fundamentals vanish after the day exists
  const reads = fakeRedis.reads;
  const again = await service.getState('u2', NOW);
  assert.deepEqual(again.rounds.map((r) => r.left.key + r.right.key), first.rounds.map((r) => r.left.key + r.right.key));
  assert.equal(fakeRedis.reads, reads, 'must not re-read fundamentals once the day is stored');
  assert.equal(db.dayInserts, 1);
});

test('every user gets the same day', { skip }, async () => {
  reset();
  const a = await service.getState('alice', NOW);
  const b = await service.getState('bob', NOW);
  assert.deepEqual(a.rounds.map((r) => [r.text, r.left.key, r.right.key]), b.rounds.map((r) => [r.text, r.left.key, r.right.key]));
});

test('a full game: answers lock in and the result appears only after the last one', { skip }, async () => {
  reset();
  const state = await service.getState('u1', NOW);
  let last;
  for (const r of state.rounds) {
    last = await service.submitAnswer('u1', { roundIndex: r.index, pickedKey: r.left.key }, NOW);
    assert.equal(last.alreadyAnswered, false);
    if (r.index < 4) {
      assert.equal(last.state.complete, false);
      assert.equal(last.state.result, null);
      assert.doesNotMatch(JSON.stringify(last.state), /winnerKey|leftValue/);
    }
  }
  assert.equal(last.state.complete, true);
  const { score, total, rounds } = last.state.result;
  assert.equal(total, 5);
  assert.equal(score, rounds.filter((r) => r.correct).length);
  assert.ok(score >= 0 && score <= 5);
  // A fresh read gives the same finished result (survives leaving and coming back).
  const reread = await service.getState('u1', NOW);
  assert.deepEqual(reread.result, last.state.result);
});

test('answers are per user: one person finishing does not finish another', { skip }, async () => {
  reset();
  const state = await service.getState('u1', NOW);
  for (const r of state.rounds) await service.submitAnswer('u1', { roundIndex: r.index, pickedKey: r.right.key }, NOW);
  const other = await service.getState('u2', NOW);
  assert.equal(other.answered, 0);
  assert.equal(other.complete, false);
});

test('a repeated answer keeps the first one (double tap / second device)', { skip }, async () => {
  reset();
  const state = await service.getState('u1', NOW);
  const r = state.rounds[0];
  await service.submitAnswer('u1', { roundIndex: 0, pickedKey: r.left.key }, NOW);
  const again = await service.submitAnswer('u1', { roundIndex: 0, pickedKey: r.right.key }, NOW);
  assert.equal(again.alreadyAnswered, true);
  assert.equal(again.state.rounds[0].pickedKey, r.left.key, 'the original pick must not change');
  assert.equal(again.state.answered, 1);
});

test('a pick outside the two companies, or a bad round, is rejected and saves nothing', { skip }, async () => {
  reset();
  const state = await service.getState('u1', NOW);
  await assert.rejects(service.submitAnswer('u1', { roundIndex: 0, pickedKey: 'NSE_EQ|NOPE' }, NOW), ValidationError);
  await assert.rejects(service.submitAnswer('u1', { roundIndex: 9, pickedKey: state.rounds[0].left.key }, NOW), ValidationError);
  await assert.rejects(service.submitAnswer('u1', { roundIndex: 'x', pickedKey: state.rounds[0].left.key }, NOW), ValidationError);
  assert.equal(db.answers.length, 0);
});

test('a new IST day is a new game', { skip }, async () => {
  reset();
  const today = await service.getState('u1', NOW);
  for (const r of today.rounds) await service.submitAnswer('u1', { roundIndex: r.index, pickedKey: r.left.key }, NOW);
  const tomorrow = await service.getState('u1', new Date('2026-10-24T09:00:00+05:30'));
  assert.equal(tomorrow.date, '2026-10-24');
  assert.equal(tomorrow.answered, 0);
  assert.equal(tomorrow.complete, false);
});

test('no fundamentals yet means a clear "not ready" error, and nothing is stored', async () => {
  reset();
  fakeRedis.value = null;
  await assert.rejects(
    service.getState('u1', NOW),
    (err) => err instanceof service.StockOfTheDayError && err.code === 'STOCK_OF_THE_DAY_UNAVAILABLE' && err.status === 503,
  );
  assert.equal(db.days.size, 0);
});

test('unreadable fundamentals is the same "not ready" error, not a crash', async () => {
  reset();
  fakeRedis.value = '{not json';
  await assert.rejects(service.getState('u1', NOW), service.StockOfTheDayError);
});
