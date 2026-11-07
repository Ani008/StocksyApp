const repo = require("../repositories/leaderboardRepository");
const L = require("../services/leaderboardLogic");
const { ValidationError, sendError } = require("../utils/errors");
const logger = require("../utils/logger");

// ── GET /api/leaderboard?scope=friends|global&limit= ──────────────────────────
// The ranked table.
//   scope=friends  you + everyone you follow, ranked against each other
//   scope=global   every user on the app
// Responds { scope, total, entries: [...], me } — `entries` are the top rows in
// rank order, `me` is the viewer's own row (with their real rank, even when it
// is below the top `limit`), `total` is how many people are ranked.
async function getLeaderboardHandler(req, res) {
  try {
    const viewerId = req.user.id;

    const scope = L.parseScope(req.query.scope);
    if (!scope) throw new ValidationError("scope must be 'friends' or 'global'");

    const limit = L.clampLimit(req.query.limit);

    const rows = await repo.getLeaderboard({ viewerId, scope, limit });

    return res.json(L.buildResponse(scope, rows, limit, viewerId));
  } catch (err) {
    return sendError(res, err, logger);
  }
}

module.exports = { getLeaderboardHandler };
