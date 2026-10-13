// utils/password.js
//
// Password hashing, the password policy, and the dummy hash that keeps login
// timing the same for unknown emails (security review item 12).
//
// Env (optional):
//   BCRYPT_COST   default 12. Hashes made with a lower cost are upgraded
//                 automatically the next time the person logs in.

const bcrypt = require("bcryptjs");

const MIN_LENGTH = 8;
// bcrypt only looks at the first 72 BYTES. Refuse longer passwords instead of
// silently ignoring the tail (which would make two different passwords equal).
const MAX_BYTES = 72;

const bcryptCost = () => {
  const n = parseInt(process.env.BCRYPT_COST, 10);
  return Number.isInteger(n) && n >= 4 && n <= 15 ? n : 12;
};

const BCRYPT_HASH_RE = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/;
const isBcryptHash = (value) => typeof value === "string" && BCRYPT_HASH_RE.test(value);

const hashPassword = (password) => bcrypt.hash(password, bcryptCost());

// A real hash of a throwaway string. Login compares against it when there is
// no usable stored hash (unknown email, Google-only account) so those requests
// spend the same time as a wrong password for a real account.
let dummyHashPromise = null;
const getDummyHash = () => {
  if (!dummyHashPromise) {
    dummyHashPromise = bcrypt.hash("stocksy-timing-equaliser", bcryptCost());
  }
  return dummyHashPromise;
};

/** True when the stored hash was made with a cheaper cost than we use now. */
const needsRehash = (hash) => {
  try {
    return isBcryptHash(hash) && bcrypt.getRounds(hash) < bcryptCost();
  } catch {
    return false;
  }
};

// The most-used passwords that are long enough to pass the length rule.
const COMMON_PASSWORDS = new Set([
  "password", "password1", "password12", "password123", "password1234", "passw0rd",
  "p@ssw0rd", "p@ssword", "12345678", "123456789", "1234567890", "12345678910",
  "11111111", "00000000", "88888888", "987654321", "123123123", "12341234",
  "qwertyui", "qwerty12", "qwerty123", "qwertyuiop", "qwerty1234", "1q2w3e4r",
  "1q2w3e4r5t", "1qaz2wsx", "zaq12wsx", "asdfghjk", "asdfghjkl", "zxcvbnm1",
  "abcd1234", "abc12345", "abcdefgh", "abcdefg1", "iloveyou", "iloveyou1",
  "letmein1", "welcome1", "welcome123", "admin123", "administrator", "changeme",
  "changeme1", "trustno1", "football", "baseball", "superman", "monkey123",
  "dragon123", "sunshine", "princess", "whatever", "starwars", "master123",
  "stocksy", "stocksy1", "stocksy123", "stocksy@123", "stockmarket", "trading123",
]);

/**
 * Server-side password rules (the app also checks them, but only this counts).
 *   - 8 to 72 bytes
 *   - not one of the most common passwords
 *   - not just the person's email / name
 *   - not one character repeated
 * Deliberately no "needs a symbol and a capital" rules: length and not being
 * guessable matter more.
 *
 * Returns { ok: true } or { ok: false, message }.
 */
function validatePassword(password, { email, fullName } = {}) {
  if (typeof password !== "string") return { ok: false, message: "Password is required." };
  if (password.length < MIN_LENGTH) {
    return { ok: false, message: `Password must be at least ${MIN_LENGTH} characters.` };
  }
  if (Buffer.byteLength(password, "utf8") > MAX_BYTES) {
    return { ok: false, message: "Password is too long (72 bytes at most)." };
  }

  const lower = password.toLowerCase();

  if (COMMON_PASSWORDS.has(lower) || /^(.)\1+$/.test(password)) {
    return { ok: false, message: "That password is too easy to guess. Please choose a different one." };
  }

  const personal = new Set();
  if (typeof email === "string" && email) {
    personal.add(email.toLowerCase());
    personal.add(email.toLowerCase().split("@")[0]);
  }
  if (typeof fullName === "string" && fullName.trim()) {
    const name = fullName.trim().toLowerCase();
    personal.add(name);
    personal.add(name.replace(/\s+/g, ""));
    personal.add(name.split(/\s+/)[0]);
  }
  if (personal.has(lower)) {
    return { ok: false, message: "Password must not be your name or email. Please choose a different one." };
  }

  return { ok: true };
}

module.exports = {
  MIN_LENGTH,
  hashPassword,
  getDummyHash,
  isBcryptHash,
  needsRehash,
  validatePassword,
};
