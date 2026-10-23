/**
 * routes/streak.js
 * Mounted in server.js: app.use('/api/streak', require('./routes/streak'));
 *
 * There is deliberately no endpoint that records a day. A day is recorded by
 * the server itself when the user places an order (controllers/orderController)
 * or makes their Nifty call (controllers/niftyPredictionController).
 */

const express = require("express");
const router = express.Router();
const { protect } = require("../middleware/auth");
const { getStreakHandler, importHandler } = require("../controllers/streakController");

// GET  /api/streak          — the user's streak (current, longest, history). Records nothing.
// POST /api/streak/import   — one-time upload of the streak the device already had.
// POST /api/streak/check-in — OLD app builds' "I opened the app" call. Records
//                             nothing now; kept so they don't error. See the controller.
router.get("/", protect, getStreakHandler);
router.post("/import", protect, importHandler);
router.post("/check-in", protect, importHandler);

module.exports = router;
