/**
 * services/niftyPredictionService.js
 *
 * The daily Nifty call: read the live quote, take a user's call, describe the
 * card's state, and settle calls after the close.
 *
 * Rules live in niftyPredictionLogic.js (pure, unit-tested). This file is the
 * glue to Redis, Postgres, cron and push.
 */

const cron = require("node-cron");
const redisClient = require("./redisService");
const repo = require("../repositories/niftyPredictionRepository");
const logic = require("./niftyPredictionLogic");
const { notifyUser } = require("./webPushService");
const { ValidationError } = require("../utils/errors");
const logger = require("../utils/logger");

const NIFTY_KEY = "NSE_INDEX|Nifty 50";
const TIMEZONE = "Asia/Kolkata";
// Runs every minute from 15:31 to 15:59 IST on weekdays. Most days it settles
// on the first or second run and every later run finds nothing to do.
const SETTLE_CRON = process.env.NIFTY_SETTLE_CRON || "31-59 15 * * 1-5";
// A baseline taken from a feed that stopped this long ago is not trusted.
const MAX_QUOTE_AGE_MS = 10 * 60 * 1000;

class PredictionError extends Error {
  constructor(message, code, status = 409) {
    super(message);
    this.name = "PredictionError";
    this.code = code;
    this.status = status;
  }
}

// ── Live quote ───────────────────────────────────────────────────────────────

/**
 * Latest Nifty 50 reading from Redis (the Python feed writes it).
 * Returns { ltp, prevClose, tsMs } or null when there is no usable reading.
 * tsMs is when the feed last traded/updated, in epoch ms, or null if unknown.
 */
async function readNiftyQuote() {
  try {
    const raw = await redisClient.get(`stock:${NIFTY_KEY}`);
    if (!raw) return null;
    const ltpc = JSON.parse(raw)?.ltpc;
    const ltp = parseFloat(ltpc?.ltp);
    const prevClose = parseFloat(ltpc?.cp);
    if (!(ltp > 0)) return null;

    // Prefer the exchange's own last-trade time; fall back to when our feed
    // last wrote the key (stock_ts, in epoch seconds).
    let tsMs = Number(ltpc?.ltt);
    if (!Number.isFinite(tsMs) || tsMs <= 0) {
      const ts = parseFloat(await redisClient.get(`stock_ts:${NIFTY_KEY}`));
      tsMs = Number.isFinite(ts) && ts > 0 ? ts * 1000 : null;
    }
    return { ltp, prevClose: prevClose > 0 ? prevClose : null, tsMs };
  } catch (err) {
    logger.error(`[NIFTY-PREDICT] Could not read quote: ${err.message}`);
    return null;
  }
}

// ── Card state ───────────────────────────────────────────────────────────────

const serializePrediction = (p) =>
  p && {
    direction: p.direction,
    status: p.status,
    baselinePrice: Number(p.baseline_price),
    closePrice: p.close_price == null ? null : Number(p.close_price),
    madeAt: p.created_at,
    resolvedAt: p.resolved_at,
  };

/**
 * Everything the card needs in one call.
 */
async function getState(userId, now = new Date(), env = process.env) {
  const { isoDate } = logic.istNow(now);
  const [prediction, recent] = await Promise.all([
    repo.getPredictionForDay(userId, isoDate),
    repo.getRecentPredictions(userId),
  ]);

  const phase = logic.getPhase({ now, prediction, env });
  const lockHhmm = logic.getLockHhmm(env);

  return {
    date: isoDate,
    phase,
    // false in dev (window always open): the app must not apply its own
    // clock-based phase changes then.
    enforced: !logic.isAlwaysOpen(env),
    window: logic.getWindow({ now, env }),
    lockLabel: logic.formatHhmm(lockHhmm),
    closeLabel: logic.formatHhmm(logic.CLOSE_HHMM),
    prediction: serializePrediction(prediction),
    streak: logic.computeStreaks(recent),
    serverTime: now.toISOString(),
  };
}

// ── Making a call ────────────────────────────────────────────────────────────

/**
 * Lock in today's call. Throws PredictionError / ValidationError.
 * Idempotent: a repeat call (double tap, second device) returns the original
 * call with `alreadyMade: true` and never changes it.
 */
