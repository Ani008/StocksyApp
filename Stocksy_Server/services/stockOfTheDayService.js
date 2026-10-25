/**
 * services/stockOfTheDayService.js
 *
 * Glue for the Stock of the Day game: find (or build and store) today's day,
 * take a user's answers, and describe what the app should show.
 *
 * The rules live in stockOfTheDayLogic.js (pure, unit-tested). This file only
 * talks to Redis (fundamentals) and Postgres.
 */

const redisClient = require("./redisService");
const repo = require("../repositories/stockOfTheDayRepository");
const logic = require("./stockOfTheDayLogic");
const INSTRUMENTS = require("../config/instruments");
const { getISTParts } = require("./marketCalendarService");
const { ValidationError } = require("../utils/errors");
const logger = require("../utils/logger");

class StockOfTheDayError extends Error {
  constructor(message, code, status = 503) {
    super(message);
    this.name = "StockOfTheDayError";
    this.code = code;
    this.status = status;
  }
}

/** The fundamentals snapshot the Python scheduler keeps in Redis, or null. */
async function readFundamentals() {
  try {
    const raw = await redisClient.get("fundamentals:ALL");
    return raw ? JSON.parse(raw) : null;
  } catch (err) {
    logger.error(`[STOCK OF THE DAY] Could not read fundamentals: ${err.message}`);
    return null;
  }
}

const todayKey = (now = new Date()) => getISTParts(now).isoDate;

/**
 * Today's stored day, building it on first use. Two requests racing to build it
 * is safe: only the first insert wins and both get that one.
 */
async function getOrCreateDay(dateKey) {
  const existing = await repo.getDay(dateKey);
  if (existing) return existing;

  const fundamentals = await readFundamentals();
  if (!fundamentals) {
    throw new StockOfTheDayError(
      "Today's game isn't ready yet. Please try again in a bit.",
      "STOCK_OF_THE_DAY_UNAVAILABLE",
    );
  }

  const built = logic.buildDay({ instruments: INSTRUMENTS, fundamentals, dateKey });
  if (!built) {
    throw new StockOfTheDayError(
      "Today's game isn't ready yet. Please try again in a bit.",
      "STOCK_OF_THE_DAY_UNAVAILABLE",
    );
  }

  return repo.insertDay(dateKey, built);
}

/** What the app shows right now for this user. */
async function getState(userId, now = new Date()) {
  const dateKey = todayKey(now);
  const day = await getOrCreateDay(dateKey);
  const answers = await repo.getAnswers(userId, dateKey);
  return logic.viewDay(day, answers);
}

/**
 * Lock in one answer.
 * Returns { alreadyAnswered, state }. A repeat of an answered round keeps the
 * original answer and says so, rather than failing.
 */
async function submitAnswer(userId, { roundIndex, pickedKey }, now = new Date()) {
  const dateKey = todayKey(now);
  const day = await getOrCreateDay(dateKey);

  const problem = logic.validatePick(day, roundIndex, pickedKey);
  if (problem === "BAD_ROUND") throw new ValidationError("That round doesn't exist.");
  if (problem === "BAD_PICK") throw new ValidationError("Pick one of the two companies shown.");

  const { created } = await repo.insertAnswer({ userId, playDate: dateKey, roundIndex, pickedKey });
  const answers = await repo.getAnswers(userId, dateKey);
  return { alreadyAnswered: !created, state: logic.viewDay(day, answers) };
}

module.exports = { StockOfTheDayError, getState, submitAnswer, getOrCreateDay, todayKey };
