// services/sessionService.js
//
// Session rules (the "what", independent of HTTP and of the database):
//
//   access token   short-lived JWT {id, sid}; default 15 minutes.
//   refresh token  random 256-bit secret, stored only as a SHA-256 hash.
//                  Single-use: every refresh swaps it for a new one.
//   reuse          if an OLD refresh token is shown again after the grace
//                  window, someone has a stolen copy — the whole session is
//                  revoked.
//   revocation     logout, logout-all, password reset and account deletion
//                  all revoke; the access token dies with its session
//                  because every request checks the session is still alive.

const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const { EventEmitter } = require("events");
const defaultStore = require("./sessionStore");

let store = defaultStore;
const setStore = (s) => { store = s || defaultStore; };

const events = new EventEmitter(); // 'revoked' → { sid? , userId? }

const num = (name, fallback) => {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};
const cfg = () => ({
  accessTtlSec: num("ACCESS_TOKEN_TTL_SECONDS", 15 * 60),
  refreshTtlMs: num("REFRESH_TOKEN_TTL_DAYS", 30) * 86400e3,
  absoluteTtlMs: num("SESSION_ABSOLUTE_DAYS", 90) * 86400e3,
  graceMs: num("REFRESH_REUSE_GRACE_SECONDS", 10) * 1000,
});

const sha256 = (v) => crypto.createHash("sha256").update(String(v)).digest("hex");
const newRefreshToken = () => crypto.randomBytes(32).toString("base64url");

const signAccessToken = (userId, sid) =>
  jwt.sign({ id: userId, sid }, process.env.JWT_SECRET, { expiresIn: cfg().accessTtlSec });

class SessionError extends Error {
  constructor(code) { super(code); this.code = code; }
}

async function createSession({ userId, clientType, userAgent }) {
  const c = cfg();
  const now = Date.now();
  const refreshToken = newRefreshToken();
  const session = await store.insert({
    userId,
    refreshHash: sha256(refreshToken),
    clientType: clientType === "web" ? "web" : "native",
    userAgent: String(userAgent || "").slice(0, 255) || null,
    expiresAt: new Date(now + c.refreshTtlMs),
    absoluteExpiresAt: new Date(now + c.absoluteTtlMs),
  });
  return {
    sid: session.id,
    accessToken: signAccessToken(userId, session.id),
    refreshToken,
    expiresIn: c.accessTtlSec,
    refreshMaxAgeMs: c.refreshTtlMs,
  };
}

// Throws SessionError: INVALID | EXPIRED | REUSED | RETRY
async function rotate(presentedToken) {
  if (!presentedToken || typeof presentedToken !== "string") throw new SessionError("INVALID");
  const c = cfg();
  const h = sha256(presentedToken);
  const s = await store.findByRefreshHash(h);
  if (!s) throw new SessionError("INVALID");
  if (s.revoked_at) throw new SessionError("INVALID");

  const now = Date.now();
  if (now > new Date(s.expires_at).getTime() || now > new Date(s.absolute_expires_at).getTime()) {
    await store.revoke(s.id, "expired");
    throw new SessionError("EXPIRED");
  }

  const isCurrent = s.refresh_hash === h;
  if (!isCurrent) {
    // An older token. Two tabs refreshing at the same moment look exactly
    // like this, so a short grace window answers "retry" (the winner's new
    // cookie is already in the browser). Later than that = stolen copy.
    if (s.rotated_at && now - new Date(s.rotated_at).getTime() < c.graceMs) {
      throw new SessionError("RETRY");
    }
    await store.revoke(s.id, "refresh_reuse");
    events.emit("revoked", { sid: s.id });
    throw new SessionError("REUSED");
  }

  const refreshToken = newRefreshToken();
  const nextExpiry = new Date(
    Math.min(now + c.refreshTtlMs, new Date(s.absolute_expires_at).getTime()),
  );
  const ok = await store.rotate({
    id: s.id, oldHash: h, newHash: sha256(refreshToken), expiresAt: nextExpiry,
  });
  if (!ok) throw new SessionError("RETRY"); // lost a race with another refresh

  return {
    sid: s.id,
    userId: s.user_id,
    clientType: s.client_type,
    accessToken: signAccessToken(s.user_id, s.id),
    refreshToken,
    expiresIn: c.accessTtlSec,
    refreshMaxAgeMs: Math.max(nextExpiry.getTime() - now, 1000),
  };
}

async function revokeSession(sid, reason = "logout") {
  await store.revoke(sid, reason);
  events.emit("revoked", { sid });
}

// Used when the caller only has a refresh token (access token already expired).
async function revokeByRefreshToken(token, reason = "logout") {
  if (!token || typeof token !== "string") return null;
  const s = await store.findByRefreshHash(sha256(token));
  if (!s) return null;
  await revokeSession(s.id, reason);
  return s.id;
}

async function revokeAllForUser(userId, reason) {
  const ids = await store.revokeAllForUser(userId, reason);
  events.emit("revoked", { userId: String(userId), sids: ids });
  return ids;
}

const findActiveSessionUser = (sid, userId) => store.findActiveSessionUser(sid, userId);
const findUser = (userId) => store.findUser(userId);
const activeIds = (ids) => store.activeIds(ids);

function startCleanup() {
  const run = () => store.deleteOld().catch((e) => console.error("[sessions] cleanup failed:", e.message));
  run();
  const t = setInterval(run, 6 * 3600e3);
  t.unref();
  return t;
}

// What the client is allowed to see about the user.
const publicUser = (u) => ({
  id: u.id,
  username: u.username,
  fullName: u.full_name,
  email: u.email,
  avatar: u.avatar,
  demoBalance: u.demo_balance,
});

module.exports = {
  SessionError,
  events,
  setStore,
  createSession,
  rotate,
  revokeSession,
  revokeByRefreshToken,
  revokeAllForUser,
  findActiveSessionUser,
  findUser,
  activeIds,
  startCleanup,
  publicUser,
  sha256,
};
