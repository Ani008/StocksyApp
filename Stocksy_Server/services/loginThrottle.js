// services/loginThrottle.js
//
// Per-ACCOUNT login lockout (security review item 12). The per-IP limiter in
// middleware/rateLimiter.js stops one machine; this stops an attacker who
// spreads guesses for ONE account across many IPs.
//
//   LOGIN_MAX_FAILURES   wrong passwords allowed in a row   default 5
//   LOGIN_LOCK_SECONDS   how long the account then locks    default 900 (15 min)
//
// Design choices:
//   * Keyed by a hash of the e-mail, and applied to emails that have NO account
//     exactly the same way, so "locked" never reveals that an account exists.
//   * State lives in Redis (shared by every server instance, expires by itself).
//     If Redis is unreachable it falls back to a per-process map: protection
//     gets weaker, it does not vanish and logins do not start failing.
//   * While locked, even the correct password is refused. A lock only affects
//     password login: Google sign-in and "Forgot password" still work, and a
//     successful password reset clears it.
//   * The lock does not extend while it is active, so an attacker cannot hold
//     someone out forever by hammering the account.

const crypto = require("crypto");
const logger = require("../utils/logger");

const intEnv = (name, fallback) => {
  const n = parseInt(process.env[name], 10);
  return Number.isInteger(n) && n > 0 ? n : fallback;
};
const maxFailures = () => intEnv("LOGIN_MAX_FAILURES", 5);
const lockSeconds = () => intEnv("LOGIN_LOCK_SECONDS", 15 * 60);
// Failures older than this stop counting towards a lock.
const windowSeconds = () => intEnv("LOGIN_FAILURE_WINDOW_SECONDS", 15 * 60);

const redis = () => require("../config/redis").client;

const digest = (email) => crypto.createHash("sha256").update(String(email)).digest("hex");
const failKey = (email) => `login:fail:${digest(email)}`;
const lockKey = (email) => `login:lock:${digest(email)}`;

// ── in-process fallback ──────────────────────────────────────────────────────
const memory = new Map(); // key -> { value, expiresAt }
const memGet = (key) => {
  const entry = memory.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    memory.delete(key);
    return null;
  }
  return entry;
};
const memSet = (key, value, seconds) => memory.set(key, { value, expiresAt: Date.now() + seconds * 1000 });

let warnedAt = 0;
const warnFallback = (err) => {
  if (Date.now() - warnedAt > 60 * 1000) {
    warnedAt = Date.now();
    logger.error(`[LOGIN THROTTLE] Redis unavailable, using in-memory counters: ${err.message}`);
  }
};

/** { locked: false } or { locked: true, retryAfterSeconds } */
async function check(email) {
  try {
    const ttl = await redis().ttl(lockKey(email));
    return ttl > 0 ? { locked: true, retryAfterSeconds: ttl } : { locked: false };
  } catch (err) {
    warnFallback(err);
    const entry = memGet(lockKey(email));
    return entry
      ? { locked: true, retryAfterSeconds: Math.max(1, Math.ceil((entry.expiresAt - Date.now()) / 1000)) }
      : { locked: false };
  }
}

/** Count one wrong password. Returns true when this failure locked the account. */
async function recordFailure(email) {
  try {
    const client = redis();
    const count = await client.incr(failKey(email));
    if (count === 1) await client.expire(failKey(email), windowSeconds());
    if (count >= maxFailures()) {
      await client.set(lockKey(email), "1", { EX: lockSeconds() });
      await client.del(failKey(email));
      return true;
    }
    return false;
  } catch (err) {
    warnFallback(err);
    const entry = memGet(failKey(email));
    const count = (entry ? entry.value : 0) + 1;
    memSet(failKey(email), count, windowSeconds());
    if (count >= maxFailures()) {
      memSet(lockKey(email), 1, lockSeconds());
      memory.delete(failKey(email));
      return true;
    }
    return false;
  }
}

/** A correct password (or a completed password reset): forget past failures and any lock. */
async function clear(email) {
  try {
    await redis().del([failKey(email), lockKey(email)]);
  } catch (err) {
    warnFallback(err);
  }
  memory.delete(failKey(email));
  memory.delete(lockKey(email));
}

module.exports = { check, recordFailure, clear, lockSeconds };
