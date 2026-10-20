/**
 * Pure helpers for the daily streak. No React, react-native or storage here
 * (the caller passes "today" in) so `node --test` can run them.
 *
 * A "day" is a local calendar day, written as a "YYYY-MM-DD" key. A day counts
 * toward the streak once the person has opened Stocksy on it (a check-in).
 */

// How many past check-in days we keep. Plenty for the week strip now and a
// month-view calendar on the full page later.
export const HISTORY_LIMIT = 120;

export const MILESTONES = [3, 7, 14, 30, 60, 100, 200, 365];

export const EMPTY_STREAK = {
  current: 0,
  longest: 0,
  lastCheckIn: null,
  history: [],
};

export const WEEKDAY_LABELS = ["M", "T", "W", "T", "F", "S", "S"];

const KEY_RE = /^\d{4}-\d{2}-\d{2}$/;
const pad = (n) => String(n).padStart(2, "0");

export const isValidKey = (key) => typeof key === "string" && KEY_RE.test(key);

/** Local calendar day of `date` as "YYYY-MM-DD". */
export function toDateKey(date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
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
  if (!raw || typeof raw !== "object") return { ...EMPTY_STREAK, history: [] };

  const history = Array.isArray(raw.history)
    ? [...new Set(raw.history.filter(isValidKey))].sort().slice(-HISTORY_LIMIT)
    : [];
  const lastCheckIn = isValidKey(raw.lastCheckIn) ? raw.lastCheckIn : null;
  const current =
    Number.isFinite(raw.current) && raw.current > 0 && lastCheckIn
      ? Math.floor(raw.current)
      : 0;
  const longest = Math.max(
    current,
    Number.isFinite(raw.longest) && raw.longest > 0 ? Math.floor(raw.longest) : 0,
  );

  return { current, longest, lastCheckIn, history };
}

/**
 * Record a check-in for `todayKey`.
 *
 * Returns { state, isNewDay, lostStreak, milestone }:
 *   isNewDay    true only the first time today is recorded
 *   lostStreak  length of the streak that just ended (0 if none ended)
 *   milestone   the streak length if today's check-in hit a milestone, else 0
 */
export function applyCheckIn(prev, todayKey) {
  const state = sanitizeState(prev);
  const unchanged = { state, isNewDay: false, lostStreak: 0, milestone: 0 };

  if (!isValidKey(todayKey)) return unchanged;

  if (state.lastCheckIn) {
    const gap = dayDiff(state.lastCheckIn, todayKey);
    // Already counted today, or the device clock moved backwards. Either way
    // leave the streak alone rather than punish the person for it.
    if (gap <= 0) {
      if (gap === 0 && !state.history.includes(todayKey)) {
        state.history = [...state.history, todayKey].sort().slice(-HISTORY_LIMIT);
      }
      return unchanged;
    }
  }

  const gap = state.lastCheckIn ? dayDiff(state.lastCheckIn, todayKey) : null;
  const continues = gap === 1;
  const lostStreak = state.current > 0 && !continues ? state.current : 0;
  const current = continues ? state.current + 1 : 1;

  const next = {
    current,
    longest: Math.max(state.longest, current),
    lastCheckIn: todayKey,
    history: [...state.history, todayKey].sort().slice(-HISTORY_LIMIT),
  };

  return {
    state: next,
    isNewDay: true,
    lostStreak,
    milestone: MILESTONES.includes(current) ? current : 0,
  };
}

/**
 * The streak to *display* for `todayKey`. A streak whose last check-in is
 * older than yesterday has already ended, even if nobody has opened the app
 * yet today to reset it.
 */
export function effectiveStreak(state, todayKey) {
  const s = sanitizeState(state);
  if (!s.lastCheckIn || !isValidKey(todayKey)) return 0;
  return dayDiff(s.lastCheckIn, todayKey) <= 1 ? s.current : 0;
}

/**
 * The Monday-to-Sunday week containing `todayKey`, one entry per day:
 *   { key, label, dayNumber, status, isToday }
 * status: "done" | "missed" | "pending" (today, not checked in yet) | "upcoming"
 */
export function getWeek(todayKey, history = []) {
  if (!isValidKey(todayKey)) return [];
  const done = new Set(history);
  const dow = new Date(keyToUtcMs(todayKey)).getUTCDay(); // 0 = Sunday
  const monday = shiftKey(todayKey, -((dow + 6) % 7));

  return WEEKDAY_LABELS.map((label, i) => {
    const key = shiftKey(monday, i);
    const isToday = key === todayKey;
    let status;
    if (done.has(key)) status = "done";
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
export function getStreakMessage({ current = 0, lostStreak = 0, milestone = 0 } = {}) {
  if (milestone >= 365) return "A full year, every single day. Legendary.";
  if (milestone >= 100) return `${milestone} days straight. That's elite consistency.`;
  if (milestone >= 30) return `${milestone} days in a row. This is a real habit now.`;
  if (milestone >= 14) return "Two weeks strong. Keep the flame alive.";
  if (milestone >= 7) return "A full week! Consistency beats timing.";
  if (milestone >= 3) return "You're on fire! Three days in a row.";

  if (current <= 0) return "Open Stocksy every day to start a streak.";
  if (current === 1) {
    return lostStreak > 0
      ? `Your ${lostStreak}-day streak ended. A fresh one starts today.`
      : "Day one is locked in. Come back tomorrow to build it.";
  }
  if (current === 2) return "Two in a row. Momentum is building.";
  if (current < 7) return "You're on fire! Keep the chain going.";
  return `${current} days and counting. Don't break the chain.`;
}
