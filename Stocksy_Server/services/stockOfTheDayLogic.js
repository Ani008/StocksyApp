/**
 * services/stockOfTheDayLogic.js
 *
 * The rules of "Stock of the Day": which sector, which pairs, which questions,
 * and who the winner of each question is. Pure functions only (no database, no
 * Redis, no clock), so every rule here is unit-tested.
 *
 * HOW WINNERS ARE DECIDED (and why it is meant to be fair)
 *
 *  1. Every question is ONE factual comparison on ONE number, worded neutrally
 *     ("who has the higher P/E"), never "who is better". The bigger number wins.
 *     Nothing is blended into a score, so there is no hidden weighting.
 *  2. A day has up to ROUNDS_PER_DAY questions. Each question is asked at most
 *     once a day and no theme (size, price, profitability, growth) is asked
 *     more than twice, so no single kind of number can decide the day. The
 *     result is simply "3 out of 5", every question counting the same.
 *  3. A question is only asked about a pair when BOTH companies have trustworthy
 *     data for it and the gap is clear (not a near-tie). If not, another
 *     question or pair is used instead of guessing.
 *  4. Anything that would compare apples to oranges is refused:
 *       - year-based numbers (margin, growth) need BOTH companies' latest
 *         reported year to be the same year, and recent;
 *       - debt-to-equity is not asked about banks / lenders (their debt is
 *         their business);
 *       - values that are obviously wrong in the data feed are dropped.
 *     Raw per-share numbers (EPS, book value) are never compared across
 *     companies, because share counts differ and the comparison is meaningless.
 *  5. Only fields that have been checked against each other are used. Dividend
 *     yield and debt-to-equity are switched off (see DISABLED_QUESTIONS): the
 *     fundamentals feed mixes units in them, and a confidently wrong answer is
 *     worse than no question.
 *
 * Everything is seeded by the IST date, so every user gets the same day.
 */

const ROUNDS_PER_DAY = 5;
// If a day cannot be built to the full length, it may be shorter, but never
// shorter than this. Below it there is no day.
const MIN_ROUNDS = 3;
// A sector needs this many stocks to give enough distinct pairs.
const MIN_STOCKS_PER_SECTOR = 4;
// One stock may appear in at most this many of a day's rounds (variety).
const MAX_APPEARANCES_PER_STOCK = 3;
// No theme (size / price / profitability / growth) more than this often a day.
const MAX_QUESTIONS_PER_THEME = 2;
// Yearly figures older than this many years are treated as missing.
const MAX_STALE_YEARS = 2;
// A winner must lead by at least this fraction of the larger value, AND by the
// question's own minimum absolute gap. Keeps near-ties out of the game.
const MIN_RELATIVE_GAP = 0.1;

const FINANCIAL_SECTORS = new Set(["Banking", "Finance", "Insurance", "Financial Services"]);

// ── Seeded randomness ────────────────────────────────────────────────────────

function hashSeed(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^ (h >>> 16)) >>> 0;
}

