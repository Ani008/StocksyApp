/**
 * services/dailySummaryService.js
 *
 * Everyday "reason to come back" push notifications:
 *
 *   9:20am  "Nifty opened +0.8%"  /  "Your portfolio is +₹2,300 today."
 *   3:35pm  "Nifty closed +0.4%"  /  "Your portfolio is +₹1,200 today."
 *
 * Sent only to users who have at least one push subscription (see
 * webPushService / migration 013). Users with no open positions still get the
 * Nifty line with a nudge to look at the market.
 *
 * How the numbers are computed
 *   - Nifty %        : (ltp - cp) / cp from Redis `stock:NSE_INDEX|Nifty 50`
 *                      (cp = previous close, written by backend_py).
 *   - Portfolio ₹    : sum over the user's open positions (all wallets) of
 *                      (ltp - cp) * quantity. Quantity is negative for shorts,
 *                      so a short correctly gains when the price falls.
 *     This is "today's change", not total unrealised P&L. At 9:20am nothing
 *     was bought today, so it is exact; later in the day a position opened
 *     today is measured against yesterday's close rather than its entry.
 *
 * Safety
 *   - Skips weekends and NSE holidays (marketCalendarService).
 *   - Skips the whole run if Nifty data is missing/stale-looking (no garbage
 *     notifications) — see getIndexMove().
 *   - Once per kind per IST day, enforced with a Redis SET NX, so a restart
 *     or a second server instance can't double-send.
 *   - A push failure never throws (webPushService contract).
 *
 * Config (all optional):
 *   DAILY_SUMMARY_ENABLED=false   kill switch
 *   DAILY_SUMMARY_OPEN_CRON       default "20 9 * * 1-5"
 *   DAILY_SUMMARY_CLOSE_CRON      default "35 15 * * 1-5"
 */

const cron = require("node-cron");
const { pool } = require("../config/postgres");
const redisClient = require("./redisService");
const marketCalendar = require("./marketCalendarService");
const webPush = require("./webPushService");
const logger = require("../utils/logger");

const TIMEZONE = "Asia/Kolkata";
const NIFTY_KEY = "NSE_INDEX|Nifty 50";
const OPEN_CRON = process.env.DAILY_SUMMARY_OPEN_CRON || "20 9 * * 1-5";
const CLOSE_CRON = process.env.DAILY_SUMMARY_CLOSE_CRON || "35 15 * * 1-5";
const SEND_BATCH_SIZE = 20; // users notified in parallel
const DEDUP_TTL_SECONDS = 2 * 24 * 60 * 60;

// ─────────────────────────────────────────────────────────────
// Pure helpers (unit-tested)
// ─────────────────────────────────────────────────────────────

function parseTick(raw) {
  if (!raw) return null;
  try {
    const data = JSON.parse(raw);
    const ltp = parseFloat(data?.ltpc?.ltp);
    const cp = parseFloat(data?.ltpc?.cp);
    if (!(ltp > 0) || !(cp > 0)) return null;
    return { ltp, cp };
  } catch {
    return null;
  }
}

/** Day change in ₹ across positions; positions without a usable tick are skipped. */
function computePortfolioDayChange(positions, ticksByInstrument) {
  let total = 0;
  let counted = 0;
  for (const pos of positions) {
    const tick = ticksByInstrument[pos.instrument_key];
    const qty = parseFloat(pos.quantity);
    if (!tick || !Number.isFinite(qty) || qty === 0) continue;
    total += (tick.ltp - tick.cp) * qty;
    counted += 1;
  }
  return counted > 0 ? { amount: total, counted } : null;
}

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

/**
 * @param {"open"|"close"} kind
 * @param {number} niftyPct
 * @param {{amount:number}|null} portfolio  null = user has nothing to measure
 */
function buildMessage(kind, niftyPct, portfolio) {
  const verb = kind === "open" ? "opened" : "closed";
  const pct = formatPercent(niftyPct);
  const title = pct === "flat" ? `Nifty ${verb} flat` : `Nifty ${verb} ${pct}`;

  let body;
  if (!portfolio) {
    body = "See what's moving on Stocksy.";
  } else {
    const amt = formatRupees(portfolio.amount);
    body = amt === "flat" ? "Your portfolio is flat today." : `Your portfolio is ${amt} today.`;
  }

  return { title, body, url: "/", tag: `daily-${kind}` };
}

// ─────────────────────────────────────────────────────────────
// Data access
// ─────────────────────────────────────────────────────────────

async function getIndexMove() {
  const tick = parseTick(await redisClient.get(`stock:${NIFTY_KEY}`));
  if (!tick) return null;
  return ((tick.ltp - tick.cp) / tick.cp) * 100;
}

