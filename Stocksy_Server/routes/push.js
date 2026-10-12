/**
 * routes/push.js
 * Mounted in server.js: app.use('/api/push', require('./routes/push'));
 */
const express = require("express");
const router = express.Router();
const { protect } = require("../middleware/auth");
const { publicKeyHandler, subscribeHandler, unsubscribeHandler } = require("../controllers/pushController");

// GET  /api/push/public-key — VAPID public key (public by design)
// POST /api/push/subscribe   — register this browser for the logged-in user
// POST /api/push/unsubscribe — remove this browser
router.get("/public-key", publicKeyHandler);
router.post("/subscribe", protect, subscribeHandler);
router.post("/unsubscribe", protect, unsubscribeHandler);

module.exports = router;
