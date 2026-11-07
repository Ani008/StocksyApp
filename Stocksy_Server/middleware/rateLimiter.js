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

const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
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

// ── OTP limiter (forgot-password + email-verification codes) ────────────────
// This is the per-IP layer. The real guards are per ACCOUNT and live in
// services/otpService.js: a code dies after 5 wrong guesses, and sending is
// capped (30 s apart, 5 per hour) no matter how many IPs the requests come
// from. 10 here leaves room for a real person's typos and a resend.
const otpLimiter = rateLimit({
  ...baseOptions,
  windowMs: 15 * 60 * 1000,
  max: 10,
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

// ── Social limiters (follow / unfollow, find people) ────────────────────────
// These routes sit behind `protect`, so the budget is counted PER LOGGED-IN
// USER, not per IP. Per-IP would be wrong here: a whole college campus (or a
// workshop full of students) shares one public IP, and they would all drain
// one shared budget. Falls back to the IP if no user is attached.
const perUserKey = (req) => (req.user?.id ? `u:${req.user.id}` : ipKeyGenerator(req.ip));

// Follow / unfollow. Blunts scripted follow-spam without bothering anyone
// tapping through a list.
const followLimiter = rateLimit({
  ...baseOptions,
  windowMs: 60 * 1000, // 1 min
  max: 40,
  keyGenerator: perUserKey,
  store: makeRedisStore('rl:follow:'),
});

// Find-people search. Higher, because the app searches as you type.
const userSearchLimiter = rateLimit({
  ...baseOptions,
  windowMs: 60 * 1000, // 1 min
  max: 120,
  keyGenerator: perUserKey,
  store: makeRedisStore('rl:usersearch:'),
});

// Edit profile (name / username / avatar). Per user, like the social limiters.
const profileLimiter = rateLimit({
  ...baseOptions,
  windowMs: 60 * 1000, // 1 min
  max: 20,
  keyGenerator: perUserKey,
  store: makeRedisStore('rl:profile:'),
});

// Leaderboard reads. Per user, like the social limiters. The table is worked out
// from several tables on every request, so this is lower than plain reads, but
// still leaves room for switching tabs and pulling to refresh.
const leaderboardLimiter = rateLimit({
  ...baseOptions,
  windowMs: 60 * 1000, // 1 min
  max: 30,
  keyGenerator: perUserKey,
  store: makeRedisStore('rl:leaderboard:'),
});

// "Is this username free?" — used on the signup screen, BEFORE login, so this
// one can only count per IP. Generous because the app checks as you type.
const usernameCheckLimiter = rateLimit({
  ...baseOptions,
  windowMs: 60 * 1000, // 1 min
  max: 60,
  store: makeRedisStore('rl:usernamecheck:'),
});

module.exports = {
  generalLimiter,
  authLimiter,
  otpLimiter,
  orderLimiter,
  followLimiter,
  userSearchLimiter,
  profileLimiter,
  leaderboardLimiter,
  usernameCheckLimiter,
};
