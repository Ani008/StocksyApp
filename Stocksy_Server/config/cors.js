// config/cors.js — CORS options for the browser web app (see config/origins.js).
//
// `credentials: true` lets the browser send/receive the HttpOnly session
// cookies, which is why the origin list must be explicit (never "*").
// Requests with no Origin header (native apps, curl, the Python workers) are
// not browsers and pass straight through.
// A disallowed origin simply gets no CORS headers, so the browser blocks the
// response; its preflight is refused too, which is what stops other sites
// from sending our custom X-Client-Type / X-CSRF-Token headers.

const { isAllowedOrigin } = require("./origins");

module.exports = {
  origin: (origin, cb) => cb(null, !origin || isAllowedOrigin(origin)),
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Client-Type", "X-CSRF-Token"],
  maxAge: 600,
};
