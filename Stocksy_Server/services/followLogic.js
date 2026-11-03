// services/followLogic.js
//
// The follow system's rules that need no database and no Express: validating
// ids / search text / paging cursors, and shaping rows into what the app
// receives. Kept apart so tests/follow.test.js can check them directly.

const { ValidationError } = require("../utils/errors");

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const LIST_LIMIT = { def: 20, max: 50 }; // followers / following pages
const SEARCH_LIMIT = { def: 20, max: 30 }; // find-people results (not paged)
const MAX_SEARCH_LENGTH = 50;
const MIN_PEOPLE_SEARCH_LENGTH = 2;

const isUuid = (value) => typeof value === "string" && UUID_RE.test(value);

// ?limit= from the query string → a whole number between 1 and `max`.
const clampLimit = (raw, { def, max }) => {
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) return def;
  return Math.min(n, max);
};

// ?q= → trimmed, single-spaced, capped. Anything that isn't a plain string
// (?q=a&q=b, ?q[x]=1) counts as "no search".
const cleanSearch = (raw) => {
  if (typeof raw !== "string") return "";
  return raw.trim().replace(/\s+/g, " ").slice(0, MAX_SEARCH_LENGTH);
};

// Search text goes into an ILIKE pattern, where % and _ are wildcards and \ is
// the escape character. Escape all three so typing "50%" or "a_b" searches for
// exactly that instead of matching everything.
const escapeLike = (text) => text.replace(/[\\%_]/g, "\\$&");

// ── Paging cursor ───────────────────────────────────────────────────────────
//
// Lists are paged by (created_at, user id) rather than OFFSET, so someone
// following or unfollowing while you scroll can't make rows repeat or vanish.
//
// The timestamp is carried as TEXT in UTC with full microsecond precision
// (the repository formats it with to_char). Going through a JS Date would cut
// it to milliseconds, and rows created within the same millisecond could then
// be skipped or repeated across pages.
const CURSOR_TS_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
const MAX_CURSOR_LENGTH = 200;

const encodeCursor = (ts, id) => Buffer.from(JSON.stringify([ts, id])).toString("base64url");

// No cursor → null. A cursor that isn't one of ours → ValidationError (400),
// never a database cast error (500).
const decodeCursor = (raw) => {
  if (raw === undefined || raw === null || raw === "") return null;

  const invalid = () => new ValidationError("Invalid cursor");
  if (typeof raw !== "string" || raw.length > MAX_CURSOR_LENGTH) throw invalid();

  let parsed;
  try {
    parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    throw invalid();
  }

  if (!Array.isArray(parsed) || parsed.length !== 2) throw invalid();
  const [ts, id] = parsed;
  if (typeof ts !== "string" || !CURSOR_TS_RE.test(ts) || !isUuid(id)) throw invalid();

  // Reject impossible dates like 2026-02-30 (JS would roll them over, Postgres
  // would throw): a real date survives a round trip unchanged.
  const millis = ts.slice(0, 23) + "Z";
  const date = new Date(millis);
  if (Number.isNaN(date.getTime()) || date.toISOString() !== millis) throw invalid();

  return { ts, id };
};

// ── Response shapes ─────────────────────────────────────────────────────────
//
// Only what the follow screens need. Never email, balance, or provider —
// these shapes go to other users.

const serializeUser = (row, viewerId) => ({
  id: row.id,
  fullName: row.full_name,
  avatar: row.avatar ?? "",
  isSelf: row.id === viewerId, // the app hides the Follow button on your own row
  isFollowing: Boolean(row.is_following), // you follow them
  followsYou: Boolean(row.follows_you), // they follow you ("Follow back")
});

const serializeProfile = (row, viewerId) => ({
  ...serializeUser(row, viewerId),
  followersCount: row.followers_count,
  followingCount: row.following_count,
});

// The repository fetches limit + 1 rows: the extra one only proves another
// page exists. Return the page and a cursor pointing at its last row.
const buildPage = (rows, limit, viewerId) => {
  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;
  const last = pageRows[pageRows.length - 1];

  return {
    users: pageRows.map((row) => serializeUser(row, viewerId)),
    nextCursor: hasMore ? encodeCursor(last.cursor_ts, last.id) : null,
  };
};

module.exports = {
  LIST_LIMIT,
  SEARCH_LIMIT,
  MIN_PEOPLE_SEARCH_LENGTH,
  isUuid,
  clampLimit,
  cleanSearch,
  escapeLike,
  encodeCursor,
  decodeCursor,
  serializeUser,
  serializeProfile,
  buildPage,
};
