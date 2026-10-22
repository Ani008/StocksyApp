/**
 * routes/streak.js
 * Mounted in server.js: app.use('/api/streak', require('./routes/streak'));
 */

const express = require("express");
const router = express.Router();
const { protect } = require("../middleware/auth");
const { getStreakHandler, checkInHandler } = require("../controllers/streakController");

// GET  /api/streak          — the user's streak (current, longest, history). Records nothing.
// POST /api/streak/check-in — count today (the app opening); returns the streak.
router.get("/", protect, getStreakHandler);
router.post("/check-in", protect, checkInHandler);

module.exports = router;
