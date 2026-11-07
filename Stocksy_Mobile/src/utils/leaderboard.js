// src/utils/leaderboard.js
//
// Rules for the Leaderboard page. No React, no network — kept apart so
// tests/leaderboard.test.mjs can check them.
//
// The server (GET /api/leaderboard) already does the ranking: every entry
// arrives with its real `rank`, in rank order. The app never sorts or counts
// ranks itself. An entry from the server looks like:
//   { rank, id, fullName, username|null, avatar, avatarId|null, points, isSelf }

import { primaryName } from "./followUsers.js";

export const LEADERBOARD_TABS = [
  { key: "friends", label: "Friends" },
  { key: "global", label: "Global" },
];

export const DEFAULT_TAB = "friends";

// Ranks 1-3 stand on the podium; everyone after that goes in the list.
export const PODIUM_SIZE = 3;

const isPositiveInt = (n) => Number.isInteger(n) && n >= 1;

// One server entry → what the podium and list rows draw. null if it can't be
// drawn (no id, or no usable rank).
export const toBoardEntry = (raw) => {
  if (!raw || typeof raw.id !== "string" || !raw.id || !isPositiveInt(raw.rank)) return null;
  const points = Number.isFinite(raw.points) ? Math.max(0, Math.round(raw.points)) : 0;
  return {
    id: raw.id,
    rank: raw.rank,
    name: primaryName(raw), // chosen username, else full name
    points,
    avatarId: raw.avatarId || null,
    avatarUrl: raw.avatar || null, // Google photo, used only when no avatar was picked
    isSelf: Boolean(raw.isSelf),
  };
};

// The server response → { entries, me, total } ready to draw. Anything
// malformed is dropped rather than crashing the page.
export const normalizeBoard = (data) => {
  const entries = Array.isArray(data?.entries)
    ? data.entries.map(toBoardEntry).filter(Boolean)
    : [];
  const me = toBoardEntry(data?.me);
  const total = Number.isInteger(data?.total) && data.total >= 0 ? data.total : entries.length;
  return { entries, me, total };
};

// Top 3 for the podium, the rest for the list.
export const splitBoard = (entries) => ({
  podium: entries.slice(0, PODIUM_SIZE),
  rest: entries.slice(PODIUM_SIZE),
});

// Your own row, pinned under the list — but only when you are NOT already in
// the list (e.g. rank 340 on the global board). Null when there is nothing to pin.
export const pinnedMe = (board) =>
  board?.me && !board.entries.some((e) => e.id === board.me.id) ? board.me : null;

// The friends board is just you: you are ranked and nobody else is (nobody
// followed, or the people you follow have no points yet).
export const isFriendsAlone = (tab, board) =>
  tab === "friends" && Boolean(board?.me) && (board?.total ?? 0) <= 1;

// There are ranked people but you are not one of them: you have no points yet.
export const isUnranked = (board) =>
  Boolean(board) && board.entries.length > 0 && !board.me;

// "Your rank" line under the list: "#340 of 1,204".
export const rankSummary = (me, total) => {
  if (!me) return "";
  const of = total > 0 ? ` of ${total.toLocaleString("en-IN")}` : "";
  return `#${me.rank}${of}`;
};

// What the page says when there is nothing to rank besides you.
export const FRIENDS_ALONE = {
  title: "Follow friends to compete",
  message: "No friends are on your board yet. Follow people, or ask friends to start playing, to see how you rank.",
  action: "Find people",
};

// What the page says when nobody has any points. Only people with at least one
// point are ranked, so a brand-new app shows this instead of a list tied on 0.
export const NOBODY = {
  title: "No one on the leaderboard yet",
  message: "Points come from daily check-ins, Stock of the Day and correct Nifty calls. Score one to be first.",
};

// Shown under the list when others are ranked but you have no points yet.
export const NOT_RANKED = "You're not on the board yet. Earn your first point to get ranked.";

// What the page says when the board could not be loaded.
export const LOAD_ERROR = {
  title: "Couldn't load the leaderboard",
  message: "Check your connection and try again.",
};
