/**
 * services/streakService.js
 *
 * The daily streak, saved on the server: record a check-in, read the streak.
 *
 * The rules live in streakLogic.js (pure, unit-tested). This file is the glue to
 * Postgres. It is built by a factory so tests can hand it a fake repository;
 * the real one is only loaded when the app actually runs.
 *
 * The day is always the IST calendar day taken from the SERVER's clock, so a
 * wrong phone clock can neither add nor remove a day.
 */

const logic = require("./streakLogic");

function createStreakService(repo) {
  /**
   * The streak without recording anything (the Profile / Streaks screens).
   * Returns { current, longest, lastCheckIn, history, today, isNewDay, lostStreak }.
   */
  async function getState(userId, { now = new Date() } = {}) {
    const today = logic.istDateKey(now);
    const days = await repo.getDays(userId);
    return { ...logic.computeStreak(days, today), today, isNewDay: false, lostStreak: 0 };
  }

  /**
   * Count today for this user (the app opening), and return the streak.
   * Safe to repeat: the second call finds today already recorded and returns
   * `isNewDay: false`, so two devices or a retry can never double-count.
   *
   * `importDays` is the streak the app had saved on the device before the
   * server kept it. It is accepted ONCE: only while the account has no
   * earlier check-ins on the server, and only real past days (see
   * acceptableImportDays). Without this, everyone's existing streak would
   * restart the day this shipped.
   */
  async function checkIn(userId, { now = new Date(), importDays = [] } = {}) {
    const today = logic.istDateKey(now);

    const offered = logic.acceptableImportDays(importDays, today);
    if (offered.length > 0 && !(await repo.hasDaysBefore(userId, today))) {
      await repo.importDays(userId, offered);
    }

    const isNewDay = await repo.recordCheckIn(userId, today);

    const days = await repo.getDays(userId);
    return {
      ...logic.computeStreak(days, today),
      today,
      isNewDay,
      lostStreak: isNewDay ? logic.lostStreakFor(days, today) : 0,
    };
  }

  return { getState, checkIn };
}

// The real service, wired to Postgres. The repository is required lazily so
// that tests importing createStreakService don't open a database pool.
let real = null;
const service = () => {
  if (!real) real = createStreakService(require("../repositories/streakRepository"));
  return real;
};

module.exports = {
  createStreakService,
  getState: (...args) => service().getState(...args),
  checkIn: (...args) => service().checkIn(...args),
};
