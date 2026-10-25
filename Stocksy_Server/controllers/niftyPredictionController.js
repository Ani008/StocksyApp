const service = require("../services/niftyPredictionService");
const { recordActivitySafe } = require("../services/streakService");
const { sendError } = require("../utils/errors");
const logger = require("../utils/logger");

// Expected "can't do that right now" outcomes (window locked, no price yet) use
// the same { message, code, severity } contract as every other endpoint.
function sendPredictionError(res, err) {
  if (err instanceof service.PredictionError) {
    return res.status(err.status).json({
      message: err.message,
      code: err.code,
      severity: "warning",
    });
  }
  return sendError(res, err, logger);
}

// ── GET /api/predictions/nifty/today ─────────────────────────────────────────
async function getTodayHandler(req, res) {
  try {
    return res.json(await service.getState(req.user.id));
  } catch (err) {
    return sendPredictionError(res, err);
  }
}

// ── POST /api/predictions/nifty ──────────────────────────────────────────────
// Body: { direction: "UP" | "DOWN" }
async function createPredictionHandler(req, res) {
  try {
    const { alreadyMade, state } = await service.submit(req.user.id, req.body?.direction);
    // Making today's call is what earns the day's streak. Counted even when the
    // call already existed (a retry, or a call made before streaks needed
    // activity): recording a day twice is a no-op. Never fails the request.
    await recordActivitySafe(req.user.id, "nifty");
    return res.status(alreadyMade ? 200 : 201).json({ alreadyMade, ...state });
  } catch (err) {
    return sendPredictionError(res, err);
  }
}

module.exports = { getTodayHandler, createPredictionHandler };
