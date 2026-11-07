/**
 * routes/competition.js
 * Mounted in server.js: app.use('/api/competition', require('./routes/competition'));
 */
const express = require("express");
const router = express.Router();
const { protect } = require("../middleware/auth");
const { competitionLimiter } = require("../middleware/rateLimiter");
const { getMyStatusHandler, joinHandler } = require("../controllers/competitionController");

// GET  /api/competition/me   — my status: switches, countdown target, divisions, my entry.
// POST /api/competition/join — save my division. Body { division: "A" }.
router.get("/me", protect, competitionLimiter, getMyStatusHandler);
router.post("/join", protect, competitionLimiter, joinHandler);

module.exports = router;
