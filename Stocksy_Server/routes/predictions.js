/**
 * routes/predictions.js
 * Mounted in server.js: app.use('/api/predictions', require('./routes/predictions'));
 */

const express = require("express");
const router = express.Router();
const { protect } = require("../middleware/auth");
const {
  getTodayHandler,
  createPredictionHandler,
} = require("../controllers/niftyPredictionController");

// GET  /api/predictions/nifty/today — the card's whole state: phase, countdown
//                                     times, today's call (if any), streak
// POST /api/predictions/nifty       — lock in today's call ({ direction })
router.get("/nifty/today", protect, getTodayHandler);
router.post("/nifty", protect, createPredictionHandler);

module.exports = router;
