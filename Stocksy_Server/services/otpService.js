// services/otpService.js
//
// One-time codes for "forgot password" and "verify your email"
// (security review item 8).
//
//   * 6 digits from crypto.randomInt (a CSPRNG, not a predictable generator)
//   * stored as HMAC-SHA256(pepper, userId:purpose:code), never in plain text
//   * a code dies after MAX_ATTEMPTS wrong guesses, no matter how many IPs the
//     guesses come from (this is the per-ACCOUNT limit; the per-IP limiter in
//     middleware/rateLimiter.js sits on top)
//   * a code is single-use (consume() is atomic)
//   * issuing is rate-limited per account: a cooldown between sends and a
//     cap per hour, so nobody can mail-bomb an inbox or keep re-rolling codes
//     to get fresh guesses
//
// Table: auth_codes (migrations/015_account_security.sql)
//
// Env (optional):
//   OTP_PEPPER   secret mixed into the hash. Defaults to JWT_SECRET. With a
//                6-digit code, the pepper is what stops someone who steals a
//                database copy from brute-forcing the codes offline.

const crypto = require("crypto");
const { pool } = require("../config/postgres");

const PURPOSES = Object.freeze({
  PASSWORD_RESET: "password_reset",
  EMAIL_VERIFY: "email_verify",
});

const CODE_LENGTH = 6;
const CODE_TTL_MINUTES = 10;
const MAX_ATTEMPTS = 5;
const RESEND_COOLDOWN_SECONDS = 30;
const MAX_SENDS_PER_HOUR = 5;

const CODE_RE = new RegExp(`^\\d{${CODE_LENGTH}}$`);

const pepper = () => {
  const value = process.env.OTP_PEPPER || process.env.JWT_SECRET;
  if (!value) throw new Error("OTP_PEPPER (or JWT_SECRET) is not configured");
  return value;
};

const generateCode = () =>
  String(crypto.randomInt(0, 10 ** CODE_LENGTH)).padStart(CODE_LENGTH, "0");

const hashCode = (userId, purpose, code) =>
  crypto.createHmac("sha256", pepper()).update(`${userId}:${purpose}:${code}`).digest("hex");

const safeEqualHex = (a, b) => {
  const x = Buffer.from(String(a), "hex");
  const y = Buffer.from(String(b), "hex");
  return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y);
};

/**
 * Create a fresh code for (user, purpose), replacing any earlier one.
 * Returns the plain code to e-mail, or null when this account is being
 * throttled (cooldown / hourly cap) - callers then send nothing and answer
 * exactly as if they had.
 */
async function issueCode(userId, purpose) {
  const code = generateCode();
  const expiresAt = new Date(Date.now() + CODE_TTL_MINUTES * 60 * 1000);

  const result = await pool.query(
    `INSERT INTO auth_codes (user_id, purpose, code_hash, expires_at)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, purpose) DO UPDATE SET
       code_hash         = EXCLUDED.code_hash,
       expires_at        = EXCLUDED.expires_at,
       attempts          = 0,
       issued_at         = NOW(),
       window_started_at = CASE WHEN auth_codes.window_started_at < NOW() - INTERVAL '1 hour'
                                THEN NOW() ELSE auth_codes.window_started_at END,
       sends_in_window   = CASE WHEN auth_codes.window_started_at < NOW() - INTERVAL '1 hour'
                                THEN 1 ELSE auth_codes.sends_in_window + 1 END
     WHERE auth_codes.issued_at < NOW() - make_interval(secs => $5::int)
       AND (auth_codes.window_started_at < NOW() - INTERVAL '1 hour'
            OR auth_codes.sends_in_window < $6::int)
     RETURNING 1`,
    [userId, purpose, hashCode(userId, purpose, code), expiresAt, RESEND_COOLDOWN_SECONDS, MAX_SENDS_PER_HOUR],
  );

  return result.rowCount === 1 ? code : null;
}

/**
 * Is `code` the live code for (user, purpose)?
 *
 * Every call spends one of the code's MAX_ATTEMPTS first, so guesses cannot be
 * made for free by racing requests. A CORRECT answer gives the attempt back
 * (so a person who mistyped a few times can still finish the flow) and does
 * NOT use the code up: call consume() for that.
 */
async function checkCode(userId, purpose, code) {
  if (typeof code !== "string" || !CODE_RE.test(code)) return false;

  const reserved = await pool.query(
    `UPDATE auth_codes
        SET attempts = attempts + 1
      WHERE user_id = $1 AND purpose = $2
        AND code_hash IS NOT NULL
        AND expires_at > NOW()
        AND attempts < $3
  RETURNING code_hash`,
    [userId, purpose, MAX_ATTEMPTS],
  );

  const stored = reserved.rows[0]?.code_hash;
  if (!stored) return false; // none issued, used, expired, or out of attempts

  const expected = hashCode(userId, purpose, code);
  if (!safeEqualHex(stored, expected)) return false;

  await pool.query(
    `UPDATE auth_codes
        SET attempts = GREATEST(attempts - 1, 0)
      WHERE user_id = $1 AND purpose = $2 AND code_hash = $3`,
    [userId, purpose, expected],
  );
  return true;
}

/**
 * Use the code up. Atomic: of several simultaneous calls with the same valid
 * code exactly one returns true.
 */
async function consumeCode(userId, purpose, code) {
  if (typeof code !== "string" || !CODE_RE.test(code)) return false;

  const result = await pool.query(
    `UPDATE auth_codes
        SET code_hash = NULL
      WHERE user_id = $1 AND purpose = $2
        AND code_hash = $3
        AND expires_at > NOW()
  RETURNING 1`,
    [userId, purpose, hashCode(userId, purpose, code)],
  );
  return result.rowCount === 1;
}

/** checkCode + consumeCode in one step (for flows with nothing to validate in between). */
async function verifyAndConsume(userId, purpose, code) {
  return (await checkCode(userId, purpose, code)) && (await consumeCode(userId, purpose, code));
}

/** Forget any outstanding code (e.g. once the account is verified another way). */
async function clearCodes(userId, purpose) {
  await pool.query(
    purpose
      ? `UPDATE auth_codes SET code_hash = NULL WHERE user_id = $1 AND purpose = $2`
      : `UPDATE auth_codes SET code_hash = NULL WHERE user_id = $1`,
    purpose ? [userId, purpose] : [userId],
  );
}

module.exports = {
  PURPOSES,
  CODE_LENGTH,
  CODE_TTL_MINUTES,
  MAX_ATTEMPTS,
  RESEND_COOLDOWN_SECONDS,
  MAX_SENDS_PER_HOUR,
  issueCode,
  checkCode,
  consumeCode,
  verifyAndConsume,
  clearCodes,
};
