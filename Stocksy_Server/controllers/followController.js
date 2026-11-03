const repo = require("../repositories/followRepository");
const L = require("../services/followLogic");
const { ValidationError, NotFoundError, sendError } = require("../utils/errors");
const logger = require("../utils/logger");

// The :id in the URL is a user's UUID, or the word "me" for the logged-in
// user. A malformed id can never match a row — answer 404 rather than letting
// Postgres throw a cast error that would surface as a 500.
const resolveUserId = (param, viewerId) => {
  if (param === "me") return viewerId;
  if (!L.isUuid(param)) throw new NotFoundError("User not found");
  return param;
};

// ── GET /api/users/:id ────────────────────────────────────────────────────────
// A profile: name, avatar, followers / following counts, and how the viewer
// relates to them. No email, no balance — this is visible to other users.
async function getProfileHandler(req, res) {
  try {
    const viewerId = req.user.id;
    const userId = resolveUserId(req.params.id, viewerId);

    const profile = await repo.getProfile({ userId, viewerId });
    if (!profile) throw new NotFoundError("User not found");

    return res.json({ user: L.serializeProfile(profile, viewerId) });
  } catch (err) {
    return sendError(res, err, logger);
  }
}

// ── POST /api/users/:id/follow ────────────────────────────────────────────────
// Following someone you already follow just succeeds again.
async function followHandler(req, res) {
  try {
    const viewerId = req.user.id;
    const targetId = resolveUserId(req.params.id, viewerId);

    if (targetId === viewerId) throw new ValidationError("You can't follow yourself");

    try {
      await repo.follow({ followerId: viewerId, followingId: targetId });
    } catch (err) {
      // The target account doesn't exist (or was just deleted).
      if (repo.isForeignKeyViolation(err)) throw new NotFoundError("User not found");
      throw err;
    }

    const followersCount = await repo.countFollowers(targetId);
    return res.json({ message: "Followed", isFollowing: true, followersCount });
  } catch (err) {
    return sendError(res, err, logger);
  }
}

// ── DELETE /api/users/:id/follow ──────────────────────────────────────────────
// Unfollowing someone you don't follow just succeeds again.
async function unfollowHandler(req, res) {
  try {
    const viewerId = req.user.id;
    const targetId = resolveUserId(req.params.id, viewerId);

    if (targetId === viewerId) throw new ValidationError("You can't unfollow yourself");
    if (!(await repo.userExists(targetId))) throw new NotFoundError("User not found");

    await repo.unfollow({ followerId: viewerId, followingId: targetId });

    const followersCount = await repo.countFollowers(targetId);
    return res.json({ message: "Unfollowed", isFollowing: false, followersCount });
  } catch (err) {
    return sendError(res, err, logger);
  }
}

// Shared by the two list endpoints — they differ only in which way round the
// follows table is read.
const listHandler = (direction) => async (req, res) => {
  try {
    const viewerId = req.user.id;
    const targetId = resolveUserId(req.params.id, viewerId);

    const limit = L.clampLimit(req.query.limit, L.LIST_LIMIT);
    const cursor = L.decodeCursor(req.query.cursor);
    const search = L.cleanSearch(req.query.q);

    if (!(await repo.userExists(targetId))) throw new NotFoundError("User not found");

    const rows = await repo.listConnections({
      direction,
      targetId,
      viewerId,
      search,
      cursor,
      limit,
    });

    return res.json(L.buildPage(rows, limit, viewerId));
  } catch (err) {
    return sendError(res, err, logger);
  }
};

// ── GET /api/users/:id/followers?q=&limit=&cursor= ────────────────────────────
const listFollowersHandler = listHandler("followers");

// ── GET /api/users/:id/following?q=&limit=&cursor= ────────────────────────────
const listFollowingHandler = listHandler("following");

// ── GET /api/users/search?q=&limit= ───────────────────────────────────────────
// Find people to follow. Text shorter than 2 characters returns an empty list
// (not an error) so the app can call this on every keystroke without special-casing.
async function searchUsersHandler(req, res) {
  try {
    const viewerId = req.user.id;
    const term = L.cleanSearch(req.query.q);
    const limit = L.clampLimit(req.query.limit, L.SEARCH_LIMIT);

    if (term.length < L.MIN_PEOPLE_SEARCH_LENGTH) return res.json({ users: [] });

    const rows = await repo.searchUsers({ viewerId, term, limit });
    return res.json({ users: rows.map((row) => L.serializeUser(row, viewerId)) });
  } catch (err) {
    return sendError(res, err, logger);
  }
}

module.exports = {
  getProfileHandler,
  followHandler,
  unfollowHandler,
  listFollowersHandler,
  listFollowingHandler,
  searchUsersHandler,
};
