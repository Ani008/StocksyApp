// Stock of the Day — the rules (no database, no Redis, no real clock).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const L = require('../services/stockOfTheDayLogic');
const REAL_INSTRUMENTS = require('../config/instruments');

const DAY = '2026-10-23';

// ── fixtures ────────────────────────────────────────────────────────────────
// A stock's fundamentals the way the snapshot has them.
const fund = ({ mcap, pe, pb, yearly }) => ({
  metrics: { market_cap: mcap, pe_ratio: pe, pb_ratio: pb },
  financials: {
    yearly: (yearly || []).map(([period, revenue, profit]) => ({ period: String(period), revenue, profit })),
  },
});

// Four stocks whose numbers differ a lot on every measure, so every question
// is valid for every pair.
const SPREAD = {
  AAA: fund({ mcap: 1000, pe: 10, pb: 1, yearly: [[2024, 100, 5], [2025, 110, 5.5]] }), // margin 5%,  rev +10%, profit +10%
  BBB: fund({ mcap: 2000, pe: 20, pb: 2, yearly: [[2024, 200, 20], [2025, 240, 26]] }), // margin ~11%, rev +20%, profit +30%
  CCC: fund({ mcap: 4000, pe: 40, pb: 4, yearly: [[2024, 400, 60], [2025, 560, 100]] }), // margin ~18%, rev +40%, profit +67%
  DDD: fund({ mcap: 8000, pe: 80, pb: 8, yearly: [[2024, 800, 160], [2025, 1440, 420]] }), // margin ~29%, rev +80%, profit +163%
};
const snapshotOf = (stocks) => ({ stocks });
const instrumentsOf = (symbols, sector = 'Test') =>
  Object.fromEntries(symbols.map((s) => [`NSE_EQ|${s}`, { symbol: s, name: `${s} Ltd`, sector }]));
const ctx = { sector: 'Test', currentYear: 2026 };
const q = (id) => L.QUESTION_BY_ID[id];

// ── seeded random ───────────────────────────────────────────────────────────
test('seededRandom: same seed same stream, different seed differs', () => {
  const a = L.seededRandom('x'), b = L.seededRandom('x'), c = L.seededRandom('y');
  const sa = [a(), a(), a()], sb = [b(), b(), b()], sc = [c(), c(), c()];
  assert.deepEqual(sa, sb);
  assert.notDeepEqual(sa, sc);
  for (const n of sa) assert.ok(n >= 0 && n < 1);
});

// ── the question set ────────────────────────────────────────────────────────
test('questions: dividend and debt are switched off, the reliable six are on', () => {
  assert.deepEqual(L.QUESTIONS.map((x) => x.id).sort(), ['margin', 'pb', 'pe', 'profit_growth', 'revenue_growth', 'valuation']);
  assert.deepEqual(L.DISABLED_QUESTIONS.map((x) => x.id).sort(), ['debt', 'dividend']);
});

test('questions: wording is neutral, never "who is better"', () => {
  for (const x of L.QUESTIONS) assert.doesNotMatch(x.text, /\b(better|best|worse|worst)\b/i, x.id);
});

// ── judging a pair ──────────────────────────────────────────────────────────
test('judge: the bigger number wins, whichever side it is on', () => {
  const ab = L.judge(q('valuation'), SPREAD.AAA, SPREAD.DDD, ctx);
  const ba = L.judge(q('valuation'), SPREAD.DDD, SPREAD.AAA, ctx);
  assert.equal(ab.winnerSide, 'right');
  assert.equal(ba.winnerSide, 'left');
  assert.equal(ab.rightValue, 8000);
  assert.equal(ba.leftValue, 8000);
});

test('judge: a near-tie is not asked (relative gap too small)', () => {
  const a = fund({ mcap: 100000, pe: 20, pb: 2 });
  const b = fund({ mcap: 105000, pe: 20, pb: 2 }); // 4.8% apart
  assert.equal(L.judge(q('valuation'), a, b, ctx), null);
});