/** Seeded PRNG (mulberry32): a function giving floats in [0, 1). */
function seededRandom(seedString) {
  let a = hashSeed(String(seedString));
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled(list, rng) {
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// ── Reading numbers out of the fundamentals snapshot ─────────────────────────

const num = (v) => (typeof v === "number" || typeof v === "string") && v !== "" && Number.isFinite(Number(v))
  ? Number(v)
  : null;

/** The yearly revenue/profit rows, oldest first. Order in the feed is not trusted. */
function yearlySeries(fundamentals) {
  const rows = fundamentals && fundamentals.financials && fundamentals.financials.yearly;
  if (!Array.isArray(rows)) return [];
  return rows
    .map((r) => ({
      year: Number.parseInt(r && r.period, 10),
      revenue: num(r && r.revenue),
      profit: num(r && r.profit),
    }))
    .filter((r) => Number.isInteger(r.year) && r.revenue !== null && r.profit !== null)
    .sort((a, b) => a.year - b.year);
}

/** Latest year's row, only if it is recent enough to trust. */
function latestYear(fundamentals, currentYear) {
  const s = yearlySeries(fundamentals);
  const last = s[s.length - 1];
  if (!last || last.year < currentYear - MAX_STALE_YEARS) return null;
  return last;
}

/** { cur, prev } for the latest two CONSECUTIVE years, or null. */
function latestTwoYears(fundamentals, currentYear) {
  const s = yearlySeries(fundamentals);
  const cur = s[s.length - 1];
  const prev = s[s.length - 2];
  if (!cur || !prev) return null;
  if (cur.year < currentYear - MAX_STALE_YEARS) return null;
  if (cur.year - prev.year !== 1) return null;
  return { cur, prev };
}

const pctChange = (cur, prev) => ((cur - prev) / prev) * 100;

// ── The question set ─────────────────────────────────────────────────────────
//
// extract(fundamentals, ctx) -> { value, year? } | null
//   ctx = { sector, currentYear }
// `year` is set for fiscal-year numbers; two stocks are only compared when
// their years match.
// minAbsGap is in the same units as the value.

const QUESTIONS = Object.freeze([
  {
    id: "valuation",
    theme: "size",
    text: "Who is bigger in valuation?",
    label: "Market value",
    unit: "inr_cr",
    minAbsGap: 0,
    extract: (f) => {
      const v = num(f && f.metrics && f.metrics.market_cap);
      return v !== null && v > 0 ? { value: v } : null;
    },
  },
  {
    id: "pe",
    theme: "price",
    text: "Whose shares cost more for every ₹1 of profit (higher P/E)?",
    label: "P/E ratio",
    unit: "x",
    minAbsGap: 1.5,
    extract: (f) => {
      const v = num(f && f.metrics && f.metrics.pe_ratio);
      return v !== null && v > 0 && v < 1000 ? { value: v } : null;
    },
  },
  {
    id: "pb",
    theme: "price",
    text: "Who trades at a higher price compared to its book value (P/B)?",
    label: "P/B ratio",
    unit: "x",
    minAbsGap: 0.3,
    extract: (f) => {
      const v = num(f && f.metrics && f.metrics.pb_ratio);
      return v !== null && v > 0 && v < 200 ? { value: v } : null;
    },
  },
  {
    id: "margin",
    theme: "profitability",
    text: "Who keeps more profit from every ₹100 of sales?",
    label: "Profit margin",
    unit: "pct",
    minAbsGap: 2,
    yearly: true,
    extract: (f, ctx) => {
      const y = latestYear(f, ctx.currentYear);
      if (!y || !(y.revenue > 0)) return null;
      const margin = (y.profit / y.revenue) * 100;
      return margin > -100 && margin <= 100 ? { value: margin, year: y.year } : null;
    },
  },
  {
    id: "revenue_growth",
    theme: "growth",
    text: "Who grew its sales faster last year?",
    label: "Sales growth",
    unit: "pct",
    minAbsGap: 2,
    yearly: true,
    needsOneGrower: true,
    extract: (f, ctx) => {
      const two = latestTwoYears(f, ctx.currentYear);
      if (!two || !(two.prev.revenue > 0)) return null;
      const g = pctChange(two.cur.revenue, two.prev.revenue);
      // Beyond this it is almost always a merger / demerger, not real growth.
      return Math.abs(g) <= 150 ? { value: g, year: two.cur.year } : null;
    },
  },
  {
    id: "profit_growth",
    theme: "growth",
    text: "Who grew its profit faster last year?",
    label: "Profit growth",
    unit: "pct",
    minAbsGap: 3,
    yearly: true,
    needsOneGrower: true,
    extract: (f, ctx) => {
      const two = latestTwoYears(f, ctx.currentYear);
      // Growth from a loss is not a meaningful percentage.
      if (!two || !(two.prev.profit > 0)) return null;
      const g = pctChange(two.cur.profit, two.prev.profit);
      return Math.abs(g) <= 300 ? { value: g, year: two.cur.year } : null;
    },
  },
]);

// Switched OFF on purpose. Kept here, fully written, so turning one back on is
// moving it into QUESTIONS once the data behind it is fixed.
//   dividend: the feed's dividend_yield mixes percentages with what look like
//             rupees per share (Cipla 94, ICICI Bank 92, Nestle 89, Siemens 48).
//   debt:     debt_to_equity looks mis-scaled for some companies (Infosys 9.5,
//             HCL 7.1 next to Maruti 0.10), so "who has more debt" could be wrong.
const DISABLED_QUESTIONS = Object.freeze([
  {
    id: "dividend",
    theme: "income",
    text: "Who pays a higher dividend yield?",
    label: "Dividend yield",
    unit: "pct",
    minAbsGap: 0.3,
    extract: (f) => {
      const v = num(f && f.metrics && f.metrics.dividend_yield);
      // Over 15% is a data error in practice (the feed has had 48 and 55).
      return v !== null && v >= 0 && v <= 15 ? { value: v } : null;
    },
  },
  {
    id: "debt",
    theme: "debt",
    text: "Who carries more debt compared to its own money (debt-to-equity)?",
    label: "Debt-to-equity",
    unit: "x",
    minAbsGap: 0.1,
    extract: (f, ctx) => {
      if (FINANCIAL_SECTORS.has(ctx.sector)) return null;
      const v = num(f && f.metrics && f.metrics.debt_to_equity);
      return v !== null && v >= 0 && v <= 20 ? { value: v } : null;
    },
  },
]);

const QUESTION_BY_ID = Object.freeze(Object.fromEntries(QUESTIONS.map((q) => [q.id, q])));

/**
 * Judge one question for one pair.
 * Returns { leftValue, rightValue, winnerSide: "left"|"right", year } or null
 * when the pair cannot fairly be asked this question.
 */
function judge(question, leftF, rightF, ctx) {
  const l = question.extract(leftF, ctx);
  const r = question.extract(rightF, ctx);
  if (!l || !r) return null;
  if (question.yearly && l.year !== r.year) return null;
  // "Who grew faster" makes no sense when both shrank, so at least one must
  // have actually grown.
  if (question.needsOneGrower && !(l.value > 0 || r.value > 0)) return null;

  const gap = Math.abs(l.value - r.value);
  const biggest = Math.max(Math.abs(l.value), Math.abs(r.value));
  if (gap < question.minAbsGap) return null;
  if (!(biggest > 0) || gap / biggest < MIN_RELATIVE_GAP) return null;

  return {
    leftValue: l.value,
    rightValue: r.value,
    winnerSide: l.value > r.value ? "left" : "right",
    year: l.year || null,
  };
}

// ── Building a day ───────────────────────────────────────────────────────────

/** Equity stocks from the server's instrument list, grouped by sector. */
function groupBySector(instruments) {
  const groups = {};
  for (const [key, meta] of Object.entries(instruments || {})) {
    if (!key.startsWith("NSE_EQ|") || !meta || !meta.sector || meta.sector === "Index") continue;
    (groups[meta.sector] ||= []).push({ key, symbol: meta.symbol, name: meta.name, sector: meta.sector });
  }
  for (const name of Object.keys(groups)) {
    if (groups[name].length < MIN_STOCKS_PER_SECTOR) delete groups[name];
    else groups[name].sort((a, b) => a.symbol.localeCompare(b.symbol));
  }
  return groups;
}

/**
 * Pick up to ROUNDS_PER_DAY (pair, question) rounds inside ONE sector.
 * Distinct questions, limited questions per theme, distinct pairs, limited
 * repeats of one stock, and every
 * round must pass `judge`. Depth-first over seeded orders, so it is both
 * deterministic and finds a full day whenever one exists.
 * Returns the best list found (longest wins; the first full one stops early).
 */
function buildSectorRounds({ sector, stocks, fundamentals, dateKey }) {
  const ctx = { sector, currentYear: Number.parseInt(dateKey.slice(0, 4), 10) };
  const snapshot = (fundamentals && fundamentals.stocks) || {};

  const pairs = [];
  for (let i = 0; i < stocks.length; i++) {
    for (let j = i + 1; j < stocks.length; j++) pairs.push([stocks[i], stocks[j]]);
  }
  const pairOrder = shuffled(pairs, seededRandom(`pairs|${dateKey}|${sector}`));
  const questionOrder = shuffled(QUESTIONS, seededRandom(`questions|${dateKey}|${sector}`));

  // Every valid (pair, question) option, computed once.
  const options = pairOrder.map(([a, b]) => {
    const sideRng = seededRandom(`side|${dateKey}|${sector}|${a.symbol}|${b.symbol}`);
    const [left, right] = sideRng() < 0.5 ? [a, b] : [b, a];
    const valid = [];
    for (const q of questionOrder) {
      const j = judge(q, snapshot[left.symbol], snapshot[right.symbol], ctx);
      if (j) valid.push({ q, j });
    }
    return { left, right, valid };
  });

  let best = [];
  const usedQuestions = new Set();
  const themeCount = {};
  const appearances = {};
  const chosen = [];

  function search(from) {
    if (chosen.length > best.length) best = chosen.slice();
    if (best.length >= ROUNDS_PER_DAY) return true;

    for (let i = from; i < options.length; i++) {
      const opt = options[i];
      if ((appearances[opt.left.symbol] || 0) >= MAX_APPEARANCES_PER_STOCK) continue;
      if ((appearances[opt.right.symbol] || 0) >= MAX_APPEARANCES_PER_STOCK) continue;

      for (const { q, j } of opt.valid) {
        if (usedQuestions.has(q.id)) continue;
        if ((themeCount[q.theme] || 0) >= MAX_QUESTIONS_PER_THEME) continue;

        usedQuestions.add(q.id);
        themeCount[q.theme] = (themeCount[q.theme] || 0) + 1;
        appearances[opt.left.symbol] = (appearances[opt.left.symbol] || 0) + 1;
        appearances[opt.right.symbol] = (appearances[opt.right.symbol] || 0) + 1;
        chosen.push({ opt, q, j });

        if (search(i + 1)) return true;

        chosen.pop();
        appearances[opt.left.symbol] -= 1;
        appearances[opt.right.symbol] -= 1;
        themeCount[q.theme] -= 1;
        usedQuestions.delete(q.id);
      }
    }
    return false;
  }

  search(0);

  // The order the user plays in is its own seeded shuffle, so the day does not
  // always open with the same kind of question.
  const played = shuffled(best, seededRandom(`order|${dateKey}|${sector}`));

  return played.map(({ opt, q, j }, index) => ({
    index,
    questionId: q.id,
    theme: q.theme,
    text: q.text,
    label: q.label,
    unit: q.unit,
    fiscalYear: j.year,
    left: { key: opt.left.key, symbol: opt.left.symbol, name: opt.left.name },
    right: { key: opt.right.key, symbol: opt.right.symbol, name: opt.right.name },
    leftValue: j.leftValue,
    rightValue: j.rightValue,
    winnerKey: j.winnerSide === "left" ? opt.left.key : opt.right.key,
  }));
}

/**
 * Build the whole day: choose the sector and its rounds.
 * Sectors are tried in a seeded order; the first that gives a full day wins.
 * If none does, the sector with the most rounds is used (at least MIN_ROUNDS).
 * Returns { version, dateKey, sector, rounds } or null.
 */
function buildDay({ instruments, fundamentals, dateKey }) {
  const groups = groupBySector(instruments);
  const names = shuffled(Object.keys(groups).sort(), seededRandom(`sector|${dateKey}`));

  let best = null;
  for (const sector of names) {
    const rounds = buildSectorRounds({ sector, stocks: groups[sector], fundamentals, dateKey });
    if (rounds.length >= ROUNDS_PER_DAY) return { version: 1, dateKey, sector, rounds };
    if (rounds.length >= MIN_ROUNDS && (!best || rounds.length > best.rounds.length)) {
      best = { version: 1, dateKey, sector, rounds };
    }
  }
  return best;
}

// ── What a user is allowed to see ────────────────────────────────────────────

/**
 * A user's view of a stored day. The winners and the numbers stay hidden until
 * every round is answered, so nobody can read the answers off the network.
 *
 * answers: [{ roundIndex, pickedKey }]
 */
function viewDay(day, answers) {
  const byRound = new Map((answers || []).map((a) => [a.roundIndex, a.pickedKey]));
  const total = day.rounds.length;
  const answered = day.rounds.filter((r) => byRound.has(r.index)).length;
  const complete = answered === total;

  const view = {
    date: day.dateKey,
    sector: day.sector,
    total,
    answered,
    complete,
    rounds: day.rounds.map((r) => ({
      index: r.index,
      text: r.text,
      left: r.left,
      right: r.right,
      pickedKey: byRound.has(r.index) ? byRound.get(r.index) : null,
    })),
    result: null,
  };

  if (complete) {
    const results = day.rounds.map((r) => ({
      index: r.index,
      text: r.text,
      label: r.label,
      unit: r.unit,
      fiscalYear: r.fiscalYear,
      left: r.left,
      right: r.right,
      leftValue: r.leftValue,
      rightValue: r.rightValue,
      winnerKey: r.winnerKey,
      pickedKey: byRound.get(r.index),
      correct: byRound.get(r.index) === r.winnerKey,
    }));
    view.result = {
      score: results.filter((r) => r.correct).length,
      total,
      rounds: results,
    };
  }
  return view;
}

/** Is this a legal pick? Returns an error code string or null. */
function validatePick(day, roundIndex, pickedKey) {
  if (!Number.isInteger(roundIndex) || roundIndex < 0 || roundIndex >= day.rounds.length) {
    return "BAD_ROUND";
  }
  const r = day.rounds[roundIndex];
  if (pickedKey !== r.left.key && pickedKey !== r.right.key) return "BAD_PICK";
  return null;
}

module.exports = {
  ROUNDS_PER_DAY,
  MIN_ROUNDS,
  MIN_STOCKS_PER_SECTOR,
  MAX_APPEARANCES_PER_STOCK,
  MAX_QUESTIONS_PER_THEME,
  MAX_STALE_YEARS,
  MIN_RELATIVE_GAP,
  QUESTIONS,
  DISABLED_QUESTIONS,
  QUESTION_BY_ID,
  seededRandom,
  yearlySeries,
  judge,
  groupBySector,
  buildSectorRounds,
  buildDay,
  viewDay,
  validatePick,
};
