// Daily streak saved on the server — the rules and the service (no database,
// no Redis, no real clock; the repository is an in-memory stand-in).
//
// Calendar used below (IST, 2026):
//   Fri 16 Oct   trading         Mon 19 Oct   trading
//   Sat 17 / Sun 18  weekend     Tue 20 Oct   HOLIDAY (Dussehra)
//   Wed 21 Oct   trading         Thu 22 Oct   trading
//   Fri 23 Oct   trading         Sat 24 / Sun 25  weekend
//   Mon 26 Oct   trading         Tue 27 Oct   trading
const test = require('node:test');
const assert = require('node:assert/strict');

const L = require('../services/streakLogic');
const { createStreakService } = require('../services/streakService');

// IST helper: ist('2026-10-22', '23:59') -> Date
const ist = (d, hhmm = '12:00') => new Date(`${d}T${hhmm}:00+05:30`);

// ── date helpers ────────────────────────────────────────────────────────────
test('istDateKey uses the IST calendar day, not UTC', () => {
  assert.equal(L.istDateKey(ist('2026-10-22', '00:30')), '2026-10-22');
  assert.equal(L.istDateKey(ist('2026-10-22', '23:59')), '2026-10-22');
  assert.equal(L.istDateKey(new Date('2026-10-21T18:45:00Z')), '2026-10-22'); // 00:15 IST
});

test('isValidKey rejects malformed and impossible dates', () => {
  assert.equal(L.isValidKey('2026-10-22'), true);
  assert.equal(L.isValidKey('2028-02-29'), true);
  assert.equal(L.isValidKey('2026-02-29'), false); // not a leap year
  assert.equal(L.isValidKey('2026-02-31'), false);
  assert.equal(L.isValidKey('2026-13-01'), false);
  assert.equal(L.isValidKey('22-10-2026'), false);
  assert.equal(L.isValidKey(20261022), false);
  assert.equal(L.isValidKey(null), false);
});

test('shiftKey and dayDiff cross month, year and leap-day boundaries', () => {
  assert.equal(L.shiftKey('2026-10-31', 1), '2026-11-01');
  assert.equal(L.shiftKey('2026-01-01', -1), '2025-12-31');
  assert.equal(L.shiftKey('2028-02-28', 1), '2028-02-29');
  assert.equal(L.dayDiff('2025-12-31', '2026-01-01'), 1);
  assert.equal(L.dayDiff('2026-10-22', '2026-10-20'), -2);
});

// ── trading days ────────────────────────────────────────────────────────────
test('nextTradingDay skips weekends and exchange holidays', () => {
  assert.equal(L.nextTradingDay('2026-10-22'), '2026-10-23'); // Thu -> Fri
  assert.equal(L.nextTradingDay('2026-10-23'), '2026-10-26'); // Fri -> Mon
  assert.equal(L.nextTradingDay('2026-10-24'), '2026-10-26'); // Sat -> Mon
  assert.equal(L.nextTradingDay('2026-10-19'), '2026-10-21'); // Mon -> Wed (Tue is Dussehra)
});

test('isConsecutive: no trading day may fall between the two days', () => {
  assert.equal(L.isConsecutive('2026-10-22', '2026-10-23'), true);
  assert.equal(L.isConsecutive('2026-10-23', '2026-10-26'), true); // over the weekend
  assert.equal(L.isConsecutive('2026-10-19', '2026-10-21'), true); // over a holiday
  assert.equal(L.isConsecutive('2026-10-21', '2026-10-23'), false); // Thursday in between
  assert.equal(L.isConsecutive('2026-10-23', '2026-10-27'), false); // Monday in between
  assert.equal(L.isConsecutive('2026-10-23', '2026-10-23'), false); // same day
  assert.equal(L.isConsecutive('2026-10-23', '2026-10-22'), false); // backwards
});

test('aliveThrough is the next trading day', () => {
  assert.equal(L.aliveThrough('2026-10-23'), '2026-10-26');
  assert.equal(L.aliveThrough('2026-10-22'), '2026-10-23');
  assert.equal(L.aliveThrough(null), null);
  assert.equal(L.aliveThrough('nope'), null);
});

