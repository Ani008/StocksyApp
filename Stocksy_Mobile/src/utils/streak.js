/**
 * Pure helpers for the daily streak. No React, react-native or storage here
 * (the caller passes "today" in) so `node --test` can run them.
 *
 * A "day" is an IST calendar day, written as a "YYYY-MM-DD" key. A day counts
 * toward the streak once the person has DONE something on it: made their daily
 * Nifty call, or placed a buy / sell order. Just opening the app does not count.
 *
 * The server keeps and judges the streak (Stocksy_Server/services/streakLogic.js:
 * streaks run on trading days, so weekends and market holidays neither add to
 * nor break one). This file only shapes what the server sends for display.
 */

// How many past check-in days we keep. The year calendar shows up to 371 days
// (53 weeks), so this has to stay above that or its left edge would be empty.
export const HISTORY_LIMIT = 400;

export const MILESTONES = [3, 7, 14, 30, 60, 100, 200, 365];

export const EMPTY_STREAK = {
  current: 0,
  longest: 0,
  lastCheckIn: null,
  // The last day `current` stays alive without more activity (the next trading
  // day after lastCheckIn), as the server works it out.
  aliveThrough: null,
  history: [],
  // Weekends and holidays around today, so the week strip can show them as
  // "off" instead of "missed".
  offDays: [],
  // When today's activity just started a new run: the length of the run it
  // replaced (0 otherwise). Feeds the "your streak ended" line.
  lostStreak: 0,
};

export const WEEKDAY_LABELS = ["M", "T", "W", "T", "F", "S", "S"];

const KEY_RE = /^\d{4}-\d{2}-\d{2}$/;
const pad = (n) => String(n).padStart(2, "0");

export const isValidKey = (key) => typeof key === "string" && KEY_RE.test(key);

