/**
 * routes/users.js
 * Mount in server.js: app.use('/api/users', require('./routes/users'));
 *
 * Profiles and the follow graph. Every route needs a login. Following is
 * one-way and needs no approval. In every path below, :id is a user's UUID, or
 * the word "me" for the logged-in user.
 */

const express = require("express");
const router = express.Router();
const { protect } = require("../middleware/auth");
const { followLimiter, userSearchLimiter, profileLimiter } = require("../middleware/rateLimiter");
const { updateMyProfileHandler } = require("../controllers/profileController");
const {
  getProfileHandler,
  followHandler,
  unfollowHandler,
  listFollowersHandler,
  listFollowingHandler,
  searchUsersHandler,
} = require("../controllers/followController");

// PATCH  /api/users/me                          — edit your own profile: { fullName?, username?, avatarId? } (never email)
// GET    /api/users/search?q=&limit=            — find people to follow (name or username; q needs 2+ characters)
// GET    /api/users/:id                         — profile: name, username, avatar, followers/following counts, isFollowing
// POST   /api/users/:id/follow                  — follow them
// DELETE /api/users/:id/follow                  — unfollow them
// GET    /api/users/:id/followers?q=&limit=&cursor= — their followers, newest first (q filters by name)
// GET    /api/users/:id/following?q=&limit=&cursor= — who they follow, newest first (q filters by name)
//
// Lists come back as { users: [...], nextCursor } — pass nextCursor back as
// ?cursor= for the next page; null means that was the last page.
//
// "search" must be registered before "/:id" or it would be read as a user id.
router.patch("/me", protect, profileLimiter, updateMyProfileHandler);
router.get("/search", protect, userSearchLimiter, searchUsersHandler);
router.get("/:id", protect, getProfileHandler);
router.post("/:id/follow", protect, followLimiter, followHandler);
router.delete("/:id/follow", protect, followLimiter, unfollowHandler);
router.get("/:id/followers", protect, listFollowersHandler);
router.get("/:id/following", protect, listFollowingHandler);

module.exports = router;
