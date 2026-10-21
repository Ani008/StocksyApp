// Daily Nifty prediction — the rules (no database, no Redis, no real clock).
const test = require('node:test');
const assert = require('node:assert/strict');

const L = require('../services/niftyPredictionLogic');

const PROD = { ENFORCE_MARKET_HOURS: 'true' };
// IST helper: ist('2026-10-21', '09:30') -> Date
const ist = (d, hhmm) => new Date(`${d}T${hhmm}:00+05:30`);
const WED = '2026-10-21'; // a normal trading Wednesday
const SAT = '2026-10-24';
const HOLIDAY = '2026-11-10'; // Diwali-Balipratipada (marketHolidays.js)

// ── phases ──────────────────────────────────────────────────────────────────
test('phase: before open, open, locked on a trading day', () => {
  const p = (hhmm, prediction = null) => L.getPhase({ now: ist(WED, hhmm), prediction, env: PROD });
  assert.equal(p('08:59'), L.PHASE.BEFORE_OPEN);
  assert.equal(p('09:15'), L.PHASE.OPEN);
  assert.equal(p('09:59'), L.PHASE.OPEN);
  assert.equal(p('10:00'), L.PHASE.LOCKED);
  assert.equal(p('14:00'), L.PHASE.LOCKED);
});

test('phase: weekends and exchange holidays are closed days', () => {
  assert.equal(L.getPhase({ now: ist(SAT, '09:30'), env: PROD }), L.PHASE.CLOSED_DAY);
  assert.equal(L.getPhase({ now: ist(HOLIDAY, '09:30'), env: PROD }), L.PHASE.CLOSED_DAY);
});

test('phase: a made call is predicted, then settling after 15:30, then resolved', () => {
  const pending = { status: 'PENDING' };
  assert.equal(L.getPhase({ now: ist(WED, '09:40'), prediction: pending, env: PROD }), L.PHASE.PREDICTED);
  assert.equal(L.getPhase({ now: ist(WED, '15:29'), prediction: pending, env: PROD }), L.PHASE.PREDICTED);
  assert.equal(L.getPhase({ now: ist(WED, '15:30'), prediction: pending, env: PROD }), L.PHASE.SETTLING);
  for (const status of ['WON', 'LOST', 'VOID']) {
    assert.equal(L.getPhase({ now: ist(WED, '16:00'), prediction: { status }, env: PROD }), L.PHASE.RESOLVED);
  }
});

test('phase: lock time comes from env, and bad values fall back to 10:00', () => {
  assert.equal(L.getLockHhmm({ NIFTY_PREDICTION_LOCK_HHMM: '09:45' }), '09:45');
  for (const bad of ['', 'abc', '25:00', '9:45', '09:00', '15:30', '16:00', '10:5']) {
    assert.equal(L.getLockHhmm({ NIFTY_PREDICTION_LOCK_HHMM: bad }), '10:00', bad);
  }
  assert.equal(
    L.getPhase({ now: ist(WED, '09:50'), env: { ...PROD, NIFTY_PREDICTION_LOCK_HHMM: '09:45' } }),
    L.PHASE.LOCKED,
  );
});

test('phase: outside production the window is always open (dev switch)', () => {
  assert.equal(L.getPhase({ now: ist(SAT, '23:00'), env: {} }), L.PHASE.OPEN);
  assert.equal(L.getPhase({ now: ist(WED, '15:45'), prediction: { status: 'PENDING' }, env: {} }), L.PHASE.PREDICTED);
});

test('window: ISO instants for the day, null on a closed day', () => {
  const w = L.getWindow({ now: ist(WED, '09:30'), env: PROD });
  assert.equal(w.opensAt, ist(WED, '09:15').toISOString());
  assert.equal(w.locksAt, ist(WED, '10:00').toISOString());
  assert.equal(w.settlesAt, ist(WED, '15:30').toISOString());
  assert.equal(L.getWindow({ now: ist(SAT, '09:30'), env: PROD }), null);
});

test('IST day is used, not the server timezone (late-night UTC is already tomorrow in IST)', () => {
  // 2026-10-20 19:00 UTC = 2026-10-21 00:30 IST
  assert.equal(L.istNow(new Date('2026-10-20T19:00:00Z')).isoDate, '2026-10-21');
});

