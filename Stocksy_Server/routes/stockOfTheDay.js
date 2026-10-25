/**
 * routes/stockOfTheDay.js
 * Mounted in server.js: app.use('/api/stock-of-the-day', require('./routes/stockOfTheDay'));
 */

const express = require("express");
const router = express.Router();
const { protect } = require("../middleware/auth");
const { getTodayHandler, answerHandler } = require("../controllers/stockOfTheDayController");

// GET  /api/stock-of-the-day/today  — today's rounds, this user's answers so far,
//                                     and (only once all are answered) the result
// POST /api/stock-of-the-day/answer — lock in one answer ({ roundIndex, pickedKey })
router.get("/today", protect, getTodayHandler);
router.post("/answer", protect, answerHandler);

module.exports = router;
