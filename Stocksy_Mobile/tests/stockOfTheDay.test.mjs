import test from "node:test";
import assert from "node:assert/strict";
import {
  MIN_STOCKS_PER_SECTOR,
  QUESTIONS,
  groupBySector,
  istDateKey,
  pickMatchup,
  pickSectorOfTheDay,
  playableStocks,
  seededRandom,
} from "../src/utils/stockOfTheDay.js";

// Same shape as INSTRUMENTS in SearchPage.js.
const stock = (symbol, sector, extra = {}) => ({
  key: `NSE_EQ|${symbol}`,
  symbol,
  name: `${symbol} Ltd`,
  domain: `${symbol.toLowerCase()}.com`,
  sector,
  ...extra,
});

const FIXTURE = [
  { key: "NSE_INDEX|Nifty 50", symbol: "NIFTY 50", name: "Nifty 50", domain: "nseindia.com", sector: "Index" },
  stock("TCS", "IT"), stock("INFY", "IT"), stock("WIPRO", "IT"), stock("HCLTECH", "IT"), stock("TECHM", "IT"),
  stock("ITC", "FMCG"), stock("HUL", "FMCG"), stock("DABUR", "FMCG"), stock("NESTLE", "FMCG"),
  stock("MARUTI", "Auto"), stock("HERO", "Auto"), stock("BAJAJ", "Auto"), stock("EICHER", "Auto"),
  stock("LT", "Infrastructure"), stock("GRASIM", "Infrastructure"), stock("ADANIENT", "Infrastructure"), // only 3
  stock("AIRTEL", "Telecom"), // only 1
];

const day = (iso) => Date.parse(`${iso}T12:00:00+05:30`);

// ── date key ────────────────────────────────────────────────────────────────
test("istDateKey: rolls over at IST midnight, not UTC midnight", () => {
  assert.equal(istDateKey(Date.parse("2026-10-23T00:05:00+05:30")), "2026-10-23");
  assert.equal(istDateKey(Date.parse("2026-10-23T23:55:00+05:30")), "2026-10-23");
  assert.equal(istDateKey(Date.parse("2026-10-23T18:31:00Z")), "2026-10-24"); // 00:01 IST next day
});

// ── seeded random ───────────────────────────────────────────────────────────
test("seededRandom: same seed gives the same stream, different seed differs", () => {
  const a = seededRandom("x"), b = seededRandom("x"), c = seededRandom("y");
  const sa = [a(), a(), a()], sb = [b(), b(), b()], sc = [c(), c(), c()];
  assert.deepEqual(sa, sb);
  assert.notDeepEqual(sa, sc);
  for (const n of sa) assert.ok(n >= 0 && n < 1);
});

// ── eligibility ─────────────────────────────────────────────────────────────
test("playableStocks: drops indices and rows without a logo domain", () => {
  const out = playableStocks([...FIXTURE, stock("NODOMAIN", "IT", { domain: "" })]);
  assert.ok(out.every((s) => s.key.startsWith("NSE_EQ|")));
  assert.ok(!out.some((s) => s.symbol === "NIFTY 50" || s.symbol === "NODOMAIN"));
});

test("groupBySector: sectors with too few stocks are not playable", () => {
  const groups = groupBySector(FIXTURE);
  assert.deepEqual(Object.keys(groups).sort(), ["Auto", "FMCG", "IT"]);
  for (const list of Object.values(groups)) assert.ok(list.length >= MIN_STOCKS_PER_SECTOR);
});

// ── the daily pick ──────────────────────────────────────────────────────────
test("sector of the day: stable within a day, always a playable sector", () => {
  const nowMs = day("2026-10-23");
  const first = pickSectorOfTheDay(FIXTURE, { nowMs });
  assert.ok(["IT", "FMCG", "Auto"].includes(first));
  // same day, different time of day -> same sector
  assert.equal(pickSectorOfTheDay(FIXTURE, { nowMs: Date.parse("2026-10-23T23:30:00+05:30") }), first);
  assert.equal(pickSectorOfTheDay(FIXTURE, { nowMs: Date.parse("2026-10-23T00:10:00+05:30") }), first);
});

test("sector of the day: varies across days (all playable sectors show up over a month)", () => {
  const seen = new Set();
  for (let d = 1; d <= 30; d++) {
    seen.add(pickSectorOfTheDay(FIXTURE, { nowMs: day(`2026-11-${String(d).padStart(2, "0")}`) }));
  }
  assert.deepEqual([...seen].sort(), ["Auto", "FMCG", "IT"]);
});

test("matchup: two different stocks from the same sector, with logo domains", () => {
  const m = pickMatchup(FIXTURE, { nowMs: day("2026-10-23") });
  assert.equal(m.left.sector, m.sector);
  assert.equal(m.right.sector, m.sector);
  assert.notEqual(m.left.key, m.right.key);
  assert.ok(m.left.domain && m.right.domain);
  assert.equal(m.round, 0);
  assert.ok(QUESTIONS.some((q) => q.id === m.question.id));
});

test("matchup: same day + round is identical for every caller", () => {
  const nowMs = day("2026-10-23");
  assert.deepEqual(pickMatchup(FIXTURE, { nowMs }), pickMatchup(FIXTURE, { nowMs }));
});

test("matchup: the 4 rounds of a day never repeat a pair", () => {
  for (let d = 1; d <= 20; d++) {
    const nowMs = day(`2026-11-${String(d).padStart(2, "0")}`);
    const pairs = new Set();
    for (let round = 0; round < 4; round++) {
      const m = pickMatchup(FIXTURE, { nowMs, round });
      pairs.add([m.left.key, m.right.key].sort().join("~"));
    }
    assert.equal(pairs.size, 4, `repeat on 2026-11-${d}`);
  }
});

test("matchup: all rounds of a day stay in that day's sector", () => {
  const nowMs = day("2026-10-23");
  const sector = pickSectorOfTheDay(FIXTURE, { nowMs });
  for (let round = 0; round < 4; round++) assert.equal(pickMatchup(FIXTURE, { nowMs, round }).sector, sector);
});

test("matchup: left/right is not stuck on one side", () => {
  const lefts = new Set();
  for (let d = 1; d <= 30; d++) {
    const m = pickMatchup(FIXTURE, { nowMs: day(`2026-11-${String(d).padStart(2, "0")}`) });
    lefts.add(m.left.symbol < m.right.symbol); // alphabetical-first on the left?
  }
  assert.equal(lefts.size, 2);
});

test("matchup: salt gives a different draw (dev shuffle)", () => {
  const nowMs = day("2026-10-23");
  const draws = new Set();
  for (let i = 0; i < 12; i++) {
    const m = pickMatchup(FIXTURE, { nowMs, salt: String(i) });
    draws.add(`${m.sector}:${m.left.symbol}:${m.right.symbol}`);
  }
  assert.ok(draws.size > 1);
});

test("matchup: bad rounds fall back to round 0, empty data returns null", () => {
  const nowMs = day("2026-10-23");
  assert.equal(pickMatchup(FIXTURE, { nowMs, round: -3 }).round, 0);
  assert.equal(pickMatchup(FIXTURE, { nowMs, round: 1.5 }).round, 0);
  assert.equal(pickMatchup([], { nowMs }), null);
  assert.equal(pickMatchup(undefined, { nowMs }), null);
  assert.equal(pickMatchup([stock("A", "IT"), stock("B", "IT")], { nowMs }), null); // too few
});
