const service = require("../services/competitionService");
const { sendError } = require("../utils/errors");
const logger = require("../utils/logger");

// ── GET /api/competition/me ──────────────────────────────────────────────────
// Status for the logged-in student: switches, countdown target, divisions to pick
// from and their own entry (null until they join).
async function getMyStatusHandler(req, res) {
  res.set("Cache-Control", "no-store");
  try {
    return res.json(await service.getStatus(req.user.id));
  } catch (err) {
    return sendError(res, err, logger);
  }
}

// ── POST /api/competition/join ───────────────────────────────────────────────
// Body: { division: "A" }. The student is always the logged-in user: their name,
// username and email come from the account, never from the request.
// Safe to repeat: the same division again returns the same entry (created: false).
async function joinHandler(req, res) {
  try {
    const { entry, created } = await service.join(req.user.id, req.body?.division);
    return res.status(created ? 201 : 200).json({ entry, created });
  } catch (err) {
    return sendError(res, err, logger);
  }
}

module.exports = { getMyStatusHandler, joinHandler };
