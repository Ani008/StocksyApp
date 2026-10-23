const service = require("../services/streakService");
const { sendError } = require("../utils/errors");
const logger = require("../utils/logger");

// A year of days is ~365 keys; this is only a ceiling so a huge body can't make
// the server do pointless work.
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

// ── POST /api/streak/import ──────────────────────────────────────────────────
// Body (optional): { importDays: ["YYYY-MM-DD", ...] } — the streak the app had
// saved on the device before the server kept it, offered once so existing
// streaks aren't lost. Records NOTHING for today and returns the streak.
//
// Also mounted at POST /api/streak/check-in: app builds from before streaks
// needed real activity call that path every time the app opens. They must no
// longer earn a day for just opening, so that path now does exactly this.
async function importHandler(req, res) {
  try {
    const raw = req.body?.importDays;
    const importDays = Array.isArray(raw) ? raw.slice(0, MAX_IMPORT_DAYS) : [];
    return res.json(await service.importLegacy(req.user.id, importDays));
  } catch (err) {
    return sendError(res, err, logger);
  }
}

module.exports = { getStreakHandler, importHandler };
