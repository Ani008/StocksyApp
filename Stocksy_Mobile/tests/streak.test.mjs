import test from "node:test";
import assert from "node:assert/strict";
import {
  EMPTY_STREAK,
  HISTORY_LIMIT,
  applyCheckIn,
  dayDiff,
  effectiveStreak,
  getDoneRuns,
  getStreakMessage,
  getWeek,
  sanitizeState,
  shiftKey,
  toDateKey,
} from "../src/utils/streak.js";

// ── date helpers ────────────────────────────────────────────────────────────
test("toDateKey uses the local calendar day, zero padded", () => {
  assert.equal(toDateKey(new Date(2026, 0, 5, 23, 59)), "2026-01-05");
  assert.equal(toDateKey(new Date(2026, 9, 19, 0, 1)), "2026-10-19");
});

test("shiftKey and dayDiff cross month, year and leap-day boundaries", () => {
  assert.equal(shiftKey("2026-10-31", 1), "2026-11-01");
  assert.equal(shiftKey("2026-01-01", -1), "2025-12-31");
  assert.equal(shiftKey("2028-02-28", 1), "2028-02-29");
  assert.equal(dayDiff("2026-10-19", "2026-10-20"), 1);
  assert.equal(dayDiff("2026-10-20", "2026-10-19"), -1);
  assert.equal(dayDiff("2025-12-31", "2026-01-01"), 1);
});

// ── applyCheckIn ────────────────────────────────────────────────────────────
test("first ever check-in starts a streak of 1", () => {
  const r = applyCheckIn(EMPTY_STREAK, "2026-10-19");
  assert.equal(r.isNewDay, true);
  assert.equal(r.state.current, 1);
  assert.equal(r.state.longest, 1);
  assert.equal(r.state.lastCheckIn, "2026-10-19");
  assert.deepEqual(r.state.history, ["2026-10-19"]);
  assert.equal(r.lostStreak, 0);
});

test("checking in on consecutive days extends the streak", () => {
  let s = applyCheckIn(EMPTY_STREAK, "2026-10-19").state;
  s = applyCheckIn(s, "2026-10-20").state;
  const r = applyCheckIn(s, "2026-10-21");
  assert.equal(r.state.current, 3);
  assert.equal(r.milestone, 3);
  assert.equal(r.isNewDay, true);
});

test("a second check-in on the same day changes nothing", () => {
  const s = applyCheckIn(EMPTY_STREAK, "2026-10-19").state;
  const r = applyCheckIn(s, "2026-10-19");
  assert.equal(r.isNewDay, false);
  assert.equal(r.milestone, 0);
  assert.deepEqual(r.state, s);
});

test("skipping a day resets to 1, reports the lost streak and keeps longest", () => {
  let s = EMPTY_STREAK;
  for (const d of ["2026-10-15", "2026-10-16", "2026-10-17", "2026-10-18"]) {
    s = applyCheckIn(s, d).state;
  }
  assert.equal(s.current, 4);
  const r = applyCheckIn(s, "2026-10-20"); // 19th skipped
  assert.equal(r.state.current, 1);
  assert.equal(r.state.longest, 4);
  assert.equal(r.lostStreak, 4);
  assert.equal(r.isNewDay, true);
});

test("a device clock that moves backwards does not break the streak", () => {
  let s = applyCheckIn(EMPTY_STREAK, "2026-10-19").state;
  s = applyCheckIn(s, "2026-10-20").state;
  const r = applyCheckIn(s, "2026-10-18");
  assert.equal(r.isNewDay, false);
  assert.equal(r.state.current, 2);
  assert.equal(r.state.lastCheckIn, "2026-10-20");
});

test("an invalid day key is ignored", () => {
  const r = applyCheckIn(EMPTY_STREAK, "not-a-date");
  assert.equal(r.isNewDay, false);
  assert.equal(r.state.current, 0);
});

test("milestones fire only on the day they are reached", () => {
  let s = EMPTY_STREAK;
  const hits = [];
  let day = "2026-10-01";
  for (let i = 0; i < 31; i++) {
    const r = applyCheckIn(s, day);
    s = r.state;
    if (r.milestone) hits.push(r.milestone);
    day = shiftKey(day, 1);
  }
  assert.deepEqual(hits, [3, 7, 14, 30]);
});