test('offDaysAround lists weekends and holidays within a week of today', () => {
  const off = L.offDaysAround('2026-10-21');
  for (const d of ['2026-10-17', '2026-10-18', '2026-10-20', '2026-10-24', '2026-10-25']) {
    assert.ok(off.includes(d), `${d} should be off`);
  }
  for (const d of ['2026-10-19', '2026-10-21', '2026-10-22', '2026-10-23']) {
    assert.ok(!off.includes(d), `${d} should be a trading day`);
  }
  assert.deepEqual(L.offDaysAround('nope'), []);
});

// ── computeStreak ───────────────────────────────────────────────────────────
test('no active days: nothing to show', () => {
  const s = L.computeStreak([], '2026-10-22');
  assert.equal(s.current, 0);
  assert.equal(s.longest, 0);
  assert.equal(s.lastCheckIn, null);
  assert.equal(s.aliveThrough, null);
  assert.deepEqual(s.history, []);
  assert.equal(s.lostStreak, 0);
});

test('consecutive trading days build the streak; today counts', () => {
  const s = L.computeStreak(['2026-10-21', '2026-10-22', '2026-10-23'], '2026-10-23');
  assert.equal(s.current, 3);
  assert.equal(s.longest, 3);
  assert.equal(s.lastCheckIn, '2026-10-23');
});

test('the weekend does not break a streak: Friday then Monday is 2 in a row', () => {
  const s = L.computeStreak(['2026-10-22', '2026-10-23', '2026-10-26'], '2026-10-26');
  assert.equal(s.current, 3);
});

test('a market holiday does not break a streak: Monday then Wednesday is 2 in a row', () => {
  const s = L.computeStreak(['2026-10-19', '2026-10-21'], '2026-10-21');
  assert.equal(s.current, 2);
});

test('a streak stays alive through the weekend and Monday morning', () => {
  const days = ['2026-10-22', '2026-10-23'];
  assert.equal(L.computeStreak(days, '2026-10-24').current, 2); // Saturday
  assert.equal(L.computeStreak(days, '2026-10-25').current, 2); // Sunday
  assert.equal(L.computeStreak(days, '2026-10-26').current, 2); // Monday, not done yet
});

test('missing a trading day ends the streak (the record is kept)', () => {
  const days = ['2026-10-21', '2026-10-22', '2026-10-23'];
  const s = L.computeStreak(days, '2026-10-27'); // Monday 26th passed with nothing
  assert.equal(s.current, 0);
  assert.equal(s.longest, 3);
  assert.equal(s.lastCheckIn, '2026-10-23');
});

test('a gap restarts the run; longest remembers the best one', () => {
  const days = ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-22', '2026-10-23'];
  const s = L.computeStreak(days, '2026-10-23');
  assert.equal(s.current, 2);
  assert.equal(s.longest, 4);
});

test('lostStreak: today starting a new run reports the run it replaced', () => {
  const s = L.computeStreak(['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-23'], '2026-10-23');
  assert.equal(s.current, 1);
  assert.equal(s.lostStreak, 3);
});

test('lostStreak is 0 when the run simply continues, or the user is brand new', () => {
  assert.equal(L.computeStreak(['2026-10-22', '2026-10-23'], '2026-10-23').lostStreak, 0);
  assert.equal(L.computeStreak(['2026-10-23'], '2026-10-23').lostStreak, 0);
});

test('unordered, duplicate and invalid keys are cleaned up', () => {
  const s = L.computeStreak(['2026-10-23', 'nope', '2026-10-22', '2026-10-22', '2026-02-31'], '2026-10-23');
  assert.equal(s.current, 2);
  assert.deepEqual(s.history, ['2026-10-22', '2026-10-23']);
});

test('a day dated after today is ignored (clock skew can never inflate a streak)', () => {
  const s = L.computeStreak(['2026-10-22', '2026-10-23', '2026-10-26'], '2026-10-23');
  assert.equal(s.current, 2);
  assert.equal(s.lastCheckIn, '2026-10-23');
});

