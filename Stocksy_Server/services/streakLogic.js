/**
 * services/streakLogic.js
 *
 * The rules of the daily streak. Pure: no database, no Redis, no real clock
 * (the caller passes "today"), so `node --test` can run it.
 *
 * A day counts toward the streak once the user has DONE something on it: made
 * their daily Nifty call, or placed a buy / sell order (delivery or intraday).
 * Just opening the app does not count.
 *
 * Streaks run on TRADING days. Both of those actions only exist while the
 * market is open, so on a weekend or an exchange holiday nobody CAN do either.
 * Those days therefore neither add to a streak nor break it: Friday followed by
 * Monday is two days in a row. A day is an IST calendar day written as a
 * "YYYY-MM-DD" key.
 *
 * The streak is DERIVED from the set of active days; it is never stored as a
 * counter, so it can't drift from the calendar.
 */

const calendar = require("./marketCalendarService");

// How many past days we hand back to the app. The year calendar shows up to 371
// days (53 weeks), so this stays above that. Keep in step with the app's
// HISTORY_LIMIT in Stocksy_Mobile/src/utils/streak.js.
const HISTORY_LIMIT = 400;

// The app draws a week strip, so it needs to know which days around today are
// not trading days (weekends and holidays) to show them as "off" rather than
// "missed". This is how far either side of today we list them.
const OFF_DAYS_WINDOW = 7;

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

// ── trading days ────────────────────────────────────────────────────────────

/** Mon-Fri and not an exchange holiday. */
function isTradingDay(key) {
  return calendar.isTradingDay(key);
}

/**
 * The first trading day strictly AFTER `key`. The search is bounded so a
 * calendar that was never updated (no holidays listed for a new year) can't
 * loop forever; no real gap is anywhere near this long.
 */
function nextTradingDay(key) {
  let k = key;
  for (let i = 0; i < 20; i++) {
    k = shiftKey(k, 1);
    if (isTradingDay(k)) return k;
  }
  return k;
}

/**
 * Is `b` the very next stretch after `a` once off-days are skipped, i.e. no
 * trading day falls strictly between them? Friday -> Monday is consecutive;
 * Monday -> Wednesday is not (Tuesday was a trading day).
 */
function isConsecutive(a, b) {
  return b > a && nextTradingDay(a) >= b;
}

/**
 * The last day a streak that ends on `lastCheckIn` stays alive: the next
 * trading day. Active by then and the streak continues; miss it and it ends.
 */
function aliveThrough(lastCheckIn) {
  return isValidKey(lastCheckIn) ? nextTradingDay(lastCheckIn) : null;
}

/** Non-trading days (weekends and holidays) within a week either side of today. */
function offDaysAround(todayKey) {
  if (!isValidKey(todayKey)) return [];
  const out = [];
  for (let i = -OFF_DAYS_WINDOW; i <= OFF_DAYS_WINDOW; i++) {
    const k = shiftKey(todayKey, i);
    if (!isTradingDay(k)) out.push(k);
  }
  return out;
}

// ── the streak ──────────────────────────────────────────────────────────────

/** Valid, de-duplicated keys in ascending order. */
function normalizeDays(days) {
  if (!Array.isArray(days)) return [];
  return [...new Set(days.filter(isValidKey))].sort();
}

/** Length of the run that ENDS at the last entry of `sortedDays`. */
function runEndingAtLast(sortedDays) {
  if (sortedDays.length === 0) return 0;
  let run = 1;
  for (let i = sortedDays.length - 1; i > 0; i--) {
    if (isConsecutive(sortedDays[i - 1], sortedDays[i])) run += 1;
    else break;
  }
  return run;
}

/** The longest run anywhere in `sortedDays`. */
function longestRun(sortedDays) {
  let best = 0;
  let run = 0;
  for (let i = 0; i < sortedDays.length; i++) {
    run = i > 0 && isConsecutive(sortedDays[i - 1], sortedDays[i]) ? run + 1 : 1;
    if (run > best) best = run;
  }
  return best;
}

/**
 * The streak as of `todayKey`.
 *
 * Returns:
 *   current       the streak, or 0 once it has ended (the last active day is
 *                 older than the previous trading day, so a trading day went by
 *                 with nothing done). A day dated after today is ignored.
 *   longest       the best run ever
 *   lastCheckIn   the last active day, or null
 *   aliveThrough  the last day `current` stays alive without more activity
 *   history       the most recent HISTORY_LIMIT active days (ascending)
 *   offDays       weekends/holidays around today, for the week strip
 *   lostStreak    when today's activity just STARTED a new run, the length of
 *                 the run it replaced (else 0), for the "your streak ended" line
 */
function computeStreak(days, todayKey) {
  const all = normalizeDays(days).filter((d) => !isValidKey(todayKey) || d <= todayKey);
  const lastCheckIn = all.length ? all[all.length - 1] : null;
  const through = aliveThrough(lastCheckIn);

  const alive = !!lastCheckIn && isValidKey(todayKey) && todayKey <= through;
  const current = alive ? runEndingAtLast(all) : 0;

  let lostStreak = 0;
  if (alive && lastCheckIn === todayKey && current === 1 && all.length > 1) {
    lostStreak = runEndingAtLast(all.slice(0, -1));
  }

  return {
    current,
    longest: Math.max(longestRun(all), current),
    lastCheckIn,
    aliveThrough: through,
    history: all.slice(-HISTORY_LIMIT),
    offDays: offDaysAround(todayKey),
    lostStreak,
  };
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
  isTradingDay,
  nextTradingDay,
  isConsecutive,
  aliveThrough,
  offDaysAround,
  normalizeDays,
  computeStreak,
  acceptableImportDays,
};
