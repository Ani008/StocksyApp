/**
 * services/marketOpenNotifier.js
 *
 * The everyday "reason to come back" push, sent once per trading day shortly
 * after the open:
 *
 *     Nifty opened +0.8%
 *     Your portfolio is +₹2,300 today
 *
 * How the numbers are made (all from Redis, no extra data source):
 *   - Nifty move      = (ltp - cp) / cp for "NSE_INDEX|Nifty 50", where `cp`
 *                       is the previous close in the Upstox ltpc tick.
 *   - Portfolio move  = Σ (ltp - cp) * quantity over the user's open positions
 *                       (short positions have a negative quantity, so they
 *                       flip correctly). At ~9:20 every open position was
 *                       carried from yesterday (MIS is squared off at 15:20),
 *                       so "previous close" is the right basis.
 *
 * Safety properties:
 *   - Trading days only (weekends + NSE/BSE holidays are skipped).
 *   - Never sends from stale data. `stock:*` keys never expire, so a dead feed
 *     would otherwise replay yesterday's prices as "today". Every quote must
 *     have a `stock_ts` tick timestamp younger than MAX_TICK_AGE_SECONDS.
 *   - At most once per day, even with several server instances: the day is
 *     claimed in Redis (SET NX) right before sending.
 *   - Cron fires every minute from 09:20 to 09:29 so a late feed just delays
 *     the push by a minute instead of skipping the day.
 *   - Only users who have a push subscription are looked at. Never throws.
 */

const cron = require("node-cron");
const redisClient = require("./redisService");
const marketCalendar = require("./marketCalendarService");
const webPush = require("./webPushService");
const { pool } = require("../config/postgres");
const logger = require("../utils/logger");

const NIFTY_KEY = "NSE_INDEX|Nifty 50";
const TIMEZONE = "Asia/Kolkata";
const MARKET_OPEN_PUSH_CRON = process.env.MARKET_OPEN_PUSH_CRON || "20-29 9 * * 1-5";
const MAX_TICK_AGE_SECONDS = 180;
const SEND_CONCURRENCY = 25;
const CLAIM_TTL_SECONDS = 2 * 24 * 60 * 60;

// ─────────────────────────────────────────────────────────────
// Formatting
// ─────────────────────────────────────────────────────────────

function formatPercent(pct) {
  const rounded = Math.round(pct * 10) / 10;
  if (rounded === 0) return "flat";
  return `${rounded > 0 ? "+" : "-"}${Math.abs(rounded).toFixed(1)}%`;
}

function formatRupees(amount) {
  const rounded = Math.round(amount);
  if (rounded === 0) return "flat";
  return `${rounded > 0 ? "+" : "-"}₹${Math.abs(rounded).toLocaleString("en-IN")}`;
}

function buildMessage({ niftyPct, portfolioChange, isoDate }) {
  const nifty = formatPercent(niftyPct);
  return {
    title: `Nifty opened ${nifty}`,
    body:
      portfolioChange == null
        ? "Tap to see how your stocks are doing."
        : `Your portfolio is ${formatRupees(portfolioChange)} today`,
    url: "/",
    tag: `market-open-${isoDate}`, // a re-send replaces, never stacks
  };
}

// ─────────────────────────────────────────────────────────────
// Data
// ─────────────────────────────────────────────────────────────

/**
 * Reads {ltp, cp} for each instrument, keeping only quotes that are
 * fresh and sane. Returns a Map(instrumentKey -> { ltp, cp }).
 */
async function getFreshQuotes(instrumentKeys, nowMs = Date.now()) {
  const quotes = new Map();
  if (!instrumentKeys.length) return quotes;

  const [rawQuotes, rawTimestamps] = await Promise.all([
    redisClient.mGet(instrumentKeys.map((k) => `stock:${k}`)),
    redisClient.mGet(instrumentKeys.map((k) => `stock_ts:${k}`)),
  ]);

  instrumentKeys.forEach((key, i) => {
    try {
      const tickMs = parseFloat(rawTimestamps[i]) * 1000;
      if (!Number.isFinite(tickMs) || nowMs - tickMs > MAX_TICK_AGE_SECONDS * 1000) return;

      const ltpc = JSON.parse(rawQuotes[i])?.ltpc;
      const ltp = parseFloat(ltpc?.ltp);
      const cp = parseFloat(ltpc?.cp);
      if (!(ltp > 0) || !(cp > 0)) return;

      quotes.set(key, { ltp, cp });
    } catch {
      /* malformed or missing -> treated as no quote */
    }
  });

  return quotes;
}

