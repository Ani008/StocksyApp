/**
 * Pure helpers for the "Stock of the Day" head-to-head game. No React,
 * react-native or network here, so `node --test` can run them.
 *
 * Stage 1: pick today's sector and two stocks from it.
 *
 * Everything is SEEDED, not truly random. The seed is today's date in IST, so
 * every user gets the same sector and the same matchups on the same day. That
 * is what makes "everyone voted today" and community results possible in later
 * stages. Pass a different `salt` to get a different draw (used by the dev
 * shuffle button), and a different `round` to get the next matchup of the day.
 */

// A sector needs at least this many stocks to be playable. 4 stocks give 6
// distinct pairs, so the 4 rounds planned per day never repeat a matchup.
export const MIN_STOCKS_PER_SECTOR = 4;

export const ROUNDS_PER_DAY = 4;

// Fixed question set. Stage 1 ships one question; Stage 2 grows this list and
// attaches the fundamentals field each question is judged on.
export const QUESTIONS = Object.freeze([
  Object.freeze({ id: "valuation", text: "Who is bigger in valuation?" }),
]);

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** Today's date in IST as "YYYY-MM-DD", from a timestamp in ms. No locale APIs. */
export function istDateKey(nowMs = Date.now()) {
  const d = new Date(nowMs + IST_OFFSET_MS);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Small string -> 32-bit hash (xmur3). */
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

/** Seeded PRNG (mulberry32): returns a function giving floats in [0, 1). */
export function seededRandom(seedString) {
  let a = hashSeed(String(seedString));
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher-Yates on a copy, driven by the given rng. */
function shuffled(list, rng) {
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Only real, tradable companies with a logo domain. Indices and domain-less rows are out. */
export function playableStocks(instruments) {
  return (instruments || []).filter(
    (s) =>
      s &&
      typeof s.key === "string" &&
      s.key.startsWith("NSE_EQ|") &&
      s.sector &&
      s.sector !== "Index" &&
      s.domain
  );
}

/** { sectorName: [stocks] } for every sector with enough stocks to play. */
export function groupBySector(instruments) {
  const groups = {};
  for (const s of playableStocks(instruments)) {
    (groups[s.sector] ||= []).push(s);
  }
  for (const name of Object.keys(groups)) {
    if (groups[name].length < MIN_STOCKS_PER_SECTOR) delete groups[name];
  }
  return groups;
}

/** Today's sector name. Same for every user on a given IST day. */
export function pickSectorOfTheDay(instruments, { nowMs = Date.now(), salt = "" } = {}) {
  const names = Object.keys(groupBySector(instruments)).sort();
  if (names.length === 0) return null;
  const rng = seededRandom(`sector|${istDateKey(nowMs)}|${salt}`);
  return names[Math.floor(rng() * names.length)];
}

/**
 * One head-to-head matchup: { sector, question, round, left, right }.
 *
 * The sector is fixed for the day. Each round takes the next pair from a
 * seeded shuffle of ALL pairs in that sector, so rounds 0-3 never repeat a
 * matchup. Which stock lands on the left is also seeded, so the "bigger"
 * company is not predictably on one side.
 *
 * Returns null if no sector has enough stocks (bad / empty instrument list).
 */
export function pickMatchup(instruments, { nowMs = Date.now(), round = 0, salt = "" } = {}) {
  const sector = pickSectorOfTheDay(instruments, { nowMs, salt });
  if (!sector) return null;

  const day = istDateKey(nowMs);
  const stocks = groupBySector(instruments)[sector]
    .slice()
    .sort((a, b) => a.symbol.localeCompare(b.symbol)); // stable base order, so the seed fully decides

  const pairs = [];
  for (let i = 0; i < stocks.length; i++) {
    for (let j = i + 1; j < stocks.length; j++) pairs.push([stocks[i], stocks[j]]);
  }

  const order = shuffled(pairs, seededRandom(`pairs|${day}|${sector}|${salt}`));
  const r = Number.isInteger(round) && round >= 0 ? round : 0;
  const [a, b] = order[r % order.length];

  const sideRng = seededRandom(`side|${day}|${sector}|${r}|${salt}`);
  const [left, right] = sideRng() < 0.5 ? [a, b] : [b, a];

  const qRng = seededRandom(`question|${day}|${sector}|${r}|${salt}`);
  const question = QUESTIONS[Math.floor(qRng() * QUESTIONS.length)];

  return { sector, question, round: r, left, right };
}
