// services/leaderboardLogic.js
//
// The leaderboard's rules that need no database and no Express: how points are
// earned, which scopes exist, validating the query string, and shaping rows
// into what the app receives. Kept apart so tests/leaderboard.test.js can check
// them directly.
//
// Points are DERIVED, never stored. They are worked out from what the user has
// actually done (see repositories/leaderboardRepository.js), so they can never
// drift out of sync with the real data and there is nothing to backfill.

// ── How points are earned ───────────────────────────────────────────────────
// The only place the weights live. The repository passes them to SQL as query
// parameters, so changing a number here changes the ranking everywhere.
const POINTS = Object.freeze({
  STREAK_DAY: 5, //         each IST day the user opened Stocksy (user_streak_checkins)
  STOCK_OF_THE_DAY: 10, //  each correct round of a COMPLETED Stock of the Day
  NIFTY_WIN: 20, //         each Nifty call settled as WON (VOID and LOST earn nothing)
});

// ── Scopes ──────────────────────────────────────────────────────────────────
//   friends  the viewer plus everyone the viewer follows
//   global   every user on the app
const SCOPES = Object.freeze(["friends", "global"]);
const DEFAULT_SCOPE = "friends";

// How many ranked rows one response carries. The viewer's own row is always
// added on top of this (see `me` below), so being far down the table still
// shows you where you stand.
const LIMIT = Object.freeze({ def: 50, max: 100 });

// ?scope= → "friends" | "global". Missing → the default. Anything else (an
// unknown word, ?scope=a&scope=b, ?scope[x]=1) → null, which the controller
// turns into a 400 rather than silently guessing.
const parseScope = (raw) => {
  if (raw === undefined || raw === null || raw === "") return DEFAULT_SCOPE;
  if (typeof raw !== "string") return null;
  const scope = raw.trim().toLowerCase();
  return SCOPES.includes(scope) ? scope : null;
};

// ?limit= → a whole number between 1 and LIMIT.max.
const clampLimit = (raw) => {
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) return LIMIT.def;
  return Math.min(n, LIMIT.max);
};

// ── Response shapes ─────────────────────────────────────────────────────────
//
// Only what the leaderboard needs. Never email, balance or provider — these
// rows go to other users. Same field names as the follow lists (serializeUser)
// so the app can reuse its avatar handling.

const serializeEntry = (row, viewerId) => ({
  rank: Number(row.rank),
  id: row.id,
  fullName: row.full_name,
  username: row.handle ?? null, // their chosen username; null until they choose one
  avatar: row.avatar ?? "", // Google profile photo URL, if any
  avatarId: row.avatar_id ?? null, // the avatar they picked from config/avatars.js
  points: Number(row.points),
  isSelf: row.id === viewerId,
});

// The repository returns the ranked top rows plus the viewer's own row (which
// may be far below the cut). Split that into what the app shows:
//   entries  the top `limit` rows, rank order
//   me       the viewer's own row (null if they are not in this scope's table)
//   total    how many people are ranked in this scope
const buildResponse = (scope, rows, limit, viewerId) => {
  const entries = rows.filter((row) => Number(row.rank) <= limit);
  const meRow = rows.find((row) => row.id === viewerId);
  const total = rows.length > 0 ? Number(rows[0].total) : 0;

  return {
    scope,
    total,
    entries: entries.map((row) => serializeEntry(row, viewerId)),
    me: meRow ? serializeEntry(meRow, viewerId) : null,
  };
};

module.exports = {
  POINTS,
  SCOPES,
  DEFAULT_SCOPE,
  LIMIT,
  parseScope,
  clampLimit,
  serializeEntry,
  buildResponse,
};
