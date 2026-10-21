/**
 * services/marketCalendarService.js
 *
 * Single source of truth for "is the market open right now" and
 * "when does it next open" — used by orderService (to block orders)
 * and by the /api/market/status endpoint (so the frontend can show a
 * banner/message box proactively, before the user even tries to place
 * an order).
 *
 * Trading session: Mon–Fri, 09:15–15:30 IST, minus NSE/BSE holidays
 * (config/marketHolidays.js). Weekends and holidays are both "closed
 * all day" — next open always rolls forward to the next valid trading
 * day at 09:15 IST.
 *
 * Everything here is computed in Asia/Kolkata regardless of the host
 * server's timezone, the same way the original isMarketOpen() in
 * orderService.js did it — Intl-based extraction rather than assuming
 * `new Date()` is already IST.
 */

const { isTradingHoliday, getHolidayName } = require('../config/marketHolidays');

const TIMEZONE = 'Asia/Kolkata';
const MARKET_OPEN_HHMM = '09:15';
const MARKET_CLOSE_HHMM = '15:30';
const IST_OFFSET = '+05:30';

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// ─────────────────────────────────────────────────────────────
// IST wall-clock extraction
// ─────────────────────────────────────────────────────────────

/**
 * Pulls the IST calendar date/time out of any JS Date, regardless of
 * the server's own timezone.
 * @returns {{ isoDate: string, hhmm: string, weekday: string, dayOfWeek: number }}
 */
function getISTParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    weekday: 'long',
  }).formatToParts(date);

  const get = (type) => parts.find((p) => p.type === type)?.value;

  const isoDate = `${get('year')}-${get('month')}-${get('day')}`;
  const hhmm = `${get('hour')}:${get('minute')}`;
  const weekday = get('weekday');
  const dayOfWeek = WEEKDAY_NAMES.indexOf(weekday);

  return { isoDate, hhmm, weekday, dayOfWeek };
}

/** Adds `days` calendar days to an 'YYYY-MM-DD' IST date string. */
function addDaysToIsoDate(isoDate, days) {
  const [y, m, d] = isoDate.split('-').map(Number);
  // Noon UTC avoids DST/rounding edge cases entirely — we only care
  // about the calendar date component, not the time.
  const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

function isWeekendIsoDate(isoDate) {
  const [y, m, d] = isoDate.split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d, 12, 0, 0)).getUTCDay();
  return dow === 0 || dow === 6; // Sun=0, Sat=6
}

/** True if `isoDate` is a Mon–Fri trading day (not weekend, not holiday). */
function isTradingDay(isoDate) {
  return !isWeekendIsoDate(isoDate) && !isTradingHoliday(isoDate);
}

// ─────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────

/**
 * @returns {boolean} true if the market is open right now.
 * Honors ENFORCE_MARKET_HOURS=false the same way the old orderService
 * check did, so local/dev testing outside trading hours still works.
 */
function isMarketOpen(now = new Date()) {
  if (process.env.ENFORCE_MARKET_HOURS !== 'true') {
    return true;
  }

  const { isoDate, hhmm } = getISTParts(now);

  if (!isTradingDay(isoDate)) return false;

  return hhmm >= MARKET_OPEN_HHMM && hhmm <= MARKET_CLOSE_HHMM;
}

/**
 * Why the market is closed right now, for messaging purposes.
 * Returns null if the market is currently open.
 */
function getClosedReason(now = new Date()) {
  const { isoDate, hhmm, weekday } = getISTParts(now);

  if (isWeekendIsoDate(isoDate)) {
    return { type: 'WEEKEND', label: `${weekday}` };
  }

  const holidayName = getHolidayName(isoDate);
  if (holidayName) {
    return { type: 'HOLIDAY', label: holidayName };
  }

  if (hhmm < MARKET_OPEN_HHMM) {
    return { type: 'BEFORE_HOURS', label: 'Market has not opened yet today' };
  }

  if (hhmm > MARKET_CLOSE_HHMM) {
    return { type: 'AFTER_HOURS', label: 'Market has closed for today' };
  }

  return null; // market is open
}

/**
 * Finds the next trading-day open datetime (09:15 IST), skipping
 * weekends and holidays. If the market is currently open, returns the
 * current session's open time (today at 09:15 IST) for consistency,
 * though callers should generally check isMarketOpen() first.
 *
 * @returns {{
 *   isoDate: string,       // 'YYYY-MM-DD' IST
 *   time: string,          // '09:15' IST
 *   iso: string,           // full ISO 8601 with +05:30 offset
 *   dateLabel: string,     // e.g. 'Monday, 27 July 2026'
 *   timeLabel: string,     // e.g. '9:15 AM'
 * }}
 */
function getNextMarketOpen(now = new Date()) {
  const { isoDate, hhmm } = getISTParts(now);

  // If today is a trading day and we're before the open, next open is
  // today. Otherwise roll forward to the next trading day.
  let candidateDate = isoDate;
  if (!(isTradingDay(isoDate) && hhmm < MARKET_OPEN_HHMM)) {
    candidateDate = addDaysToIsoDate(isoDate, 1);
    while (!isTradingDay(candidateDate)) {
      candidateDate = addDaysToIsoDate(candidateDate, 1);
    }
  }

  return buildOpenMoment(candidateDate);
}

function buildOpenMoment(isoDate) {
  const iso = `${isoDate}T${MARKET_OPEN_HHMM}:00${IST_OFFSET}`;
  const asDate = new Date(iso);

  const dateLabel = asDate.toLocaleDateString('en-IN', {
    timeZone: TIMEZONE,
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });

  const timeLabel = asDate.toLocaleTimeString('en-US', {
    timeZone: TIMEZONE,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });

  return {
    isoDate,
    time: MARKET_OPEN_HHMM,
    iso,
    dateLabel,
    timeLabel,
  };
}

/**
 * One-stop status object for the /api/market/status endpoint.
 */
function getMarketStatus(now = new Date()) {
  const open = isMarketOpen(now);

  if (open) {
    return { isOpen: true, reason: null, nextOpen: null };
  }

  const reason = getClosedReason(now);
  const nextOpen = getNextMarketOpen(now);

  return { isOpen: false, reason, nextOpen };
}

module.exports = {
  getISTParts,
  isTradingDay,
  isMarketOpen,
  getClosedReason,
  getNextMarketOpen,
  getMarketStatus,
  MARKET_OPEN_HHMM,
  MARKET_CLOSE_HHMM,
};