const service = require("../services/streakService");
const { sendError } = require("../utils/errors");
const logger = require("../utils/logger");

// A year of check-ins is ~365 keys; this is only a ceiling so a huge body can't
// make the server do pointless work.
const MAX_IMPORT_DAYS = 1000;

// ── GET /api/streak ──────────────────────────────────────────────────────────
// The streak as it stands. Records nothing.
async function getStreakHandler(req, res) {
  try {
    return res.json(await service.getState(req.user.id));
  } catch (err) {
    return sendError(res, err, logger);
  }
}

// ── POST /api/streak/check-in ────────────────────────────────────────────────
// Count today (the app opening) and return the streak.
// Body (optional): { importDays: ["YYYY-MM-DD", ...] } — the streak the app had
// saved on the device, offered once so existing streaks aren't lost.
async function checkInHandler(req, res) {
  try {
    const raw = req.body?.importDays;
    const importDays = Array.isArray(raw) ? raw.slice(0, MAX_IMPORT_DAYS) : [];
    return res.json(await service.checkIn(req.user.id, { importDays }));
  } catch (err) {
    return sendError(res, err, logger);
  }
}

module.exports = { getStreakHandler, checkInHandler };
