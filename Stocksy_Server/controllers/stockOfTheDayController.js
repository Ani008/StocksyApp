const service = require("../services/stockOfTheDayService");
const { sendError } = require("../utils/errors");
const logger = require("../utils/logger");

// Expected "can't do that right now" outcomes (game not ready) use the same
// { message, code, severity } contract as every other endpoint.
function sendGameError(res, err) {
  if (err instanceof service.StockOfTheDayError) {
    return res.status(err.status).json({
      message: err.message,
      code: err.code,
      severity: "warning",
    });
  }
  return sendError(res, err, logger);
}

// ── GET /api/stock-of-the-day/today ──────────────────────────────────────────
async function getTodayHandler(req, res) {
  try {
    return res.json(await service.getState(req.user.id));
  } catch (err) {
    return sendGameError(res, err);
  }
}

// ── POST /api/stock-of-the-day/answer ────────────────────────────────────────
// Body: { roundIndex: number, pickedKey: string }
async function answerHandler(req, res) {
  try {
    const { roundIndex, pickedKey } = req.body || {};
    const { alreadyAnswered, state } = await service.submitAnswer(req.user.id, {
      roundIndex,
      pickedKey,
    });
    return res.status(alreadyAnswered ? 200 : 201).json({ alreadyAnswered, ...state });
  } catch (err) {
    return sendGameError(res, err);
  }
}

module.exports = { getTodayHandler, answerHandler };