test('judge: a tiny absolute gap is not asked even if the relative gap is big', () => {
  const a = fund({ pe: 5.0 });
  const b = fund({ pe: 6.0 }); // 17% apart but only 1.0 of P/E (< 1.5)
  assert.equal(L.judge(q('pe'), a, b, ctx), null);
  assert.notEqual(L.judge(q('pe'), fund({ pe: 5.0 }), fund({ pe: 8.0 }), ctx), null);
});

test('judge: missing or nonsense data means no question, never a guess', () => {
  assert.equal(L.judge(q('valuation'), SPREAD.AAA, fund({ mcap: null }), ctx), null);
  assert.equal(L.judge(q('valuation'), SPREAD.AAA, undefined, ctx), null);
  assert.equal(L.judge(q('pe'), SPREAD.AAA, fund({ pe: -12 }), ctx), null); // loss-maker
  assert.equal(L.judge(q('pe'), SPREAD.AAA, fund({ pe: 0 }), ctx), null);
  assert.equal(L.judge(q('pb'), SPREAD.AAA, fund({ pb: 'abc' }), ctx), null);
});

// ── year-based questions ────────────────────────────────────────────────────
test('margin: compares profit / sales for the same fiscal year', () => {
  const j = L.judge(q('margin'), SPREAD.AAA, SPREAD.DDD, ctx);
  assert.equal(j.year, 2025);
  assert.equal(j.winnerSide, 'right');
  assert.ok(Math.abs(j.leftValue - 5) < 1e-9);
});

test('year guard: companies whose latest year differs are not compared', () => {
  const tcsLike = fund({ yearly: [[2024, 100, 10], [2025, 110, 11]] });
  const infyLike = fund({ yearly: [[2025, 100, 30], [2026, 120, 40]] });
  assert.equal(L.judge(q('margin'), tcsLike, infyLike, ctx), null);
  assert.equal(L.judge(q('revenue_growth'), tcsLike, infyLike, ctx), null);
});

test('stale guard: a latest year more than 2 years old counts as missing', () => {
  const stale = fund({ yearly: [[2022, 100, 10], [2023, 120, 14]] });
  const fresh = fund({ yearly: [[2022, 100, 30], [2023, 120, 20]] });
  assert.equal(L.judge(q('margin'), stale, fresh, ctx), null);
  // the same data is fine when it is recent relative to the date
  assert.notEqual(L.judge(q('margin'), stale, fresh, { ...ctx, currentYear: 2024 }), null);
});

test('order guard: yearly rows out of order still use the true latest year', () => {
  const messy = fund({ yearly: [[2024, 70, 20], [2025, 78, 20], [2021, 81, 21]] }); // feed order is not trusted
  assert.deepEqual(L.yearlySeries(messy).map((r) => r.year), [2021, 2024, 2025]);
  const other = fund({ yearly: [[2024, 100, 5], [2025, 100, 5]] });
  const j = L.judge(q('margin'), messy, other, ctx);
  assert.equal(j.year, 2025);
});

test('growth: needs two CONSECUTIVE years', () => {
  const gap = fund({ yearly: [[2022, 100, 10], [2025, 200, 40]] });
  const ok = fund({ yearly: [[2024, 100, 10], [2025, 105, 11]] });
  assert.equal(L.judge(q('revenue_growth'), gap, ok, ctx), null);
});

test('growth: a merger-sized jump is not "growth"', () => {
  const merger = fund({ yearly: [[2024, 200, 20], [2025, 460, 46]] }); // +130% ok, below the cap
  const bigger = fund({ yearly: [[2024, 200, 20], [2025, 520, 52]] }); // +160% over the 150% cap
  const normal = fund({ yearly: [[2024, 100, 10], [2025, 105, 10.5]] });
  assert.notEqual(L.judge(q('revenue_growth'), merger, normal, ctx), null);
  assert.equal(L.judge(q('revenue_growth'), bigger, normal, ctx), null);
});

test('profit growth: growth from a loss is meaningless, so it is not asked', () => {
  const fromLoss = fund({ yearly: [[2024, 100, -10], [2025, 120, 15]] });
  const normal = fund({ yearly: [[2024, 100, 10], [2025, 105, 11]] });
  assert.equal(L.judge(q('profit_growth'), fromLoss, normal, ctx), null);
});

