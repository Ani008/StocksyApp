/**
 * services/niftyPredictionLogic.js
 *
 * The rules of the daily Nifty call, with no database, Redis or clock of its
 * own — everything is passed in — so every rule can be unit-tested.
 *
 * The day, in IST:
 *
 *   09:15            the window opens (market open)
 *   LOCK (10:00)     calls lock; nobody can start one any more
 *   15:30            market closes; calls wait to be settled ("settling")
 *   ~15:32-15:40     the settle job captures the close and settles every call
 *
 * Why calls lock early instead of staying open all day: a call made at 2 PM,
 * with the day's move already on the screen, isn't a prediction. The lock is
 * what keeps a streak of correct calls meaningful.
 */

const calendar = require("./marketCalendarService");

const OPEN_HHMM = calendar.MARKET_OPEN_HHMM; // "09:15"
const CLOSE_HHMM = calendar.MARKET_CLOSE_HHMM; // "15:30"
const DEFAULT_LOCK_HHMM = "10:00";

// A close reading older than this (before the final minute of trading) is a
// mid-session price, not the close.
const CLOSE_READING_NOT_BEFORE_HHMM = "15:29";
// Once the feed has gone quiet this long, the last price is the closing price.
const FEED_QUIET_MS = 60 * 1000;
// If the feed never goes quiet (it keeps repeating the last value), stop
// waiting for quiet and take the latest reading from this time on.
const SETTLE_WITHOUT_QUIET_FROM_HHMM = "15:40";
// Past this time, give up on a day that never got a trustworthy close.
const SETTLE_GIVE_UP_HHMM = "16:00";
// Settling never starts before this, so the closing ticks have time to land.
const SETTLE_NOT_BEFORE_HHMM = "15:31";

const PHASE = Object.freeze({
  CLOSED_DAY: "CLOSED_DAY", //  weekend / exchange holiday
  BEFORE_OPEN: "BEFORE_OPEN", // trading day, before 09:15
  OPEN: "OPEN", //               can make today's call
  LOCKED: "LOCKED", //           window shut and no call was made
  PREDICTED: "PREDICTED", //     call is in; waiting for the close
  SETTLING: "SETTLING", //       market closed, result being worked out
  RESOLVED: "RESOLVED", //       result is in
});

const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * The lock time as "HH:MM". Falls back to the default when the env value is
 * missing, malformed, or outside the trading session — a typo in .env must
 * not be able to open (or never open) the window by accident.
 */
function getLockHhmm(env = process.env) {
  const raw = String(env.NIFTY_PREDICTION_LOCK_HHMM ?? "").trim();
  if (HHMM_RE.test(raw) && raw > OPEN_HHMM && raw < CLOSE_HHMM) return raw;
  return DEFAULT_LOCK_HHMM;
}

/**
 * Dev switch. In development (ENFORCE_MARKET_HOURS is not "true" — the same
 * convention orders use) the window is always open so the feature can be
 * tried at any hour. Production sets ENFORCE_MARKET_HOURS=true.
 */
function isAlwaysOpen(env = process.env) {
  return env.ENFORCE_MARKET_HOURS !== "true";
}

// Some JS engines render midnight as "24:xx" with hour12:false.
function normalizeHhmm(hhmm) {
  return typeof hhmm === "string" && hhmm.startsWith("24") ? `00${hhmm.slice(2)}` : hhmm;
}

/** IST wall-clock parts of `now`: { isoDate: "YYYY-MM-DD", hhmm: "HH:MM" }. */
function istNow(now = new Date()) {
  const { isoDate, hhmm } = calendar.getISTParts(now);
  return { isoDate, hhmm: normalizeHhmm(hhmm) };
}

/** The exact instant of `hhmm` on IST calendar day `isoDate`, as a Date. */
function istInstant(isoDate, hhmm) {
  return new Date(`${isoDate}T${hhmm}:00+05:30`);
}

/**
 * Which state the card should be in right now.
 *
 * @param {object}  p
 * @param {Date}    [p.now]
 * @param {object|null} p.prediction  today's call for this user, if any
 *                                    ({ status: 'PENDING'|'WON'|'LOST'|'VOID' })
 * @param {object}  [p.env]
 */
