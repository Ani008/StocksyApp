/**
 * services/streakService.js
 *
 * The daily streak, saved on the server: record an active day, read the streak.
 *
 * A day is recorded when the user DOES something: places a buy / sell order
 * (delivery or intraday) or makes their daily Nifty call. Opening the app does
 * not count. The two callers are orderController (after an order is placed) and
 * niftyPredictionController (after a call is locked in).
 *
 * The rules live in streakLogic.js (pure, unit-tested). This file is the glue to
 * Postgres. It is built by a factory so tests can hand it a fake repository;
 * the real one is only loaded when the app actually runs.
 *
 * The day is always the IST calendar day taken from the SERVER's clock, so a
 * wrong phone clock can neither add nor remove a day.
 */

const logic = require("./streakLogic");

const SOURCES = ["order", "nifty"];

function createStreakService(repo) {
  /**
   * The streak without recording anything (every screen that shows it).
   * Returns { current, longest, lastCheckIn, aliveThrough, history, offDays,
   *           lostStreak, today, isNewDay: false }.
   */
  async function getState(userId, { now = new Date() } = {}) {
    const today = logic.istDateKey(now);
    const days = await repo.getDays(userId);
    return { ...logic.computeStreak(days, today), today, isNewDay: false };
  }

  /**
   * Count today for this user because they did something real (`source` is
   * "order" or "nifty"), and return the streak.
   *
   * Safe to repeat: a second order, a retry, a second device all find today
   * already recorded and return `isNewDay: false`.
   */
  async function recordActivity(userId, source, { now = new Date() } = {}) {
    if (!SOURCES.includes(source)) throw new Error(`Unknown streak source: ${source}`);
    const today = logic.istDateKey(now);
    const isNewDay = await repo.recordCheckIn(userId, today);
    const days = await repo.getDays(userId);
    return { ...logic.computeStreak(days, today), today, isNewDay };
  }

  /**
   * Accept, ONCE, the streak the app had saved on the device before the server
   * kept it, so an existing streak isn't lost. Accepted only while the account
   * has no earlier days on the server, and only real past days (see
   * acceptableImportDays). Records nothing for today and returns the streak.
   */
  async function importLegacy(userId, importDays = [], { now = new Date() } = {}) {
    const today = logic.istDateKey(now);
    const offered = logic.acceptableImportDays(importDays, today);
    if (offered.length > 0 && !(await repo.hasDaysBefore(userId, today))) {
      await repo.importDays(userId, offered);
    }
    return getState(userId, { now });
  }

  return { getState, recordActivity, importLegacy };
}

// The real service, wired to Postgres. The repository is required lazily so
// that tests importing createStreakService don't open a database pool.
let real = null;
const service = () => {
  if (!real) real = createStreakService(require("../repositories/streakRepository"));
  return real;
};

/**
 * Record an active day from a place that must NEVER fail because of it (an
 * order that is already placed, a call that is already locked in). Any error is
 * logged and swallowed, and the streak simply isn't counted that time.
 *
 * Await it before answering the request, so a streak screen opened straight
 * afterwards already sees the day. Returns the streak, or null on failure.
 */
async function recordActivitySafe(userId, source) {
  try {
    return await service().recordActivity(userId, source);
  } catch (err) {
    require("../utils/logger").error(`[STREAK] Could not record ${source} activity: ${err.message}`);
    return null;
  }
}

module.exports = {
  createStreakService,
  recordActivitySafe,
  getState: (...args) => service().getState(...args),
  recordActivity: (...args) => service().recordActivity(...args),
  importLegacy: (...args) => service().importLegacy(...args),
};