test("history is capped", () => {
  let s = EMPTY_STREAK;
  let day = "2025-01-01";
  for (let i = 0; i < HISTORY_LIMIT + 20; i++) {
    s = applyCheckIn(s, day).state;
    day = shiftKey(day, 1);
  }
  assert.equal(s.history.length, HISTORY_LIMIT);
  assert.equal(s.current, HISTORY_LIMIT + 20);
});

// ── sanitizeState / effectiveStreak ─────────────────────────────────────────
test("sanitizeState survives garbage from storage", () => {
  for (const bad of [null, undefined, 5, "x", [], { current: "9", history: "no" }]) {
    const s = sanitizeState(bad);
    assert.equal(s.current, 0);
    assert.equal(s.lastCheckIn, null);
    assert.deepEqual(s.history, []);
  }
  const s = sanitizeState({
    current: 4,
    longest: 2,
    lastCheckIn: "2026-10-19",
    history: ["2026-10-19", "junk", "2026-10-18", "2026-10-19"],
  });
  assert.equal(s.longest, 4); // never below current
  assert.deepEqual(s.history, ["2026-10-18", "2026-10-19"]);
});

test("effectiveStreak drops to 0 once yesterday has been missed", () => {
  const s = { current: 5, longest: 5, lastCheckIn: "2026-10-18", history: [] };
  assert.equal(effectiveStreak(s, "2026-10-18"), 5); // checked in today
  assert.equal(effectiveStreak(s, "2026-10-19"), 5); // yesterday: still alive
  assert.equal(effectiveStreak(s, "2026-10-20"), 0); // missed a day
  assert.equal(effectiveStreak(EMPTY_STREAK, "2026-10-20"), 0);
});

// ── week strip ──────────────────────────────────────────────────────────────
test("getWeek runs Monday to Sunday around the given day", () => {
  // 2026-10-19 is a Monday, 2026-10-25 a Sunday
  const week = getWeek("2026-10-21", []);
  assert.deepEqual(
    week.map((d) => d.key),
    [
      "2026-10-19",
      "2026-10-20",
      "2026-10-21",
      "2026-10-22",
      "2026-10-23",
      "2026-10-24",
      "2026-10-25",
    ],
  );
  assert.equal(week.map((d) => d.label).join(""), "MTWTFSS");
  assert.equal(week[2].isToday, true);
  assert.equal(week.filter((d) => d.isToday).length, 1);
});

test("a Sunday belongs to the week that started the Monday before", () => {
  const week = getWeek("2026-10-25", []);
  assert.equal(week[0].key, "2026-10-19");
  assert.equal(week[6].isToday, true);
});

test("getWeek marks done, missed, pending and upcoming days", () => {
  const week = getWeek("2026-10-21", ["2026-10-20"]);
  assert.deepEqual(
    week.map((d) => d.status),
    ["missed", "done", "pending", "upcoming", "upcoming", "upcoming", "upcoming"],
  );
  const checked = getWeek("2026-10-21", ["2026-10-20", "2026-10-21"]);
  assert.equal(checked[2].status, "done");
  assert.equal(checked[2].isToday, true);
});

test("getDoneRuns finds only runs of two or more days", () => {
  const week = getWeek("2026-10-24", [
    "2026-10-19", // lone day
    "2026-10-21",
    "2026-10-22",
    "2026-10-23",
    "2026-10-24",
  ]);
  assert.deepEqual(getDoneRuns(week), [[2, 5]]);
  assert.deepEqual(getDoneRuns(getWeek("2026-10-21", ["2026-10-21"])), []);
  // a run that reaches Sunday
  const sunday = getWeek("2026-10-25", ["2026-10-24", "2026-10-25"]);
  assert.deepEqual(getDoneRuns(sunday), [[5, 6]]);
});

// ── message ─────────────────────────────────────────────────────────────────
test("getStreakMessage covers fresh, lost, rising and milestone states", () => {
  assert.match(getStreakMessage({ current: 0 }), /start a streak/i);
  assert.match(getStreakMessage({ current: 1 }), /day one/i);
  assert.match(getStreakMessage({ current: 1, lostStreak: 6 }), /6-day streak ended/);
  assert.match(getStreakMessage({ current: 2 }), /two in a row/i);
  assert.match(getStreakMessage({ current: 3, milestone: 3 }), /on fire/i);
  assert.match(getStreakMessage({ current: 5 }), /on fire/i);
  assert.match(getStreakMessage({ current: 7, milestone: 7 }), /full week/i);
  assert.match(getStreakMessage({ current: 9 }), /9 days and counting/);
  assert.match(getStreakMessage({ current: 365, milestone: 365 }), /year/i);
});
