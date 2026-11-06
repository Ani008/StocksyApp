// src/utils/editProfile.js
//
// Rules for showing a person's name and for the Edit Profile page. No React, no
// network — kept apart so tests/editProfile.test.mjs can check them.
//
// The server (Stocksy_Server/services/profileLogic.js) is the authority on what
// a valid name is; the checks here only give quick feedback before sending.

// Same cap as the server (users.full_name is VARCHAR(150)).
export const MAX_FULL_NAME_LENGTH = 150;

// "  Aniket   Chakke " → "Aniket Chakke" (what the server will save).
export const cleanFullName = (raw) =>
  typeof raw === "string" ? raw.replace(/\s+/g, " ").trim() : "";

// The first word of the full name, for greetings: "aniket chakke" → "Aniket".
// Returns "" when there is no name, so the caller picks its own fallback.
export const firstNameOf = (fullName) => {
  const first = cleanFullName(fullName).split(" ")[0] || "";
  if (!first) return "";
  const [head, ...rest] = Array.from(first); // by code point, safe for emoji / Devanagari
  return head.toUpperCase() + rest.join("");
};

// A message to show under the name field, or "" when the name is fine.
export const fullNameError = (raw) => {
  const name = cleanFullName(raw);
  if (!name) return "Name can't be empty.";
  if (name.length > MAX_FULL_NAME_LENGTH) return "That name is too long.";
  return "";
};

/**
 * What to send to PATCH /users/me. Only the fields that really changed — and
 * only fullName and avatarId: the username and email are locked on this page.
 *   original: { fullName, avatarId }   what the account has now
 *   draft:    { fullName, avatarId }   what the form shows
 * Returns {} when nothing changed (the Save button stays off).
 */
export const profileChanges = (original, draft) => {
  const changes = {};
  const name = cleanFullName(draft?.fullName);
  if (name && name !== cleanFullName(original?.fullName)) changes.fullName = name;
  if (draft?.avatarId && draft.avatarId !== (original?.avatarId ?? null)) {
    changes.avatarId = draft.avatarId;
  }
  return changes;
};