test('growth: "who grew faster" is not asked when both shrank', () => {
  const a = fund({ yearly: [[2024, 100, 20], [2025, 90, 15.6]] }); // profit -22%
  const b = fund({ yearly: [[2024, 100, 20], [2025, 95, 17.2]] }); // profit -14%
  assert.equal(L.judge(q('profit_growth'), a, b, ctx), null);
  const grew = fund({ yearly: [[2024, 100, 20], [2025, 110, 24]] }); // +20%
  assert.notEqual(L.judge(q('profit_growth'), a, grew, ctx), null);
});

// ── grouping ────────────────────────────────────────────────────────────────
test('groupBySector: equities only, sectors need at least 4 stocks', () => {
  const inst = {
    'NSE_INDEX|Nifty 50': { symbol: 'NIFTY 50', name: 'Nifty', sector: 'Index' },
    ...instrumentsOf(['A', 'B', 'C', 'D'], 'Four'),
    ...instrumentsOf(['E', 'F', 'G'], 'Three'),
  };
  assert.deepEqual(Object.keys(L.groupBySector(inst)), ['Four']);
});

// ── building a day ──────────────────────────────────────────────────────────
const SPREAD_INST = instrumentsOf(['AAA', 'BBB', 'CCC', 'DDD']);
const build = (dateKey = DAY, fundamentals = snapshotOf(SPREAD), instruments = SPREAD_INST) =>
  L.buildDay({ instruments, fundamentals, dateKey });

test('buildDay: a full day of 5 rounds with the right shape', () => {
  const day = build();
  assert.equal(day.rounds.length, L.ROUNDS_PER_DAY);
  assert.equal(day.sector, 'Test');
  day.rounds.forEach((r, i) => {
    assert.equal(r.index, i);
    assert.ok(r.left.key && r.right.key && r.left.key !== r.right.key);
    assert.ok([r.left.key, r.right.key].includes(r.winnerKey));
  });
});

test('buildDay: the winner of every round really has the bigger number', () => {
  for (const r of build().rounds) {
    const winnerValue = r.winnerKey === r.left.key ? r.leftValue : r.rightValue;
    const loserValue = r.winnerKey === r.left.key ? r.rightValue : r.leftValue;
    assert.ok(winnerValue > loserValue, r.questionId);
  }
});

test('buildDay: ONE pair, on the same sides, for every round of the day', () => {
  for (let d = 1; d <= 30; d++) {
    const day = build(`2026-11-${String(d).padStart(2, '0')}`);
    const first = day.rounds[0];
    for (const r of day.rounds) {
      assert.equal(r.left.key, first.left.key, 'left logo changed mid-game');
      assert.equal(r.right.key, first.right.key, 'right logo changed mid-game');
    }
  }
});

test('buildDay: no question twice, no theme more than twice', () => {
  for (let d = 1; d <= 30; d++) {
    const day = build(`2026-11-${String(d).padStart(2, '0')}`);
    const ids = day.rounds.map((r) => r.questionId);
    assert.equal(new Set(ids).size, ids.length, 'question repeated');
    const themes = {};
    day.rounds.forEach((r) => { themes[r.theme] = (themes[r.theme] || 0) + 1; });
    assert.ok(Math.max(...Object.values(themes)) <= L.MAX_QUESTIONS_PER_THEME, 'theme over cap');
  }
});

// Two pairs: AAA/BBB is a clean sweep (BBB bigger on everything), CCC/DDD is mixed
// (each wins some). Names are chosen so we can tell which pair the day used.
const MIXED = {
  CCC: fund({ mcap: 1000, pe: 10, pb: 4, yearly: [[2024, 100, 5], [2025, 110, 5.5]] }),
  DDD: fund({ mcap: 2000, pe: 30, pb: 1, yearly: [[2024, 200, 40], [2025, 240, 60]] }),
};
const pairOf = (day) => [day.rounds[0].left.symbol, day.rounds[0].right.symbol].sort().join('~');

