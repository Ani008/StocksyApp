// middleware/internalAuth.js
//
// Protects endpoints that are only meant to be called by Stocksy's own
// background services (for example the Python fundamentals scheduler that
// POSTs a snapshot to /api/fundamentals) — NOT by app users and NOT by
// browsers.
//
// Those callers don't have a user login, so they authenticate with a shared
// secret sent in the `X-Internal-Key` header. Set the same value as
// INTERNAL_API_KEY in both Stocksy_Server/.env and backend_py/.env.
//
// Fails CLOSED: if INTERNAL_API_KEY is missing or too short, every request is
// rejected (503) instead of silently leaving the endpoint open.

const crypto = require("crypto");
const logger = require("../utils/logger");

const MIN_KEY_LENGTH = 24;

// Hash both sides first so timingSafeEqual always compares equal-length
// buffers, and the comparison time doesn't reveal the length of the real key.
function safeEqual(a, b) {
  const ha = crypto.createHash("sha256").update(String(a)).digest();
  const hb = crypto.createHash("sha256").update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function requireInternalKey(req, res, next) {
  const expected = process.env.INTERNAL_API_KEY;

  if (!expected || expected.length < MIN_KEY_LENGTH) {
    logger.error(
      `[INTERNAL AUTH] INTERNAL_API_KEY is not set (or shorter than ${MIN_KEY_LENGTH} chars) — rejecting ${req.method} ${req.path}`,
    );
    return res.status(503).json({
      message: "This endpoint is not available right now.",
      code: "SERVICE_UNAVAILABLE",
      severity: "error",
    });
  }

  const provided = req.get("x-internal-key");

  if (!provided || !safeEqual(provided, expected)) {
    // console.warn (not logger.warn): logger.warn goes through console.log,
    // which devLogger silences in production — and a rejected attempt on an
    // internal endpoint is exactly what should stay visible in `pm2 logs`.
    console.warn(`[INTERNAL AUTH] Rejected ${req.method} ${req.path} from ${req.ip}`);
    return res.status(401).json({
      message: "Unauthorized.",
      code: "UNAUTHORIZED",
      severity: "error",
    });
  }

  return next();
}

module.exports = { requireInternalKey, MIN_KEY_LENGTH };
