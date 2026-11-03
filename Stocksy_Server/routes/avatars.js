/**
 * routes/avatars.js
 * Mounted in server.js: app.use('/api/avatars', require('./routes/avatars'));
 *
 * GET /api/avatars — the avatars a user can pick from. Public: it is the same
 * fixed list for everyone (see config/avatars.js).
 */

const express = require("express");
const router = express.Router();
const { listAvatarsHandler } = require("../controllers/profileController");

router.get("/", listAvatarsHandler);

module.exports = router;
