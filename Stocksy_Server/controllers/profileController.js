const repo = require("../repositories/profileRepository");
const L = require("../services/profileLogic");
const { AVATARS } = require("../config/avatars");
const { ConflictError, NotFoundError, sendError } = require("../utils/errors");
const logger = require("../utils/logger");

// ── PATCH /api/users/me ───────────────────────────────────────────────────────
// Edit your own profile. Body: any of { fullName, username, avatarId }.
// The email can't be changed (asking to is a 400). Returns the updated account
// in the same shape as login, so the app can swap it straight in.
async function updateMyProfileHandler(req, res) {
  try {
    const changes = L.parseProfileUpdate(req.body);

    let row;
    try {
      row = await repo.updateProfile(req.user.id, changes);
    } catch (err) {
      if (repo.isUsernameTakenError(err)) {
        throw new ConflictError("That username is already taken.", "USERNAME_TAKEN");
      }
      throw err;
    }
    if (!row) throw new NotFoundError("User not found");

    return res.json({ message: "Profile updated", user: L.serializeAccount(row) });
  } catch (err) {
    return sendError(res, err, logger);
  }
}

// ── GET /api/auth/username-available?username= ────────────────────────────────
// For the signup screen (no login yet) and the edit-profile screen: "is this
// username OK?". Always answers 200 with { available, ... } so the app can
// show the reason next to the field; `username` in the reply is the cleaned
// (lowercase) version that will actually be saved.
async function usernameAvailableHandler(req, res) {
  try {
    const result = L.checkUsername(req.query.username);

    if (!result.ok) {
      return res.json({ available: false, reason: result.reason, message: result.message });
    }

    if (await repo.isUsernameTaken(result.username)) {
      return res.json({
        available: false,
        username: result.username,
        reason: "TAKEN",
        message: "That username is already taken.",
      });
    }

    return res.json({ available: true, username: result.username });
  } catch (err) {
    return sendError(res, err, logger);
  }
}

// ── GET /api/avatars ──────────────────────────────────────────────────────────
// The avatars a person can pick: [{ id: "female_3", gender: "female" }, ...].
async function listAvatarsHandler(req, res) {
  return res.json({ avatars: AVATARS });
}

module.exports = { updateMyProfileHandler, usernameAvailableHandler, listAvatarsHandler };
