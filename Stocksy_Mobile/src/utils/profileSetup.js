// src/utils/profileSetup.js
//
// The rules behind the "choose a username / avatar" box, with no React and no
// network in them so tests/profileSetup.test.mjs can check them directly.
//
// Username RULES (length, characters, reserved words) live on the server, which
// answers GET /auth/username-available with a reason and a message to show.
// The app deliberately does not copy those rules: two copies drift apart.

// Under this many characters a username can never be valid, so there is no
// point asking the server while the person is still typing it.
export const USERNAME_MIN_CHECK_LENGTH = 3;

// Usernames are case-insensitive and saved in lowercase.
export const normalizeUsername = (raw) =>
  typeof raw === "string" ? raw.trim().toLowerCase() : "";

export const isCheckable = (raw) =>
  normalizeUsername(raw).length >= USERNAME_MIN_CHECK_LENGTH;

/**
 * What is still missing from a profile. `profile` is { username, avatarId }
 * as returned by GET /users/me: `username` is null until the person has CHOSEN
 * one (the old first-name placeholder is never sent), `avatarId` is null until
 * they have picked an avatar.
 *
 * A profile that has not loaded (null / undefined) needs nothing: a failed
 * request must never pop the box up.
 *
 * firstTab is the tab the box should open on: username if that is missing,
 * otherwise avatar.
 */
export const getSetupNeeds = (profile) => {
  if (!profile) {
    return { needsUsername: false, needsAvatar: false, needsAny: false, firstTab: "username" };
  }
  const needsUsername = !profile.username;
  const needsAvatar = !profile.avatarId;
  return {
    needsUsername,
    needsAvatar,
    needsAny: needsUsername || needsAvatar,
    firstTab: needsUsername ? "username" : "avatar",
  };
};

// ── Placeholder avatars ─────────────────────────────────────────────────────
//
// Until real avatar art exists, an avatar is a coloured circle with a letter.
// The server decides WHICH avatars exist (config/avatars.js: ids like
// "female_3"); this only decides how an id LOOKS. When real images arrive,
// change AvatarBadge.js to draw them — nothing else needs to change.

export const AVATAR_GENDERS = ["male", "female"];

const PLACEHOLDERS = {
  male_1: { letter: "K", color: "#3B82F6" },
  male_2: { letter: "R", color: "#10B981" },
  male_3: { letter: "V", color: "#F59E0B" },
  male_4: { letter: "J", color: "#8B5CF6" },
  male_5: { letter: "T", color: "#EF4444" },
  male_6: { letter: "D", color: "#0EA5E9" },
  female_1: { letter: "A", color: "#EC4899" },
  female_2: { letter: "M", color: "#14B8A6" },
  female_3: { letter: "S", color: "#F97316" },
  female_4: { letter: "N", color: "#6366F1" },
  female_5: { letter: "P", color: "#84CC16" },
  female_6: { letter: "L", color: "#D946EF" },
};

const FALLBACK_COLOR = "#94A3B8";

// An id the app has no look for (the server added more avatars than this build
// knows about) still renders: a grey circle with the id's first letter.
export const avatarPlaceholder = (avatarId) => {
  const known = PLACEHOLDERS[avatarId];
  if (known) return known;
  const first = typeof avatarId === "string" && avatarId ? avatarId[0].toUpperCase() : "?";
  return { letter: first, color: FALLBACK_COLOR };
};

// [{ id, gender }] from GET /avatars → { male: [ids], female: [ids] }, keeping
// the server's order. Anything with an unknown gender is ignored.
export const groupAvatarsByGender = (avatars) => {
  const groups = Object.fromEntries(AVATAR_GENDERS.map((g) => [g, []]));
  if (!Array.isArray(avatars)) return groups;
  for (const a of avatars) {
    if (a && typeof a.id === "string" && groups[a.gender]) groups[a.gender].push(a.id);
  }
  return groups;
};

// "female_3" → "female"; the gender tab to open when an avatar is already picked.
export const genderOfAvatar = (avatarId) => {
  const gender = typeof avatarId === "string" ? avatarId.split("_")[0] : "";
  return AVATAR_GENDERS.includes(gender) ? gender : null;
};

// ── API errors ──────────────────────────────────────────────────────────────

export const apiErrorCode = (err) => err?.response?.data?.code || null;

// Something safe to show a person after a failed request.
export const apiErrorMessage = (err, fallback = "Something went wrong. Please try again.") => {
  const message = err?.response?.data?.message;
  if (typeof message === "string" && message) return message;
  if (err?.request && !err?.response) return "No connection to the server. Check your network.";
  return fallback;
};