test('buildDay: prefers a pair where each company wins something over a clean sweep', () => {
  const snapshot = snapshotOf({
    AAA: SPREAD.AAA, BBB: SPREAD.BBB, // sweep pair (BBB wins all)
    CCC: MIXED.CCC, DDD: MIXED.DDD,   // mixed pair
  });
  const inst = instrumentsOf(['AAA', 'BBB', 'CCC', 'DDD']);
  let usedSweep = 0, usedMixed = 0;
  for (let d = 1; d <= 40; d++) {
    const day = build(`2026-11-${String(d).padStart(2, '0')}`, snapshot, inst);
    assert.equal(day.rounds.length, 5);
    // Only a pair that can carry 5 questions counts; the cross pairs mix SPREAD and MIXED numbers.
    const winners = new Set(day.rounds.map((r) => r.winnerKey));
    if (winners.size === 1) usedSweep++; else usedMixed++;
  }
  assert.equal(usedSweep, 0, 'a sweeping pair was used although a mixed one existed');
  assert.ok(usedMixed > 0);
});

test('buildDay: when only sweeping pairs exist, a full day still runs (sweep beats no game)', () => {
  const day = build(DAY); // SPREAD: the bigger company wins every question in every pair
  assert.equal(day.rounds.length, 5);
  assert.equal(new Set(day.rounds.map((r) => r.winnerKey)).size, 1);
});

test('buildDay: same date gives the same day, different dates differ', () => {
  assert.deepEqual(build(DAY), build(DAY));
  const shapes = new Set();
  for (let d = 1; d <= 20; d++) shapes.add(JSON.stringify(build(`2026-11-${String(d).padStart(2, '0')}`).rounds.map((r) => r.questionId + r.winnerKey)));
  assert.ok(shapes.size > 5);
});

test('buildDay: the winner is not stuck on one side', () => {
  let left = 0, right = 0;
  for (let d = 1; d <= 40; d++) {
    for (const r of build(`2026-11-${String(d).padStart(2, '0')}`).rounds) {
      if (r.winnerKey === r.left.key) left++; else right++;
    }
  }
  const share = left / (left + right);
  assert.ok(share > 0.35 && share < 0.65, `left share ${share}`);
});

test('buildDay: no data, no day', () => {
  assert.equal(build(DAY, snapshotOf({})), null);
  assert.equal(build(DAY, null), null);
  assert.equal(L.buildDay({ instruments: {}, fundamentals: snapshotOf(SPREAD), dateKey: DAY }), null);
});

test('buildDay: thin data gives a shorter day, but never fewer than 3 rounds', () => {
  // Only market cap exists -> only the "valuation" question can be asked.
  const onlyMcap = Object.fromEntries(Object.entries(SPREAD).map(([k, v]) => [k, { metrics: { market_cap: v.metrics.market_cap }, financials: {} }]));
  assert.equal(build(DAY, snapshotOf(onlyMcap)), null);

  // Market cap + P/E + P/B -> 3 questions -> a 3-round day.
  const three = Object.fromEntries(Object.entries(SPREAD).map(([k, v]) => [k, { metrics: v.metrics, financials: {} }]));
  const day = build(DAY, snapshotOf(three));
  assert.equal(day.rounds.length, 3);
});

test('buildDay: a stock with no fundamentals is simply never asked about', () => {
  const inst = instrumentsOf(['AAA', 'BBB', 'CCC', 'DDD', 'GHOST']);
  const day = build(DAY, snapshotOf(SPREAD), inst); // GHOST has no entry
  for (const r of day.rounds) {
    assert.notEqual(r.left.symbol, 'GHOST');
    assert.notEqual(r.right.symbol, 'GHOST');
  }
});

// ── the real data ───────────────────────────────────────────────────────────
const SNAPSHOT_PATH = path.join(__dirname, '..', '..', 'backend_py', 'fundamentals_snapshot.json');
const hasSnapshot = fs.existsSync(SNAPSHOT_PATH);