async function getSubscribedUserIds() {
  const { rows } = await pool.query(`SELECT DISTINCT user_id FROM push_subscriptions`);
  return rows.map((r) => r.user_id);
}

async function getOpenPositions(userIds) {
  if (!userIds.length) return [];
  const { rows } = await pool.query(
    `SELECT user_id, instrument_key, quantity
       FROM positions
      WHERE user_id = ANY($1::uuid[]) AND quantity != 0`,
    [userIds],
  );
  return rows;
}

/** Today's change per user (Map userId -> rupees). Users with no priced position are absent. */
function computePortfolioChanges(positions, quotes) {
  const changes = new Map();
  for (const p of positions) {
    const q = quotes.get(p.instrument_key);
    if (!q) continue;
    const delta = (q.ltp - q.cp) * parseFloat(p.quantity);
    changes.set(p.user_id, (changes.get(p.user_id) || 0) + delta);
  }
  return changes;
}

// ─────────────────────────────────────────────────────────────
// Job
// ─────────────────────────────────────────────────────────────

async function sendInBatches(userIds, messageFor) {
  let sent = 0;
  for (let i = 0; i < userIds.length; i += SEND_CONCURRENCY) {
    const batch = userIds.slice(i, i + SEND_CONCURRENCY);
    const results = await Promise.all(batch.map((id) => webPush.sendToUser(id, messageFor(id))));
    sent += results.reduce((n, r) => n + r.sent, 0);
  }
  return sent;
}

/**
 * @param {{ now?: Date, force?: boolean }} opts
 *   force: skip the trading-day and already-sent checks (manual testing only).
 *          Stale data is still refused.
 */
async function runMarketOpenNotification({ now = new Date(), force = false } = {}) {
  if (!webPush.isEnabled()) return { status: "push_disabled" };

  const { isoDate } = marketCalendar.getISTParts(now);
  if (!force && !marketCalendar.isTradingDay(isoDate)) return { status: "not_trading_day" };

  const claimKey = `market_open_push:${isoDate}`;
  if (!force && (await redisClient.get(claimKey))) return { status: "already_sent" };

  const niftyQuote = (await getFreshQuotes([NIFTY_KEY], now.getTime())).get(NIFTY_KEY);
  if (!niftyQuote) {
    logger.info("[MARKET-OPEN] Nifty has no fresh tick yet; will retry next minute");
    return { status: "no_fresh_data" };
  }
  const niftyPct = ((niftyQuote.ltp - niftyQuote.cp) / niftyQuote.cp) * 100;

  // Claim the day before sending so two instances can't both push.
  if (!force) {
    const claimed = await redisClient.set(claimKey, "1", { NX: true, EX: CLAIM_TTL_SECONDS });
    if (!claimed) return { status: "already_sent" };
  }

  const userIds = await getSubscribedUserIds();
  if (!userIds.length) return { status: "sent", users: 0, pushes: 0 };

  const positions = await getOpenPositions(userIds);
  const quotes = await getFreshQuotes([...new Set(positions.map((p) => p.instrument_key))], now.getTime());
  const changes = computePortfolioChanges(positions, quotes);

  const pushes = await sendInBatches(userIds, (id) =>
    buildMessage({ niftyPct, portfolioChange: changes.has(id) ? changes.get(id) : null, isoDate }),
  );

  logger.info(`[MARKET-OPEN] Nifty ${formatPercent(niftyPct)}; ${userIds.length} users, ${pushes} pushes`);
  return { status: "sent", users: userIds.length, pushes, niftyPct };
}

function scheduleMarketOpenNotifier() {
  cron.schedule(
    MARKET_OPEN_PUSH_CRON,
    () => {
      runMarketOpenNotification().catch((err) =>
        logger.error(`[MARKET-OPEN] Notifier crashed: ${err.message}`),
      );
    },
    { timezone: TIMEZONE },
  );
  logger.info(`[MARKET-OPEN] Market-open push scheduled (${MARKET_OPEN_PUSH_CRON}, ${TIMEZONE})`);
}

module.exports = {
  scheduleMarketOpenNotifier,
  runMarketOpenNotification,
  // exported for tests
  buildMessage,
  formatPercent,
  formatRupees,
  computePortfolioChanges,
  getFreshQuotes,
};
