// Daily streak saved on the server — the rules and the service (no database,
// no Redis, no real clock; the repository is an in-memory stand-in).
const test = require('node:test');
const assert = require('node:assert/strict');

const L = require('../services/streakLogic');
const { createStreakService } = require('../services/streakService');

// IST helper: ist('2026-10-22', '23:59') -> Date
const ist = (d, hhmm = '12:00') => new Date(`${d}T${hhmm}:00+05:30`);

// ── date helpers ────────────────────────────────────────────────────────────
test('istDateKey uses the IST calendar day, not UTC', () => {
  // 00:30 IST on the 22nd is still the 21st in UTC.
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

// ── computeStreak ───────────────────────────────────────────────────────────
test('no check-ins: nothing to show', () => {
  assert.deepEqual(L.computeStreak([], '2026-10-22'), {
    current: 0,
    longest: 0,
    lastCheckIn: null,
    history: [],
  });
});

test('consecutive days build the streak; today counts', () => {
  const s = L.computeStreak(['2026-10-20', '2026-10-21', '2026-10-22'], '2026-10-22');
  assert.equal(s.current, 3);
  assert.equal(s.longest, 3);
  assert.equal(s.lastCheckIn, '2026-10-22');
});

test('a streak is still alive on the morning after (last check-in = yesterday)', () => {
  const s = L.computeStreak(['2026-10-20', '2026-10-21'], '2026-10-22');
  assert.equal(s.current, 2);
});

test('a streak whose last check-in is older than yesterday has ended', () => {
  const s = L.computeStreak(['2026-10-18', '2026-10-19', '2026-10-20'], '2026-10-22');
  assert.equal(s.current, 0);
  assert.equal(s.longest, 3); // the record is kept
  assert.equal(s.lastCheckIn, '2026-10-20');
});

test('a gap restarts the run; longest remembers the best one', () => {
  const days = ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-20', '2026-10-21'];
  const s = L.computeStreak(days, '2026-10-21');
  assert.equal(s.current, 2);
  assert.equal(s.longest, 4);
});

test('unordered, duplicate and invalid keys are cleaned up', () => {
  const s = L.computeStreak(['2026-10-22', 'nope', '2026-10-21', '2026-10-21', '2026-02-31'], '2026-10-22');
  assert.equal(s.current, 2);
  assert.deepEqual(s.history, ['2026-10-21', '2026-10-22']);
});

test('a day dated after today is ignored (clock skew can never inflate a streak)', () => {
  const s = L.computeStreak(['2026-10-21', '2026-10-22', '2026-10-23'], '2026-10-22');
  assert.equal(s.current, 2);
  assert.equal(s.lastCheckIn, '2026-10-22');
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

// ── lostStreakFor ───────────────────────────────────────────────────────────
test('lostStreakFor: continuing a streak loses nothing', () => {
  assert.equal(L.lostStreakFor(['2026-10-20', '2026-10-21'], '2026-10-22'), 0);
});

test('lostStreakFor: returns the length of the run that just ended', () => {
  assert.equal(L.lostStreakFor(['2026-10-17', '2026-10-18', '2026-10-19'], '2026-10-22'), 3);
});

test('lostStreakFor: first ever check-in has nothing to lose; today is never "prior"', () => {
  assert.equal(L.lostStreakFor([], '2026-10-22'), 0);
  assert.equal(L.lostStreakFor(['2026-10-22'], '2026-10-22'), 0);
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

const setup = () => {
  const repo = fakeRepo();
  return { repo, svc: createStreakService(repo) };
};

test('service: first check-in starts a streak of 1 and is a new day', async () => {
  const { svc } = setup();
  const r = await svc.checkIn('u1', { now: ist('2026-10-20') });
  assert.equal(r.isNewDay, true);
  assert.equal(r.current, 1);
  assert.equal(r.today, '2026-10-20');
  assert.equal(r.lostStreak, 0);
});

test('service: opening twice in a day (two devices, a retry) counts once', async () => {
  const { svc } = setup();
  const a = await svc.checkIn('u1', { now: ist('2026-10-20', '09:00') });
  const b = await svc.checkIn('u1', { now: ist('2026-10-20', '21:00') });
  assert.equal(a.isNewDay, true);
  assert.equal(b.isNewDay, false);
  assert.equal(b.current, 1);
});

test('service: consecutive days grow the streak and it survives a "redeploy"', async () => {
  const { svc } = setup();
  await svc.checkIn('u1', { now: ist('2026-10-20') });
  await svc.checkIn('u1', { now: ist('2026-10-21') });
  // A brand new install / new origin has nothing local, but the server remembers.
  const r = await svc.checkIn('u1', { now: ist('2026-10-22'), importDays: [] });
  assert.equal(r.current, 3);
  assert.equal(r.longest, 3);
  assert.deepEqual(r.history, ['2026-10-20', '2026-10-21', '2026-10-22']);
});

test('service: missing a day reports the streak that was lost', async () => {
  const { svc } = setup();
  await svc.checkIn('u1', { now: ist('2026-10-18') });
  await svc.checkIn('u1', { now: ist('2026-10-19') });
  const r = await svc.checkIn('u1', { now: ist('2026-10-22') });
  assert.equal(r.current, 1);
  assert.equal(r.lostStreak, 2);
  assert.equal(r.longest, 2);
});

test('service: the day follows IST, not UTC (00:10 IST is already the new day)', async () => {
  const { svc } = setup();
  await svc.checkIn('u1', { now: ist('2026-10-21', '23:50') });
  const r = await svc.checkIn('u1', { now: ist('2026-10-22', '00:10') });
  assert.equal(r.today, '2026-10-22');
  assert.equal(r.current, 2);
});

test('service: users are separate', async () => {
  const { svc } = setup();
  await svc.checkIn('u1', { now: ist('2026-10-21') });
  await svc.checkIn('u1', { now: ist('2026-10-22') });
  const other = await svc.checkIn('u2', { now: ist('2026-10-22') });
  assert.equal(other.current, 1);
});

test('service: getState reads without recording a day', async () => {
  const { svc, repo } = setup();
  await svc.checkIn('u1', { now: ist('2026-10-21') });
  const r = await svc.getState('u1', { now: ist('2026-10-22') });
  assert.equal(r.current, 1);
  assert.equal(r.isNewDay, false);
  assert.equal(repo.rows.get('u1').size, 1); // nothing was added
});

test('service: the old on-device streak is imported once, on the first sync', async () => {
  const { svc, repo } = setup();
  const local = ['2026-10-20', '2026-10-21'];
  const r = await svc.checkIn('u1', { now: ist('2026-10-22'), importDays: local });
  assert.equal(r.current, 3); // 20th, 21st (imported) + 22nd (live)
  assert.equal(r.isNewDay, true);
  assert.equal(r.lostStreak, 0);
  assert.equal(repo.rows.get('u1').get('2026-10-21'), 'import');
  assert.equal(repo.rows.get('u1').get('2026-10-22'), 'live');
});

test('service: import is refused once the account has earlier days (no later padding)', async () => {
  const { svc } = setup();
  await svc.checkIn('u1', { now: ist('2026-10-21') }); // first sync, nothing to import
  const r = await svc.checkIn('u1', {
    now: ist('2026-10-22'),
    importDays: ['2026-09-01', '2026-09-02', '2026-09-03', '2026-10-20'],
  });
  assert.equal(r.current, 2); // 21st + 22nd only: the offered days were ignored
  assert.deepEqual(r.history, ['2026-10-21', '2026-10-22']);
});

test('service: an import cannot claim today or the future', async () => {
  const { svc, repo } = setup();
  const r = await svc.checkIn('u1', {
    now: ist('2026-10-22'),
    importDays: ['2026-10-22', '2026-10-23', '2026-11-01'],
  });
  assert.equal(r.current, 1);
  assert.equal(repo.rows.get('u1').size, 1);
  assert.equal(repo.rows.get('u1').get('2026-10-22'), 'live');
});
