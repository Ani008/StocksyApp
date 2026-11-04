// services/profileLogic.js
//
// Rules for usernames, display names and profile edits, plus the shape of a
// user's OWN account in API responses. No database, no Express — kept apart so
// tests/profile.test.js can check them directly.

const { ValidationError } = require("../utils/errors");
const { isAvatarId } = require("../config/avatars");

const USERNAME_MIN = 3;
const USERNAME_MAX = 20; // users.signup_username is VARCHAR(20)
const MAX_FULL_NAME_LENGTH = 150; // users.full_name is VARCHAR(150), same cap as signup

// Words nobody may take: they would read as official accounts or collide with
// app/URL words. (Only exact matches are blocked.)
const RESERVED_USERNAMES = new Set([
  "me", "admin", "administrator", "root", "support", "help", "official", "staff",
  "team", "mod", "moderator", "system", "security", "billing", "info", "contact",
  "stocksy", "stocksyapp", "stocksy_app", "nse", "bse", "nifty", "sensex",
  "api", "www", "mail", "null", "undefined", "anonymous",
  "login", "logout", "signup", "register", "settings", "profile", "search",
  "explore", "home", "leaderboard", "follow", "followers", "following",
  "about", "privacy", "terms", "legal", "press",
]);

// ── Username ────────────────────────────────────────────────────────────────

// Usernames are not case-sensitive and are stored in lowercase.
const normalizeUsername = (raw) => (typeof raw === "string" ? raw.trim().toLowerCase() : "");

/**
 * Checks a typed username.
 *   { ok: true,  username }            — normalized, ready to use
 *   { ok: false, reason, message }     — message is safe to show the person
 * reason: REQUIRED | TOO_SHORT | TOO_LONG | INVALID_CHARACTERS | INVALID_FORMAT | RESERVED
 *
 * Says nothing about whether it is TAKEN — that needs the database.
 */
const checkUsername = (raw) => {
  const username = normalizeUsername(raw);

  const fail = (reason, message) => ({ ok: false, reason, message });

  if (!username) return fail("REQUIRED", "Choose a username.");
  if (username.length < USERNAME_MIN) {
    return fail("TOO_SHORT", `Username must be at least ${USERNAME_MIN} characters.`);
  }
  if (username.length > USERNAME_MAX) {
    return fail("TOO_LONG", `Username can be at most ${USERNAME_MAX} characters.`);
  }
  if (!/^[a-z0-9._]+$/.test(username)) {
    return fail("INVALID_CHARACTERS", "Use only letters, numbers, dots and underscores.");
  }
  if (username.startsWith(".") || username.endsWith(".") || username.includes("..")) {
    return fail("INVALID_FORMAT", "A username can't start or end with a dot, or have two dots in a row.");
  }
  if (RESERVED_USERNAMES.has(username)) {
    return fail("RESERVED", "That username isn't available.");
  }

  return { ok: true, username };
};

// ── Display name ────────────────────────────────────────────────────────────

// Control characters and the invisible "reverse the text direction" marks are
// refused (they can make one name look like another). Other invisible joiners
// are allowed on purpose: Devanagari and emoji names need them.
const FORBIDDEN_NAME_CHARS = /[\p{Cc}‪-‮⁦-⁩]/u;

const cleanFullName = (raw) => {
  if (typeof raw !== "string") throw new ValidationError("Enter your name.");

  const name = raw.replace(/\s+/g, " ").trim();
  if (!name) throw new ValidationError("Name can't be empty.");
  if (name.length > MAX_FULL_NAME_LENGTH) throw new ValidationError("That name is too long.");
  if (FORBIDDEN_NAME_CHARS.test(name)) {
    throw new ValidationError("That name contains characters that aren't allowed.");
  }
  return name;
};

// ── Edit-profile request body ───────────────────────────────────────────────

/**
 * PATCH /api/users/me body → only the fields being changed, validated and
 * cleaned: { fullName?, username?, avatarId? }.
 *
 * Only these three can ever change here. The email cannot, and anything else in
 * the body (balance, provider, ...) is simply never read.
 */
const parseProfileUpdate = (body) => {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new ValidationError("Nothing to update.");
  }
  if (Object.prototype.hasOwnProperty.call(body, "email")) {
    throw new ValidationError("Your email can't be changed.");
  }

  const changes = {};

  if (body.fullName !== undefined) changes.fullName = cleanFullName(body.fullName);

  if (body.username !== undefined) {
    const result = checkUsername(body.username);
    if (!result.ok) throw new ValidationError(result.message);
    changes.username = result.username;
  }

  if (body.avatarId !== undefined) {
    if (!isAvatarId(body.avatarId)) throw new ValidationError("Pick one of the available avatars.");
    changes.avatarId = body.avatarId;
  }

  if (Object.keys(changes).length === 0) throw new ValidationError("Nothing to update.");
  return changes;
};

// ── A user's own account, as sent to that user ──────────────────────────────
//
// Used by login / signup-confirmation / token refresh / profile edit so they
// can never drift apart. This is the person's OWN data (it includes their
// email and balance) — never send it to anyone else; other users get the
// smaller shapes in services/followLogic.js.
//
//   username     exactly as stored. Until the person chooses one this is still
//                the old first-name value, which the app keeps using for
//                "Hi, <name>" — so existing app versions keep working.
//   usernameSet  true once they have actually chosen a username. The app shows
//                the "choose a username" box while this is false.
//   avatarId     the avatar they picked, or null. The app shows the avatar
//                picker while this is null.
//   avatar       the Google profile photo URL, if any (unrelated to avatarId).
const serializeAccount = (row) => ({
  id: row.id,
  username: row.username,
  usernameSet: Boolean(row.username_set),
  fullName: row.full_name,
  email: row.email,
  avatar: row.avatar,
  avatarId: row.avatar_id ?? null,
  demoBalance: row.demo_balance,
});

module.exports = {
  USERNAME_MIN,
  USERNAME_MAX,
  MAX_FULL_NAME_LENGTH,
  normalizeUsername,
  checkUsername,
  cleanFullName,
  parseProfileUpdate,
  serializeAccount,
};