test('real data: every day for 90 days is a full, internally consistent day', { skip: !hasSnapshot && 'snapshot not in this checkout' }, () => {
  const snapshot = JSON.parse(fs.readFileSync(SNAPSHOT_PATH, 'utf8'));
  const start = Date.parse('2026-10-23T12:00:00Z');
  for (let d = 0; d < 90; d++) {
    const dateKey = new Date(start + d * 86400000).toISOString().slice(0, 10);
    const day = L.buildDay({ instruments: REAL_INSTRUMENTS, fundamentals: snapshot, dateKey });
    assert.ok(day, `no day on ${dateKey}`);
    assert.equal(day.rounds.length, L.ROUNDS_PER_DAY, `short day on ${dateKey}`);
    for (const r of day.rounds) {
      assert.equal(r.left.key, day.rounds[0].left.key, `pair changed mid-game on ${dateKey}`);
      assert.equal(r.right.key, day.rounds[0].right.key, `pair changed mid-game on ${dateKey}`);
      const sectorOf = (k) => REAL_INSTRUMENTS[k].sector;
      assert.equal(sectorOf(r.left.key), day.sector);
      assert.equal(sectorOf(r.right.key), day.sector);
      const hi = Math.max(r.leftValue, r.rightValue), lo = Math.min(r.leftValue, r.rightValue);
      assert.equal(r.winnerKey, r.leftValue > r.rightValue ? r.left.key : r.right.key);
      assert.ok((hi - lo) / Math.max(Math.abs(hi), Math.abs(lo)) >= L.MIN_RELATIVE_GAP, `near-tie on ${dateKey}`);
      if (r.unit === 'pct') assert.ok(Math.abs(r.leftValue) <= 300 && Math.abs(r.rightValue) <= 300);
    }
  }
});

// ── what the user may see ───────────────────────────────────────────────────
test('viewDay: no winners or numbers until every round is answered', () => {
  const day = build();
  const answers = [{ roundIndex: 0, pickedKey: day.rounds[0].left.key }, { roundIndex: 1, pickedKey: day.rounds[1].right.key }];
  const view = L.viewDay(day, answers);
  assert.equal(view.complete, false);
  assert.equal(view.answered, 2);
  assert.equal(view.result, null);
  const text = JSON.stringify(view);
  assert.doesNotMatch(text, /winnerKey|leftValue|rightValue|fiscalYear/);
  assert.equal(view.rounds[0].pickedKey, day.rounds[0].left.key);
  assert.equal(view.rounds[2].pickedKey, null);
});

test('viewDay: the finished day scores each round against its own winner', () => {
  const day = build();
  // Pick the winner in the first 3 rounds, the loser in the last 2.
  const answers = day.rounds.map((r) => {
    const loser = r.winnerKey === r.left.key ? r.right.key : r.left.key;
    return { roundIndex: r.index, pickedKey: r.index < 3 ? r.winnerKey : loser };
  });
  const view = L.viewDay(day, answers);
  assert.equal(view.complete, true);
  assert.equal(view.result.score, 3);
  assert.equal(view.result.total, 5);
  assert.deepEqual(view.result.rounds.map((r) => r.correct), [true, true, true, false, false]);
  assert.ok(view.result.rounds.every((r) => typeof r.leftValue === 'number' && r.winnerKey && r.label));
});

test('viewDay: a perfect score and a zero score both work', () => {
  const day = build();
  const all = (pickWinner) => day.rounds.map((r) => ({
    roundIndex: r.index,
    pickedKey: pickWinner ? r.winnerKey : (r.winnerKey === r.left.key ? r.right.key : r.left.key),
  }));
  assert.equal(L.viewDay(day, all(true)).result.score, 5);
  assert.equal(L.viewDay(day, all(false)).result.score, 0);
});

test('validatePick: only a real round and one of its two companies', () => {
  const day = build();
  const r0 = day.rounds[0];
  assert.equal(L.validatePick(day, 0, r0.left.key), null);
  assert.equal(L.validatePick(day, 0, r0.right.key), null);
  assert.equal(L.validatePick(day, 0, 'NSE_EQ|NOPE'), 'BAD_PICK');
  assert.equal(L.validatePick(day, 0, undefined), 'BAD_PICK');
  assert.equal(L.validatePick(day, -1, r0.left.key), 'BAD_ROUND');
  assert.equal(L.validatePick(day, 5, r0.left.key), 'BAD_ROUND');
  assert.equal(L.validatePick(day, 1.5, r0.left.key), 'BAD_ROUND');
  assert.equal(L.validatePick(day, '0', r0.left.key), 'BAD_ROUND');
});
