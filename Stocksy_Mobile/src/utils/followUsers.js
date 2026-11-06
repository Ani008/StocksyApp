// src/utils/followUsers.js
//
// Rules for the people cards on the Followers / Following page and in people
// search. No React, no network — kept apart so tests/followUsers.test.mjs can
// check them.
//
// A "user" here is what the server sends for every person in those lists:
//   { id, fullName, username|null, avatarId|null, isSelf, isFollowing, followsYou }

// Under this many characters the server answers with an empty list, so don't
// ask. (Mirrors MIN_PEOPLE_SEARCH_LENGTH in Stocksy_Server/services/followLogic.js.)
export const MIN_SEARCH_LENGTH = 2;

// Trim and collapse inner spaces, the same clean-up the server applies.
export const cleanQuery = (raw) =>
  typeof raw === "string" ? raw.trim().replace(/\s+/g, " ") : "";

export const isSearchable = (raw) => cleanQuery(raw).length >= MIN_SEARCH_LENGTH;

// The big line on a card: the chosen username. Someone who has not chosen one
// yet falls back to their full name, so a card is never blank.
export const primaryName = (user) =>
  (user?.username || "").trim() || (user?.fullName || "").trim() || "Trader";

// The small line under it: the full name, but only when it adds something —
// not when the username is missing (the full name is already the big line) and
// not when it just repeats the username.
export const secondaryName = (user) => {
  const username = (user?.username || "").trim();
  const fullName = (user?.fullName || "").trim();
  if (!username || !fullName) return "";
  return fullName.toLowerCase() === username.toLowerCase() ? "" : fullName;
};

// What the button on a card says and does. null means "no button" (your own
// card). Someone who follows you and you don't follow back reads "Follow back".
export const followButtonState = (user) => {
  if (!user || user.isSelf) return null;
  if (user.isFollowing) return { label: "Following", filled: false, action: "unfollow" };
  if (user.followsYou) return { label: "Follow back", filled: true, action: "follow" };
  return { label: "Follow", filled: true, action: "follow" };
};

// Keep only entries that can be drawn and told apart (they need an id).
export const normalizeUsers = (raw) =>
  Array.isArray(raw) ? raw.filter((u) => u && typeof u.id === "string" && u.id) : [];

// The list with one person's follow state changed; everyone else untouched.
export const withFollowState = (users, id, isFollowing) =>
  users.map((u) => (u.id === id ? { ...u, isFollowing: Boolean(isFollowing) } : u));

// Add the next page to the list, skipping anyone already there (people can
// follow or unfollow while you scroll, which can repeat a row across pages).
export const mergeUsers = (existing, incoming) => {
  const seen = new Set(existing.map((u) => u.id));
  const fresh = normalizeUsers(incoming).filter((u) => !seen.has(u.id));
  return fresh.length ? [...existing, ...fresh] : existing;
};

// What the page says when a search finds nobody.
export const NO_RESULTS = {
  title: "No profiles found",
  message: "Try a different username or name.",
};

// What the page says when the list could not be loaded.
export const LOAD_ERROR = {
  title: "Couldn't load profiles",
  message: "Check your connection and try again.",
};
