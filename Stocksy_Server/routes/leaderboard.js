/**
 * routes/leaderboard.js
 * Mount in server.js: app.use('/api/leaderboard', require('./routes/leaderboard'));
 *
 * The ranked table behind the Leaderboard screen. Needs a login.
 *
 * GET /api/leaderboard?scope=friends|global&limit=
 *   scope  friends (default) — you plus the people you follow
 *          global            — everyone on the app
 *   limit  how many ranked rows to return (default 50, max 100). Your own row
 *          comes back separately as `me`, so it is there even when you rank lower.
 *
 * Responds { scope, total, entries: [{ rank, id, fullName, username, avatar,
 * avatarId, points, isSelf }], me }.
 */

const express = require("express");
const router = express.Router();
const { protect } = require("../middleware/auth");
const { leaderboardLimiter } = require("../middleware/rateLimiter");
const { getLeaderboardHandler } = require("../controllers/leaderboardController");

router.get("/", protect, leaderboardLimiter, getLeaderboardHandler);

module.exports = router;