test('history is capped to the most recent HISTORY_LIMIT days', () => {
  const days = [];
  for (let i = 0; i < L.HISTORY_LIMIT + 50; i++) days.push(L.shiftKey('2025-01-01', i));
  const today = days[days.length - 1];
  const s = L.computeStreak(days, today);
  assert.equal(s.history.length, L.HISTORY_LIMIT);
  assert.equal(s.history[s.history.length - 1], today);
  assert.equal(s.current, L.HISTORY_LIMIT + 50); // the streak itself is not capped
});

// ── acceptableImportDays ────────────────────────────────────────────────────
test('import: only real days strictly before today and inside the window', () => {
  const today = '2026-10-22';
  const oldest = L.shiftKey(today, -L.HISTORY_LIMIT);
  const offered = [
    '2026-10-20',
    '2026-10-21',
    '2026-10-22', // today: the server records it itself
    '2026-10-23', // the future
    '2026-02-31', // not a date
    'garbage',
    oldest,
    L.shiftKey(oldest, -1), // too old
  ];
  assert.deepEqual(L.acceptableImportDays(offered, today), [oldest, '2026-10-20', '2026-10-21']);
});

test('import: non-arrays and a bad "today" yield nothing', () => {
  assert.deepEqual(L.acceptableImportDays('2026-10-20', '2026-10-22'), []);
  assert.deepEqual(L.acceptableImportDays(['2026-10-20'], 'nope'), []);
});

// ── the service, against an in-memory repository ────────────────────────────
// Mirrors the table: one row per (user, day); import only adds missing days.
function fakeRepo() {
  const rows = new Map(); // userId -> Map(day -> source)
  const of = (u) => rows.get(u) || rows.set(u, new Map()).get(u);
  return {
    rows,
    getDays: async (u) => [...of(u).keys()].sort(),
    recordCheckIn: async (u, day) => {
      if (of(u).has(day)) return false;
      of(u).set(day, 'live');
      return true;
    },
    hasDaysBefore: async (u, day) => [...of(u).keys()].some((d) => d < day),
    importDays: async (u, days) => {
      let n = 0;
      for (const d of days) if (!of(u).has(d)) { of(u).set(d, 'import'); n++; }
      return n;
    },
  };
}

// Total days recorded across all users (reading must not count as recording).
const recorded = (repo) => [...repo.rows.values()].reduce((n, m) => n + m.size, 0);

const setup = () => {
  const repo = fakeRepo();
  return { repo, svc: createStreakService(repo) };
};

test('service: the first order of the day starts a streak and is a new day', async () => {
  const { svc } = setup();
  const r = await svc.recordActivity('u1', 'order', { now: ist('2026-10-22') });
  assert.equal(r.isNewDay, true);
  assert.equal(r.current, 1);
  assert.equal(r.today, '2026-10-22');
});

test('service: a Nifty call counts the same as an order', async () => {
  const { svc } = setup();
  const r = await svc.recordActivity('u1', 'nifty', { now: ist('2026-10-22', '09:30') });
  assert.equal(r.isNewDay, true);
  assert.equal(r.current, 1);
});

test('service: an unknown source is refused (only real activity earns a day)', async () => {
  const { svc, repo } = setup();
  await assert.rejects(() => svc.recordActivity('u1', 'open', { now: ist('2026-10-22') }), /Unknown streak source/);
  await assert.rejects(() => svc.recordActivity('u1', undefined, { now: ist('2026-10-22') }), /Unknown streak source/);
  assert.equal(recorded(repo), 0);
});

test('service: several orders, plus a call, in one day count once', async () => {
  const { svc } = setup();
  const a = await svc.recordActivity('u1', 'nifty', { now: ist('2026-10-22', '09:30') });
  const b = await svc.recordActivity('u1', 'order', { now: ist('2026-10-22', '11:00') });
  const c = await svc.recordActivity('u1', 'order', { now: ist('2026-10-22', '14:00') });
  assert.equal(a.isNewDay, true);
  assert.equal(b.isNewDay, false);
  assert.equal(c.isNewDay, false);
  assert.equal(c.current, 1);
});

test('service: getState alone never earns a day (opening the app does nothing)', async () => {
  const { svc, repo } = setup();
  const r = await svc.getState('u1', { now: ist('2026-10-22') });
  assert.equal(r.current, 0);
  assert.equal(r.isNewDay, false);
  assert.equal(recorded(repo), 0);
});

