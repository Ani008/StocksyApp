/**
 * routes/config.js
 * Mounted in server.js: app.use('/api/config', require('./routes/config'));
 */
const express = require("express");
const router = express.Router();
const { getFeaturesHandler } = require("../controllers/configController");

// GET /api/config/features — which features the app should show. Public.
router.get("/features", getFeaturesHandler);

module.exports = router;
