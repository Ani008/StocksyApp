/**
 * services/streakLogic.js
 *
 * The rules of the daily streak. Pure: no database, no Redis, no real clock
 * (the caller passes "today"), so `node --test` can run it.
 *
 * A "day" is an IST calendar day written as a "YYYY-MM-DD" key. A day counts
 * toward the streak once the user has opened Stocksy on it (a check-in). The
 * streak is DERIVED from the set of check-in days; it is never stored as a
 * counter, so it can't drift from the calendar.
 */

const calendar = require("./marketCalendarService");

// How many past days we hand back to the app. The year calendar shows up to 371
// days (53 weeks), so this stays above that. Keep in step with the app's
// HISTORY_LIMIT in Stocksy_Mobile/src/utils/streak.js.
const HISTORY_LIMIT = 400;

const KEY_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86400000;

function keyToUtcMs(key) {
  const [y, m, d] = key.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

/** True for a real calendar day written "YYYY-MM-DD" (rejects 2026-02-31 etc.). */
function isValidKey(key) {
  if (typeof key !== "string" || !KEY_RE.test(key)) return false;
  const ms = keyToUtcMs(key);
  const dt = new Date(ms);
  return !Number.isNaN(ms) && dt.toISOString().slice(0, 10) === key;
}

/** Whole days from `fromKey` to `toKey` (negative if `toKey` is earlier). */
function dayDiff(fromKey, toKey) {
  return Math.round((keyToUtcMs(toKey) - keyToUtcMs(fromKey)) / DAY_MS);
}

/** The key `days` days after `key` (use a negative number to go back). */
function shiftKey(key, days) {
  return new Date(keyToUtcMs(key) + days * DAY_MS).toISOString().slice(0, 10);
}

/** The IST calendar day of `now`, e.g. "2026-10-22". */
function istDateKey(now = new Date()) {
  return calendar.getISTParts(now).isoDate;
}

/** Valid, de-duplicated keys in ascending order. */
function normalizeDays(days) {
  if (!Array.isArray(days)) return [];
  return [...new Set(days.filter(isValidKey))].sort();
}

/** Length of the run of consecutive days that ENDS at the last entry of `sortedDays`. */
function runEndingAtLast(sortedDays) {
  if (sortedDays.length === 0) return 0;
  let run = 1;
  for (let i = sortedDays.length - 1; i > 0; i--) {
    if (dayDiff(sortedDays[i - 1], sortedDays[i]) === 1) run += 1;
    else break;
  }
  return run;
}

/** The longest run of consecutive days anywhere in `sortedDays`. */
function longestRun(sortedDays) {
  let best = 0;
  let run = 0;
  for (let i = 0; i < sortedDays.length; i++) {
    run = i > 0 && dayDiff(sortedDays[i - 1], sortedDays[i]) === 1 ? run + 1 : 1;
    if (run > best) best = run;
  }
  return best;
}

/**
 * The streak as of `todayKey`.
 *
 * `current` is 0 once the last check-in is older than yesterday: that streak
 * has already ended, even if nobody has opened the app yet today to say so. A
 * check-in dated after `todayKey` is ignored.
 *
 * Returns { current, longest, lastCheckIn, history } where `history` is the
 * most recent HISTORY_LIMIT days (ascending).
 */
function computeStreak(days, todayKey) {
  const all = normalizeDays(days).filter((d) => !isValidKey(todayKey) || d <= todayKey);
  const lastCheckIn = all.length ? all[all.length - 1] : null;

  let current = 0;
  if (lastCheckIn && isValidKey(todayKey) && dayDiff(lastCheckIn, todayKey) <= 1) {
    current = runEndingAtLast(all);
  }

  return {
    current,
    longest: Math.max(longestRun(all), current),
    lastCheckIn,
    history: all.slice(-HISTORY_LIMIT),
  };
}

/**
 * The length of the streak that today's check-in just ENDED (0 if it did not
 * end one): the streak up to the last day before today, when that day is not
 * yesterday. Pass the days recorded BEFORE today.
 */
function lostStreakFor(daysBeforeToday, todayKey) {
  const prior = normalizeDays(daysBeforeToday).filter((d) => d < todayKey);
  if (prior.length === 0) return 0;
  const last = prior[prior.length - 1];
  return dayDiff(last, todayKey) === 1 ? 0 : runEndingAtLast(prior);
}

/**
 * Which of the days the app offered from its old on-device streak we will
 * accept. Only real days, strictly BEFORE today (today is recorded by the
 * server itself, never taken on trust) and no older than HISTORY_LIMIT days.
 */
function acceptableImportDays(candidates, todayKey) {
  if (!isValidKey(todayKey)) return [];
  const oldest = shiftKey(todayKey, -HISTORY_LIMIT);
  return normalizeDays(candidates)
    .filter((d) => d < todayKey && d >= oldest)
    .slice(-HISTORY_LIMIT);
}

module.exports = {
  HISTORY_LIMIT,
  isValidKey,
  dayDiff,
  shiftKey,
  istDateKey,
  normalizeDays,
  computeStreak,
  lostStreakFor,
  acceptableImportDays,
};