test('formatHhmm', () => {
  assert.equal(L.formatHhmm('10:00'), '10:00 AM');
  assert.equal(L.formatHhmm('15:30'), '3:30 PM');
  assert.equal(L.formatHhmm('12:05'), '12:05 PM');
  assert.equal(L.formatHhmm('00:00'), '12:00 AM');
});

// ── streaks ─────────────────────────────────────────────────────────────────
const row = (trade_date, status) => ({ trade_date, status });

test('streak: counts correct calls in a row, a wrong call resets it', () => {
  const s = L.computeStreaks([
    row('2026-10-12', 'WON'), row('2026-10-13', 'WON'), row('2026-10-14', 'WON'),
    row('2026-10-15', 'LOST'),
    row('2026-10-16', 'WON'), row('2026-10-19', 'WON'),
  ]);
  assert.deepEqual(s, { current: 2, best: 3, won: 5, lost: 1 });
});

test('streak: input order does not matter', () => {
  const rows = [row('2026-10-14', 'WON'), row('2026-10-12', 'WON'), row('2026-10-13', 'LOST')];
  assert.equal(L.computeStreaks(rows).current, 1);
  assert.equal(L.computeStreaks([...rows].reverse()).current, 1);
});

test('streak: VOID and PENDING neither extend nor break it; skipped days do not break it', () => {
  const s = L.computeStreaks([
    row('2026-10-12', 'WON'),
    row('2026-10-13', 'VOID'),
    row('2026-10-19', 'WON'), // skipped several days in between
    row('2026-10-20', 'PENDING'),
  ]);
  assert.equal(s.current, 2);
  assert.equal(s.won, 2);
  assert.equal(s.lost, 0);
});

test('streak: empty / junk input is safe', () => {
  assert.deepEqual(L.computeStreaks([]), { current: 0, best: 0, won: 0, lost: 0 });
  assert.deepEqual(L.computeStreaks(undefined), { current: 0, best: 0, won: 0, lost: 0 });
  assert.deepEqual(L.computeStreaks([null, {}]), { current: 0, best: 0, won: 0, lost: 0 });
});

// ── trusting a close price ──────────────────────────────────────────────────
const quote = (hhmm, ltp = 24512.349, offsetSec = 0) => ({ ltp, tsMs: ist(WED, hhmm).getTime() + offsetSec * 1000 });

test('close: never before 15:31', () => {
  assert.equal(L.evaluateCloseReading({ quote: quote('15:30'), now: ist(WED, '15:30') }).status, 'WAIT');
});

test('close: a mid-session price is not the close', () => {
  // feed died at 11:00; at 15:45 the last reading is from 11:00
  const v = L.evaluateCloseReading({ quote: quote('11:00'), now: ist(WED, '15:45') });
  assert.equal(v.status, 'WAIT');
  // ...and by 16:00 we stop waiting and void the day
  assert.equal(L.evaluateCloseReading({ quote: quote('11:00'), now: ist(WED, '16:00') }).status, 'GIVE_UP');
});

test('close: ready once the feed has gone quiet, rounded to 2 decimals', () => {
  // last tick 15:30:05, now 15:32 -> quiet for >60s
  const v = L.evaluateCloseReading({ quote: quote('15:30', 24512.349, 5), now: ist(WED, '15:32') });
  assert.deepEqual(v, { status: 'READY', close: 24512.35 });
});

test('close: still ticking right now -> wait', () => {
  const v = L.evaluateCloseReading({ quote: quote('15:31', 24500, 30), now: ist(WED, '15:31:50'.slice(0, 5)) });
  assert.equal(v.status, 'WAIT');
});

test('close: a feed that never goes quiet is accepted from 15:40', () => {
  const now = ist(WED, '15:40');
  const v = L.evaluateCloseReading({ quote: { ltp: 24500, tsMs: now.getTime() - 5000 }, now });
  assert.deepEqual(v, { status: 'READY', close: 24500 });
});

test('close: missing, zero or non-numeric readings are never used', () => {
  const now = ist(WED, '15:45');
  for (const q of [null, { ltp: 0, tsMs: now.getTime() - 120000 }, { ltp: 'x', tsMs: now.getTime() - 120000 }, { ltp: 24500, tsMs: NaN }]) {
    assert.equal(L.evaluateCloseReading({ quote: q, now }).status, 'WAIT', JSON.stringify(q));
  }
  assert.equal(L.evaluateCloseReading({ quote: null, now: ist(WED, '16:05') }).status, 'GIVE_UP');
});