function getPhase({ now = new Date(), prediction = null, env = process.env } = {}) {
  const { isoDate, hhmm } = istNow(now);
  const alwaysOpen = isAlwaysOpen(env);

  if (prediction) {
    if (prediction.status !== "PENDING") return PHASE.RESOLVED;
    if (!alwaysOpen && hhmm >= CLOSE_HHMM) return PHASE.SETTLING;
    return PHASE.PREDICTED;
  }

  if (alwaysOpen) return PHASE.OPEN;
  if (!calendar.isTradingDay(isoDate)) return PHASE.CLOSED_DAY;
  if (hhmm < OPEN_HHMM) return PHASE.BEFORE_OPEN;
  if (hhmm < getLockHhmm(env)) return PHASE.OPEN;
  return PHASE.LOCKED;
}

/**
 * Today's window as ISO instants, or null when there is no session today.
 * The app counts down to these; it never has to know the clock rules.
 */
function getWindow({ now = new Date(), env = process.env } = {}) {
  const { isoDate } = istNow(now);
  if (!calendar.isTradingDay(isoDate) && !isAlwaysOpen(env)) return null;
  return {
    opensAt: istInstant(isoDate, OPEN_HHMM).toISOString(),
    locksAt: istInstant(isoDate, getLockHhmm(env)).toISOString(),
    settlesAt: istInstant(isoDate, CLOSE_HHMM).toISOString(),
  };
}

/** "10:00" -> "10:00 AM", "15:30" -> "3:30 PM" (for text shown to people). */
function formatHhmm(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  const suffix = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${suffix}`;
}

/**
 * Streaks over a user's calls.
 *
 *   streak  = correct calls in a row. A wrong call resets it to 0.
 *   Skipping a day does NOT reset it, and neither does a VOID day (the close
 *   landed exactly on the baseline) or a call that is still PENDING — only an
 *   actual wrong call does. (To make skipping a day also break the streak,
 *   this is the one place to change.)
 *
 * @param {Array<{trade_date: string, status: string}>} rows any order
 * @returns {{ current: number, best: number, won: number, lost: number }}
 */
function computeStreaks(rows) {
  const ordered = [...(rows || [])]
    .filter((r) => r && (r.status === "WON" || r.status === "LOST"))
    .sort((a, b) => (a.trade_date < b.trade_date ? -1 : a.trade_date > b.trade_date ? 1 : 0));

  let run = 0;
  let best = 0;
  let won = 0;
  let lost = 0;
  for (const r of ordered) {
    if (r.status === "WON") {
      run += 1;
      won += 1;
      if (run > best) best = run;
    } else {
      run = 0;
      lost += 1;
    }
  }
  return { current: run, best, won, lost };
}

/** Two decimals, as a number — the same precision the database stores. */
function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

/**
 * Decide whether the feed's latest Nifty reading can be used as today's close.
 *
 * @param {object}      p
 * @param {object|null} p.quote   { ltp, tsMs } from the live feed (tsMs = when
 *                                the feed last updated, epoch ms) or null
 * @param {Date}        p.now
 * @returns {{status:'READY', close:number} | {status:'WAIT'} | {status:'GIVE_UP'}}
 *
 *   WAIT     not yet (too early, or the feed is still ticking) — try again
 *   READY    use `close`
 *   GIVE_UP  it's too late to get a trustworthy close; void the day
 */
function evaluateCloseReading({ quote, now = new Date() }) {
  const { isoDate, hhmm } = istNow(now);

  if (hhmm < SETTLE_NOT_BEFORE_HHMM) return { status: "WAIT" };

  const giveUp = hhmm >= SETTLE_GIVE_UP_HHMM;
  const nowMs = now.getTime();
  const notBeforeMs = istInstant(isoDate, CLOSE_READING_NOT_BEFORE_HHMM).getTime();

  const ltp = quote ? Number(quote.ltp) : NaN;
  const tsMs = quote ? Number(quote.tsMs) : NaN;
  const usable =
    Number.isFinite(ltp) && ltp > 0 && Number.isFinite(tsMs) && tsMs >= notBeforeMs;

  if (!usable) return giveUp ? { status: "GIVE_UP" } : { status: "WAIT" };

  const quiet = nowMs - tsMs >= FEED_QUIET_MS;
  if (quiet || hhmm >= SETTLE_WITHOUT_QUIET_FROM_HHMM) {
    return { status: "READY", close: round2(ltp) };
  }
  return giveUp ? { status: "GIVE_UP" } : { status: "WAIT" };
}

module.exports = {
  PHASE,
  OPEN_HHMM,
  CLOSE_HHMM,
  DEFAULT_LOCK_HHMM,
  getLockHhmm,
  isAlwaysOpen,
  istNow,
  istInstant,
  getPhase,
  getWindow,
  formatHhmm,
  computeStreaks,
  evaluateCloseReading,
  round2,
};
