// middleware/rateLimiter.js
//
// Centralized rate limiting. Nothing in this app had any rate limiting
// before this — `express-rate-limit` was already in package.json but never
// wired into a single route, so every endpoint (including login, signup,
// OTP, and order placement) had unlimited request volume from any client.
//
// Store: Redis-backed, not the in-memory default.
// The app already runs Redis for other purposes, and using it here means
// limits are enforced correctly even if this server is ever run as more
// than one instance (PM2 cluster mode, multiple containers behind a load
// balancer) — with the in-memory default, each instance would track its
// own counters, so a limit of "5 requests" would actually become
// "5 requests x number of instances" per user. Falls back to in-memory
// automatically if Redis is briefly unavailable, so a Redis blip degrades
// gracefully instead of taking the API down.

const { rateLimit } = require('express-rate-limit');
const { RedisStore } = require('rate-limit-redis');
const { client: redisClient } = require('../config/redis');

// IMPORTANT: express-rate-limit requires a SEPARATE store instance per
// limiter (sharing one instance across limiters was a bug in an earlier
// version of this file — it throws ERR_ERL_STORE_REUSE). Each limiter below
// gets its own RedisStore, namespaced with a unique `prefix` so their
// counters can never collide with each other inside Redis, even though
// they all use the same Redis connection.
function makeRedisStore(prefix) {
  try {
    return new RedisStore({
      prefix,
      sendCommand: (...args) => redisClient.sendCommand(args),
    });
  } catch (err) {
    console.error(`[rateLimiter:${prefix}] Falling back to in-memory store:`, err.message);
    return undefined; // express-rate-limit uses its built-in MemoryStore
  }
}

// Shared response shape so the frontend never has to special-case a 429 —
// it matches the { message, code, severity } contract used everywhere else
// (see utils/errors.js).
function limitHandler(req, res /*, next, options */) {
  res.status(429).json({
    message: 'Too many requests. Please slow down and try again shortly.',
    code: 'RATE_LIMITED',
    severity: 'error',
  });
}

const baseOptions = {
  standardHeaders: true, // RateLimit-* headers so well-behaved clients can back off
  legacyHeaders: false,
  handler: limitHandler,
};

// ── General API limiter ─────────────────────────────────────────────────────
// A safety net applied to every request. Generous enough not to bother real
// users, tight enough to blunt scraping/DoS-style traffic and runaway
// client bugs (e.g. a retry loop with no backoff).
const generalLimiter = rateLimit({
  ...baseOptions,
  windowMs: 15 * 60 * 1000, // 15 min
  max: 300,                 // ~20 req/min average per IP
  store: makeRedisStore('rl:general:'),
});

// ── Auth limiter (login / signup / google login) ────────────────────────────
// Credential endpoints are the highest-value brute-force / credential-
// stuffing target in the app, so they get a much tighter budget than
// general traffic.
const authLimiter = rateLimit({
  ...baseOptions,
  windowMs: 15 * 60 * 1000,
  max: 10,
  skipSuccessfulRequests: true, // don't penalize a user for their one good login
  store: makeRedisStore('rl:auth:'),
});

// ── OTP limiter (forgot-password send/verify) ───────────────────────────────
// OTPs are short numeric codes — without a strict limit here they're
// brute-forceable in minutes, and "send OTP" can otherwise be used to spam
// a victim's email/SMS.
const otpLimiter = rateLimit({
  ...baseOptions,
  windowMs: 15 * 60 * 1000,
  max: 5,
  store: makeRedisStore('rl:otp:'),
});

// ── Order limiter (place / cancel orders) ───────────────────────────────────
// Generous enough for legitimate active trading, but stops a runaway
// client-side bug or scripted client from hammering the OMS/matching engine.
const orderLimiter = rateLimit({
  ...baseOptions,
  windowMs: 60 * 1000, // 1 min
  max: 60,
  store: makeRedisStore('rl:order:'),
});

// ── Session limiter (refresh / ws-ticket) ───────────────────────────────────
// Refresh happens roughly every 15 min per open tab and a ticket is fetched on
// every WebSocket (re)connect, so this is looser than authLimiter but still
// stops a script from hammering the token endpoints.
const sessionLimiter = rateLimit({
  ...baseOptions,
  windowMs: 5 * 60 * 1000,
  max: 120,
  store: makeRedisStore('rl:session:'),
});

module.exports = { generalLimiter, authLimiter, otpLimiter, orderLimiter, sessionLimiter };
