// services/leaderboardService.js
//
// Call for the leaderboard (backend: Stocksy_Server/routes/leaderboard.js).
//
// A reading call, so it is `silent`: the Leaderboard page shows its own "try
// again" message, and api.js must not also pop an error toast.

import api from "./api";

/**
 * The ranked table for one tab.
 *   scope  "friends" (you + the people you follow) | "global" (everyone)
 *
 * Resolves the raw response { scope, total, entries, me } — run it through
 * normalizeBoard (src/utils/leaderboard.js) before drawing it.
 */
export const getLeaderboard = async (scope) => {
  const res = await api.get("/leaderboard", { params: { scope }, silent: true });
  return res.data;
};