test('service: the streak builds across days, over a weekend, and survives a redeploy', async () => {
  const { svc } = setup();
  await svc.recordActivity('u1', 'order', { now: ist('2026-10-22') }); // Thu
  await svc.recordActivity('u1', 'nifty', { now: ist('2026-10-23', '09:30') }); // Fri
  // Monday, on a brand new install: the server remembers.
  const r = await svc.recordActivity('u1', 'order', { now: ist('2026-10-26') });
  assert.equal(r.current, 3);
  assert.equal(r.longest, 3);
  assert.deepEqual(r.history, ['2026-10-22', '2026-10-23', '2026-10-26']);
});

test('service: reading on Saturday still shows the streak', async () => {
  const { svc } = setup();
  await svc.recordActivity('u1', 'order', { now: ist('2026-10-22') });
  await svc.recordActivity('u1', 'order', { now: ist('2026-10-23') });
  const r = await svc.getState('u1', { now: ist('2026-10-24') });
  assert.equal(r.current, 2);
  assert.equal(r.aliveThrough, '2026-10-26');
});

test('service: missing a trading day ends it, and the next activity reports what was lost', async () => {
  const { svc } = setup();
  await svc.recordActivity('u1', 'order', { now: ist('2026-10-21') });
  await svc.recordActivity('u1', 'order', { now: ist('2026-10-22') });
  const r = await svc.recordActivity('u1', 'order', { now: ist('2026-10-27') }); // skipped Fri + Mon
  assert.equal(r.current, 1);
  assert.equal(r.lostStreak, 2);
  assert.equal(r.longest, 2);
});

test('service: the day follows IST, not UTC (00:10 IST is already the new day)', async () => {
  const { svc } = setup();
  await svc.recordActivity('u1', 'order', { now: ist('2026-10-22', '23:50') });
  const r = await svc.recordActivity('u1', 'order', { now: ist('2026-10-23', '00:10') });
  assert.equal(r.today, '2026-10-23');
  assert.equal(r.current, 2);
});

test('service: users are separate', async () => {
  const { svc } = setup();
  await svc.recordActivity('u1', 'order', { now: ist('2026-10-22') });
  await svc.recordActivity('u1', 'order', { now: ist('2026-10-23') });
  const other = await svc.recordActivity('u2', 'order', { now: ist('2026-10-23') });
  assert.equal(other.current, 1);
});

test('service: the old on-device streak is imported once and records nothing for today', async () => {
  const { svc, repo } = setup();
  const r = await svc.importLegacy('u1', ['2026-10-21', '2026-10-22'], { now: ist('2026-10-23') });
  assert.equal(r.current, 2); // alive: Thursday was yesterday
  assert.equal(r.isNewDay, false);
  assert.equal(repo.rows.get('u1').get('2026-10-22'), 'import');
  assert.equal(repo.rows.get('u1').has('2026-10-23'), false); // today still has to be earned
});

test('service: after an import, today\'s order continues the imported streak', async () => {
  const { svc } = setup();
  await svc.importLegacy('u1', ['2026-10-21', '2026-10-22'], { now: ist('2026-10-23') });
  const r = await svc.recordActivity('u1', 'order', { now: ist('2026-10-23') });
  assert.equal(r.current, 3);
  assert.equal(r.lostStreak, 0);
});

test('service: import is refused once the account has earlier days (no later padding)', async () => {
  const { svc } = setup();
  await svc.recordActivity('u1', 'order', { now: ist('2026-10-22') });
  const r = await svc.importLegacy('u1', ['2026-09-01', '2026-09-02', '2026-10-21'], { now: ist('2026-10-23') });
  assert.deepEqual(r.history, ['2026-10-22']); // the offered days were ignored
});

test('service: an import cannot claim today or the future', async () => {
  const { svc, repo } = setup();
  const r = await svc.importLegacy('u1', ['2026-10-22', '2026-10-23', '2026-11-01'], { now: ist('2026-10-22') });
  assert.equal(r.current, 0);
  assert.equal(recorded(repo), 0);
});
