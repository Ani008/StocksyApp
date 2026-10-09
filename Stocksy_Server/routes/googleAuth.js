const express = require("express");
const router = express.Router();

const {
  googleLogin,
  googleWebLogin,
} = require("../controllers/googleAuth");

const { authLimiter } = require("../middleware/rateLimiter");

// Android / iOS
router.post("/", authLimiter, googleLogin);

// Web OAuth + PKCE
router.post("/web", authLimiter, googleWebLogin);

module.exports = router;