import test from "node:test";
import assert from "node:assert/strict";
import {
  EMPTY_STREAK,
  HISTORY_LIMIT,
  dayDiff,
  effectiveStreak,
  getDoneRuns,
  getStreakMessage,
  getWeek,
  getYearGrid,
  levelForCount,
  formatDateKey,
  YEAR_WEEKS,
  sanitizeState,
  shiftKey,
  toDateKey,
  toIstDateKey,
  milestoneFor,
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

// ── the server decides the streak; the app only shapes it for display ──────
test("sanitizeState keeps what the server sends: alive-through date, off days, lost streak", () => {
  const s = sanitizeState({
    current: 2,
    longest: 4,
    lastCheckIn: "2026-10-23",
    aliveThrough: "2026-10-26",
    history: ["2026-10-22", "2026-10-23"],
    offDays: ["2026-10-25", "2026-10-24", "bad", "2026-10-24"],
    lostStreak: 3,
  });
  assert.equal(s.aliveThrough, "2026-10-26");
  assert.deepEqual(s.offDays, ["2026-10-24", "2026-10-25"]);
  assert.equal(s.lostStreak, 3);
});

test("sanitizeState drops an alive-through date that has no last day, and bad numbers", () => {
  assert.equal(sanitizeState({ aliveThrough: "2026-10-26" }).aliveThrough, null);
  assert.equal(sanitizeState({ lastCheckIn: "2026-10-23", aliveThrough: "nope" }).aliveThrough, null);
  assert.equal(sanitizeState({ lostStreak: -4 }).lostStreak, 0);
  assert.equal(sanitizeState({ lostStreak: "7" }).lostStreak, 0);
});

test("effectiveStreak follows the server's alive-through date, so Friday's streak lives over the weekend", () => {
  const s = sanitizeState({
    current: 4,
    lastCheckIn: "2026-10-23", // Friday
    aliveThrough: "2026-10-26", // Monday: the next trading day
    history: ["2026-10-23"],
  });
  assert.equal(effectiveStreak(s, "2026-10-23"), 4); // Friday
  assert.equal(effectiveStreak(s, "2026-10-24"), 4); // Saturday
  assert.equal(effectiveStreak(s, "2026-10-25"), 4); // Sunday
  assert.equal(effectiveStreak(s, "2026-10-26"), 4); // Monday, nothing done yet
  assert.equal(effectiveStreak(s, "2026-10-27"), 0); // Monday passed with nothing
});

test("effectiveStreak on an old saved copy (no alive-through date) falls back to yesterday-or-today", () => {
  const s = sanitizeState({ current: 3, lastCheckIn: "2026-10-22", history: ["2026-10-22"] });
  assert.equal(effectiveStreak(s, "2026-10-23"), 3);
  assert.equal(effectiveStreak(s, "2026-10-24"), 0);
});

test("getWeek marks weekends and holidays as off, not missed", () => {
  // Week of Mon 19 Oct 2026: Tue 20 is Dussehra, Sat 24 / Sun 25 are the weekend.
  const off = ["2026-10-20", "2026-10-24", "2026-10-25"];
  const week = getWeek("2026-10-23", ["2026-10-19", "2026-10-21"], off);
  const status = Object.fromEntries(week.map((d) => [d.key, d.status]));
  assert.equal(status["2026-10-19"], "done");
  assert.equal(status["2026-10-20"], "off"); // the holiday, not "missed"
  assert.equal(status["2026-10-21"], "done");
  assert.equal(status["2026-10-22"], "missed"); // a real trading day with nothing done
  assert.equal(status["2026-10-23"], "pending"); // today
  assert.equal(status["2026-10-24"], "off");
  assert.equal(status["2026-10-25"], "off");
});

test("getWeek: a day off that was still done shows done, and today off is not 'pending'", () => {
  const done = getWeek("2026-10-24", ["2026-10-24"], ["2026-10-24", "2026-10-25"]);
  assert.equal(done.find((d) => d.key === "2026-10-24").status, "done");
  const idle = getWeek("2026-10-24", [], ["2026-10-24", "2026-10-25"]);
  const today = idle.find((d) => d.key === "2026-10-24");
  assert.equal(today.status, "off");
  assert.equal(today.isToday, true);
});

test("getWeek with no offDays behaves as before", () => {
  const week = getWeek("2026-10-21", ["2026-10-20"]);
  assert.equal(week.find((d) => d.key === "2026-10-20").status, "done");
  assert.equal(week.find((d) => d.key === "2026-10-19").status, "missed");
  assert.equal(week.find((d) => d.key === "2026-10-21").status, "pending");
});

test("the message tells people what earns a day, not 'open the app'", () => {
  assert.match(getStreakMessage({ current: 0 }), /Nifty call or place a trade/i);
  assert.doesNotMatch(getStreakMessage({ current: 0 }), /open stocksy/i);
  // Alive, but nothing done yet today: nudge.
  assert.match(getStreakMessage({ current: 4, doneToday: false }), /keep your streak going/i);
  // Done today: the usual lines.
  assert.match(getStreakMessage({ current: 2, doneToday: true }), /two in a row/i);
  assert.match(getStreakMessage({ current: 1, doneToday: true }), /next trading day/i);
});

test("a milestone message wins over the nudge", () => {
  assert.match(getStreakMessage({ current: 7, milestone: 7, doneToday: false }), /full week/i);
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

// ── year calendar ───────────────────────────────────────────────────────────
test("levelForCount: none is 0, a check-in is 3, more activity darkens up to 4", () => {
  assert.equal(levelForCount(0), 0);
  assert.equal(levelForCount(undefined), 0);
  assert.equal(levelForCount(1), 3);
  assert.equal(levelForCount(2), 4);
  assert.equal(levelForCount(9), 4);
});

test("getYearGrid is 53 columns of 7, Monday first, ending in today's week", () => {
  const { weeks } = getYearGrid("2026-10-21", []); // a Wednesday
  assert.equal(weeks.length, YEAR_WEEKS);
  assert.ok(weeks.every((w) => w.length === 7));
  // every column starts on a Monday, exactly 7 days apart
  for (let c = 0; c < weeks.length; c++) {
    assert.equal(new Date(weeks[c][0].key + "T00:00:00Z").getUTCDay(), 1);
    if (c) assert.equal(dayDiff(weeks[c - 1][0].key, weeks[c][0].key), 7);
  }
  const last = weeks[YEAR_WEEKS - 1];
  assert.equal(last[0].key, "2026-10-19");
  assert.equal(last[2].key, "2026-10-21"); // Wednesday = row 2
  assert.deepEqual(last.map((d) => d.future), [false, false, false, true, true, true, true]);
  assert.equal(weeks[0][0].key, shiftKey("2026-10-19", -7 * 52));
});

test("getYearGrid when today is a Monday or a Sunday", () => {
  const mon = getYearGrid("2026-10-19", []).weeks.at(-1);
  assert.deepEqual(mon.map((d) => d.future), [false, true, true, true, true, true, true]);
  const sun = getYearGrid("2026-10-25", []).weeks.at(-1);
  assert.equal(sun.every((d) => !d.future), true);
  assert.equal(sun[6].key, "2026-10-25");
});

test("getYearGrid marks activity, counts days once and ignores bad keys and the future", () => {
  const { weeks, total } = getYearGrid("2026-10-21", [
    "2026-10-19",
    "2026-10-19", // two things on one day -> still one active day
    "2026-10-20",
    "2026-10-22", // in the future: not counted
    "garbage",
    "2024-01-01", // older than the window
  ]);
  const last = weeks.at(-1);
  assert.equal(last[0].count, 2);
  assert.equal(last[0].level, 4);
  assert.equal(last[1].level, 3);
  assert.equal(last[3].count, 0); // future day stays empty
  assert.equal(total, 2);
});

test("getYearGrid month labels sit where a month starts and never overlap", () => {
  const { months } = getYearGrid("2026-10-21", []);
  assert.ok(months.length >= 12 && months.length <= 13);
  for (let i = 1; i < months.length; i++) {
    assert.ok(months[i].col - months[i - 1].col >= 3, "labels too close");
  }
  assert.equal(months.at(-1).label, "Oct");
  // labels run in calendar order
  const order = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  for (let i = 1; i < months.length; i++) {
    const prev = order.indexOf(months[i - 1].label);
    assert.equal(order.indexOf(months[i].label), (prev + 1) % 12);
  }
});

test("getYearGrid copes with a year boundary and a leap day", () => {
  const { weeks } = getYearGrid("2028-03-01", ["2028-02-29"]);
  const flat = weeks.flat();
  assert.ok(flat.some((d) => d.key === "2028-02-29" && d.level === 3));
  assert.equal(new Set(flat.map((d) => d.key)).size, flat.length); // no repeats
  assert.deepEqual(getYearGrid("bad"), { weeks: [], months: [], total: 0 });
});

test("formatDateKey", () => {
  assert.equal(formatDateKey("2026-10-14"), "Wed, 14 Oct 2026");
  assert.equal(formatDateKey("nope"), "");
});

test("history is kept long enough to fill a full-year calendar", () => {
  assert.ok(HISTORY_LIMIT >= YEAR_WEEKS * 7);
});

// ── server-backed streak: IST days + milestones ─────────────────────────────
test("toIstDateKey names the day in IST whatever the device timezone is", () => {
  // 18:45 UTC on the 21st is 00:15 IST on the 22nd.
  assert.equal(toIstDateKey(new Date("2026-10-21T18:45:00Z")), "2026-10-22");
  // 18:29 UTC is 23:59 IST: still the 21st.
  assert.equal(toIstDateKey(new Date("2026-10-21T18:29:00Z")), "2026-10-21");
  // Year and month rollover.
  assert.equal(toIstDateKey(new Date("2026-12-31T18:30:00Z")), "2027-01-01");
  assert.equal(toIstDateKey(new Date("2026-01-31T20:00:00Z")), "2026-02-01");
});

test("milestoneFor returns the milestone or 0", () => {
  assert.equal(milestoneFor(3), 3);
  assert.equal(milestoneFor(7), 7);
  assert.equal(milestoneFor(365), 365);
  assert.equal(milestoneFor(4), 0);
  assert.equal(milestoneFor(0), 0);
});

test("a server response becomes a usable state (current survives, bad data does not crash)", () => {
  const ok = sanitizeState({
    current: 3,
    longest: 5,
    lastCheckIn: "2026-10-22",
    history: ["2026-10-20", "2026-10-21", "2026-10-22"],
  });
  assert.equal(ok.current, 3);
  assert.equal(ok.longest, 5);
  assert.equal(effectiveStreak(ok, "2026-10-22"), 3);
  assert.equal(effectiveStreak(ok, "2026-10-23"), 3); // still alive the morning after
  assert.equal(effectiveStreak(ok, "2026-10-24"), 0); // ended

  // A server that returned nothing useful must not crash the dashboard.
  assert.deepEqual(sanitizeState(undefined), {
    current: 0,
    longest: 0,
    lastCheckIn: null,
    aliveThrough: null,
    history: [],
    offDays: [],
    lostStreak: 0,
  });
});