async function submit(userId, rawDirection, now = new Date(), env = process.env) {
  const direction = String(rawDirection ?? "").toUpperCase();
  if (direction !== "UP" && direction !== "DOWN") {
    throw new ValidationError("Direction must be UP or DOWN");
  }

  const { isoDate } = logic.istNow(now);

  // A call that is already in always wins over the window check below, so a
  // retry after the lock still gets a sensible answer instead of an error.
  const existing = await repo.getPredictionForDay(userId, isoDate);
  if (existing) {
    return { alreadyMade: true, state: await getState(userId, now, env) };
  }

  const phase = logic.getPhase({ now, prediction: null, env });
  if (phase !== logic.PHASE.OPEN) {
    const messages = {
      [logic.PHASE.CLOSED_DAY]: "The market is closed today. Come back on the next trading day.",
      [logic.PHASE.BEFORE_OPEN]: "Predictions open when the market opens at 9:15 AM.",
      [logic.PHASE.LOCKED]: `Today's calls locked at ${logic.formatHhmm(logic.getLockHhmm(env))}. See you tomorrow!`,
    };
    throw new PredictionError(messages[phase] || "Predictions are closed right now.", `PREDICTION_${phase}`);
  }

  const quote = await readNiftyQuote();
  if (!quote || !quote.prevClose) {
    throw new PredictionError(
      "Nifty's price isn't available right now. Please try again in a moment.",
      "PREDICTION_NO_PRICE",
      503,
    );
  }
  if (!logic.isAlwaysOpen(env) && (!quote.tsMs || now.getTime() - quote.tsMs > MAX_QUOTE_AGE_MS)) {
    throw new PredictionError(
      "Nifty's price looks out of date. Please try again in a moment.",
      "PREDICTION_STALE_PRICE",
      503,
    );
  }

  // The baseline is the previous close — the same number the app's Nifty tile
  // measures "up" and "down" against.
  const { created } = await repo.insertPrediction({
    userId,
    tradeDate: isoDate,
    direction,
    baselinePrice: logic.round2(quote.prevClose),
  });

  return { alreadyMade: !created, state: await getState(userId, now, env) };
}

// ── Settling ─────────────────────────────────────────────────────────────────

const WON_BODY = (r) => `Nifty closed ${Number(r.close_price).toLocaleString("en-IN")}. You called it ${r.direction === "UP" ? "up" : "down"}. Nice one!`;
const LOST_BODY = (r) => `Nifty closed ${Number(r.close_price).toLocaleString("en-IN")}. You called it ${r.direction === "UP" ? "up" : "down"}. Better luck tomorrow.`;

function notifyResults(settled) {
  for (const r of settled) {
    if (r.status !== "WON" && r.status !== "LOST") continue;
    // Fire and forget — notifyUser never throws, and a failed push must not
    // affect a result that is already saved.
    notifyUser(r.user_id, {
      title: r.status === "WON" ? "You called it! 🎯" : "Nifty result is in",
      body: r.status === "WON" ? WON_BODY(r) : LOST_BODY(r),
      url: "/",
      tag: "nifty-result",
    });
  }
}

/**
 * One settle pass. Safe to run any number of times, on any number of
 * instances: the close is stored once per day and each call is settled once.
 */
async function runSettle(now = new Date()) {
  const { isoDate } = logic.istNow(now);
  const days = await repo.getPendingDays(isoDate);
  const summary = [];

  for (const day of days) {
    // A day BEFORE today can no longer be read off the live feed: use the
    // close we stored for it, or void it if we never captured one.
    if (day < isoDate) {
      const stored = await repo.getDailyClose(day);
      if (stored) {
        const settled = await repo.settleDay(day, stored);
        notifyResults(settled);
        summary.push({ day, result: "settled-late", count: settled.length });
      } else {
        const voided = await repo.voidDay(day);
        logger.warn(`[NIFTY-PREDICT] No close captured for ${day}; voided ${voided.length} call(s)`);
        summary.push({ day, result: "voided", count: voided.length });
      }
      continue;
    }

    // Today.
    let close = await repo.getDailyClose(day);
    if (close == null) {
      const q = await readNiftyQuote();
      const verdict = logic.evaluateCloseReading({
        quote: q && { ltp: q.ltp, tsMs: q.tsMs },
        now,
      });
      if (verdict.status === "WAIT") {
        summary.push({ day, result: "waiting" });
        continue;
      }
      if (verdict.status === "GIVE_UP") {
        const voided = await repo.voidDay(day);
        logger.warn(`[NIFTY-PREDICT] No trustworthy close for ${day}; voided ${voided.length} call(s)`);
        summary.push({ day, result: "voided", count: voided.length });
        continue;
      }
      close = await repo.saveDailyClose(day, verdict.close);
      logger.info(`[NIFTY-PREDICT] Captured Nifty close for ${day}: ${close}`);
    }

    const settled = await repo.settleDay(day, close);
    notifyResults(settled);
    summary.push({ day, result: "settled", close, count: settled.length });
  }

  return summary;
}

function scheduleNiftySettler() {
  cron.schedule(
    SETTLE_CRON,
    async () => {
      try {
        const summary = await runSettle();
        const did = summary.filter((s) => s.result !== "waiting");
        if (did.length) logger.info(`[NIFTY-PREDICT] Settle: ${JSON.stringify(did)}`);
      } catch (err) {
        logger.error(`[NIFTY-PREDICT] Settle failed: ${err.message}`);
      }
    },
    { timezone: TIMEZONE },
  );
  logger.info(`[NIFTY-PREDICT] Settler scheduled (${SETTLE_CRON}, ${TIMEZONE})`);
}

module.exports = {
  PredictionError,
  readNiftyQuote,
  getState,
  submit,
  runSettle,
  scheduleNiftySettler,
};