/** Local calendar day of `date` as "YYYY-MM-DD". */
export function toDateKey(date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

const IST_OFFSET_MS = 330 * 60 * 1000; // UTC+05:30, no daylight saving

/**
 * The IST calendar day of `date` as "YYYY-MM-DD", whatever the device's own
 * timezone is. The server counts streak days in IST (the exchange's day), so
 * the app must name days the same way or the week strip and calendar would
 * disagree with the saved history for anyone outside India.
 */
export function toIstDateKey(date = new Date()) {
  const ist = new Date(date.getTime() + IST_OFFSET_MS);
  return `${ist.getUTCFullYear()}-${pad(ist.getUTCMonth() + 1)}-${pad(ist.getUTCDate())}`;
}

/** The milestone `current` hits (3, 7, 14...), or 0 if it is not one. */
export function milestoneFor(current) {
  return MILESTONES.includes(current) ? current : 0;
}

function keyToUtcMs(key) {
  const [y, m, d] = key.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

/** Whole days from `fromKey` to `toKey` (negative if `toKey` is earlier). */
export function dayDiff(fromKey, toKey) {
  return Math.round((keyToUtcMs(toKey) - keyToUtcMs(fromKey)) / 86400000);
}

/** The key `days` days after `key` (use a negative number to go back). */
export function shiftKey(key, days) {
  const dt = new Date(keyToUtcMs(key) + days * 86400000);
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

/**
 * Turn whatever came out of storage into a safe state object. A corrupted or
 * hand-edited value must never crash the dashboard.
 */
export function sanitizeState(raw) {
  if (!raw || typeof raw !== "object") return { ...EMPTY_STREAK, history: [], offDays: [] };

  const history = Array.isArray(raw.history)
    ? [...new Set(raw.history.filter(isValidKey))].sort().slice(-HISTORY_LIMIT)
    : [];
  const lastCheckIn = isValidKey(raw.lastCheckIn) ? raw.lastCheckIn : null;
  const aliveThrough = lastCheckIn && isValidKey(raw.aliveThrough) ? raw.aliveThrough : null;
  const offDays = Array.isArray(raw.offDays) ? [...new Set(raw.offDays.filter(isValidKey))].sort() : [];
  const lostStreak = Number.isFinite(raw.lostStreak) && raw.lostStreak > 0 ? Math.floor(raw.lostStreak) : 0;
  const current =
    Number.isFinite(raw.current) && raw.current > 0 && lastCheckIn
      ? Math.floor(raw.current)
      : 0;
  const longest = Math.max(
    current,
    Number.isFinite(raw.longest) && raw.longest > 0 ? Math.floor(raw.longest) : 0,
  );

  return { current, longest, lastCheckIn, aliveThrough, history, offDays, lostStreak };
}

/**
 * The streak to *display* for `todayKey`. A streak that was not kept alive
 * through its last trading day has already ended, even if nothing has told the
 * app yet.
 */
export function effectiveStreak(state, todayKey) {
  const s = sanitizeState(state);
  if (!s.lastCheckIn || !isValidKey(todayKey)) return 0;
  // The server says how long it stays alive (it knows the market calendar:
  // Friday's streak is still alive on Monday). A copy saved before it did has
  // no such date, so fall back to "yesterday or today".
  if (s.aliveThrough) return todayKey <= s.aliveThrough ? s.current : 0;
  return dayDiff(s.lastCheckIn, todayKey) <= 1 ? s.current : 0;
}

/**
 * The Monday-to-Sunday week containing `todayKey`, one entry per day:
 *   { key, label, dayNumber, status, isToday }
 * status: "done" | "off" (weekend or market holiday, nothing to do) |
 *         "missed" | "pending" (today, nothing done yet) | "upcoming"
 *
 * `offDays` comes from the server (it knows the market holidays). A day that
 * is off but was still done (an order placed on a special session) shows done.
 */
export function getWeek(todayKey, history = [], offDays = []) {
  if (!isValidKey(todayKey)) return [];
  const done = new Set(history);
  const off = new Set(offDays);
  const dow = new Date(keyToUtcMs(todayKey)).getUTCDay(); // 0 = Sunday
  const monday = shiftKey(todayKey, -((dow + 6) % 7));

  return WEEKDAY_LABELS.map((label, i) => {
    const key = shiftKey(monday, i);
    const isToday = key === todayKey;
    let status;
    if (done.has(key)) status = "done";
    else if (off.has(key)) status = "off";
    else if (isToday) status = "pending";
    else if (key < todayKey) status = "missed";
    else status = "upcoming";

    return { key, label, dayNumber: Number(key.slice(8)), status, isToday };
  });
}

/** Runs of 2+ consecutive "done" days in a week, as [startIndex, endIndex]. */
export function getDoneRuns(week) {
  const runs = [];
  let start = null;
  week.forEach((day, i) => {
    if (day.status === "done") {
      if (start === null) start = i;
    } else if (start !== null) {
      if (i - 1 > start) runs.push([start, i - 1]);
      start = null;
    }
  });
  if (start !== null && week.length - 1 > start) runs.push([start, week.length - 1]);
  return runs;
}

/** The line shown under the week strip. */
export function getStreakMessage({ current = 0, lostStreak = 0, milestone = 0, doneToday = true } = {}) {
  if (milestone >= 365) return "A full year, every single day. Legendary.";
  if (milestone >= 100) return `${milestone} days straight. That's elite consistency.`;
  if (milestone >= 30) return `${milestone} days in a row. This is a real habit now.`;
  if (milestone >= 14) return "Two weeks strong. Keep the flame alive.";
  if (milestone >= 7) return "A full week! Consistency beats timing.";
  if (milestone >= 3) return "You're on fire! Three days in a row.";

  if (current <= 0) return "Make your Nifty call or place a trade to start a streak.";
  // A streak that is alive but has nothing done yet today.
  if (!doneToday) return "Make your Nifty call or place a trade to keep your streak going.";
  if (current === 1) {
    return lostStreak > 0
      ? `Your ${lostStreak}-day streak ended. A fresh one starts today.`
      : "Day one is locked in. Come back next trading day to build it.";
  }
  if (current === 2) return "Two in a row. Momentum is building.";
  if (current < 7) return "You're on fire! Keep the chain going.";
  return `${current} days and counting. Don't break the chain.`;
}

// ── Year calendar (GitHub-style contribution grid) ──────────────────────────

export const YEAR_WEEKS = 53;
export const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/**
 * Turn an activity count for one day into a shade, 0 (none) to 4 (most).
 * Today a check-in is the only activity, so a checked-in day is level 3; more
 * kinds of activity can feed `count` later and reach the darker shades.
 */
export function levelForCount(count) {
  if (!count || count <= 0) return 0;
  return Math.min(4, 2 + count);
}

/**
 * The last 53 weeks ending with the week that contains `todayKey`, as columns
 * of 7 days (Monday at the top, matching the week strip).
 *
 *   activity   array of "YYYY-MM-DD" keys, one per activity (repeat a key for
 *              more than one on that day)
 *
 * Returns { weeks, months, total }:
 *   weeks[col][row] = { key, count, level, future }   future = after today
 *   months          = [{ col, label }] where a new month's first week starts
 *   total           = number of days with any activity in the range
 */
export function getYearGrid(todayKey, activity = [], weekCount = YEAR_WEEKS) {
  if (!isValidKey(todayKey)) return { weeks: [], months: [], total: 0 };

  const counts = {};
  for (const key of activity) {
    if (isValidKey(key)) counts[key] = (counts[key] || 0) + 1;
  }

  const dow = new Date(keyToUtcMs(todayKey)).getUTCDay(); // 0 = Sunday
  const thisMonday = shiftKey(todayKey, -((dow + 6) % 7));
  const firstMonday = shiftKey(thisMonday, -7 * (weekCount - 1));

  let total = 0;
  const weeks = [];
  for (let col = 0; col < weekCount; col++) {
    const monday = shiftKey(firstMonday, col * 7);
    const days = [];
    for (let row = 0; row < 7; row++) {
      const key = shiftKey(monday, row);
      const future = key > todayKey;
      const count = future ? 0 : counts[key] || 0;
      if (count > 0) total += 1;
      days.push({ key, count, level: levelForCount(count), future });
    }
    weeks.push(days);
  }

  // Label a column where a new month begins. The first column is labelled too,
  // unless the next label is so close that the two would overlap.
  const months = [];
  let lastMonth = -1;
  weeks.forEach((days, col) => {
    const month = Number(days[0].key.slice(5, 7)) - 1;
    if (month !== lastMonth) {
      months.push({ col, label: MONTH_NAMES[month] });
      lastMonth = month;
    }
  });
  if (months.length > 1 && months[1].col - months[0].col < 3) months.shift();

  return { weeks, months, total };
}

/** "Tue, 14 Oct 2026" for a "YYYY-MM-DD" key. */
export function formatDateKey(key) {
  if (!isValidKey(key)) return "";
  const dt = new Date(keyToUtcMs(key));
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return `${days[dt.getUTCDay()]}, ${dt.getUTCDate()} ${MONTH_NAMES[dt.getUTCMonth()]} ${dt.getUTCFullYear()}`;
}