/** One row per open position, only for users that can actually receive a push. */
async function getRecipientPositions() {
  const { rows: users } = await pool.query(
    `SELECT DISTINCT user_id FROM push_subscriptions`,
  );
  if (!users.length) return { userIds: [], positionsByUser: new Map() };

  const userIds = users.map((u) => u.user_id);
  const { rows: positions } = await pool.query(
    `SELECT user_id, instrument_key, quantity
     FROM positions
     WHERE user_id = ANY($1::uuid[]) AND quantity != 0`,
    [userIds],
  );

  const positionsByUser = new Map();
  for (const p of positions) {
    if (!positionsByUser.has(p.user_id)) positionsByUser.set(p.user_id, []);
    positionsByUser.get(p.user_id).push(p);
  }
  return { userIds, positionsByUser };
}

async function getTicks(instrumentKeys) {
  const ticks = {};
  if (!instrumentKeys.length) return ticks;
  const values = await redisClient.mGet(instrumentKeys.map((k) => `stock:${k}`));
  instrumentKeys.forEach((key, i) => {
    ticks[key] = parseTick(values[i]);
  });
  return ticks;
}

// ─────────────────────────────────────────────────────────────
// Runner
// ─────────────────────────────────────────────────────────────

/**
 * @param {"open"|"close"} kind
 * @returns {Promise<{skipped?: string, users?: number, sent?: number}>}
 */
async function runDailySummary(kind, now = new Date()) {
  if (String(process.env.DAILY_SUMMARY_ENABLED).toLowerCase() === "false") {
    return { skipped: "disabled" };
  }
  if (!webPush.isEnabled()) return { skipped: "push-disabled" };

  const closedReason = marketCalendar.getClosedReason(now);
  if (closedReason && (closedReason.type === "WEEKEND" || closedReason.type === "HOLIDAY")) {
    return { skipped: closedReason.type.toLowerCase() };
  }

  const niftyPct = await getIndexMove();
  if (niftyPct == null) {
    logger.warn(`[DAILY-SUMMARY] ${kind}: no Nifty data in Redis — skipping run`);
    return { skipped: "no-index-data" };
  }

  // Claim today's slot only after we know we can actually send, so a run that
  // skipped for missing data can be retried by hand.
  const { isoDate } = marketCalendar.getISTParts(now);
  const claimed = await redisClient.set(`daily-summary:${kind}:${isoDate}`, "1", {
    NX: true,
    EX: DEDUP_TTL_SECONDS,
  });
  if (!claimed) return { skipped: "already-sent" };

  const { userIds, positionsByUser } = await getRecipientPositions();
  if (!userIds.length) return { users: 0, sent: 0 };

  const allKeys = [...new Set([...positionsByUser.values()].flat().map((p) => p.instrument_key))];
  const ticks = await getTicks(allKeys);

  let sent = 0;
  for (let i = 0; i < userIds.length; i += SEND_BATCH_SIZE) {
    const batch = userIds.slice(i, i + SEND_BATCH_SIZE);
    const results = await Promise.all(
      batch.map(async (userId) => {
        try {
          const portfolio = computePortfolioDayChange(positionsByUser.get(userId) || [], ticks);
          const res = await webPush.sendToUser(userId, buildMessage(kind, niftyPct, portfolio));
          return res.sent > 0 ? 1 : 0;
        } catch (err) {
          logger.error(`[DAILY-SUMMARY] user ${userId} failed: ${err.message}`);
          return 0;
        }
      }),
    );
    sent += results.reduce((a, b) => a + b, 0);
  }

  logger.info(`[DAILY-SUMMARY] ${kind}: Nifty ${formatPercent(niftyPct)}, notified ${sent}/${userIds.length} user(s)`);
  return { users: userIds.length, sent };
}

function scheduleDailySummaries() {
  const run = (kind) => () =>
    runDailySummary(kind).catch((err) => logger.error(`[DAILY-SUMMARY] ${kind} crashed: ${err.message}`));

  cron.schedule(OPEN_CRON, run("open"), { timezone: TIMEZONE });
  cron.schedule(CLOSE_CRON, run("close"), { timezone: TIMEZONE });
  logger.info(`[DAILY-SUMMARY] scheduled open "${OPEN_CRON}", close "${CLOSE_CRON}" (${TIMEZONE})`);
}

module.exports = {
  scheduleDailySummaries,
  runDailySummary,
  // exported for tests
  parseTick,
  computePortfolioDayChange,
  formatPercent,
  formatRupees,
  buildMessage,
};
