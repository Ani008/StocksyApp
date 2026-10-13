-- =============================================================
-- SERVER-TRACKED LOGIN SESSIONS + ROTATING REFRESH TOKENS
-- (security review items 1 and 2)
-- =============================================================
--
-- Before this, a login handed out a 30-day JWT that the server never
-- tracked, so logout / password reset / account deletion could not end it.
--
-- Now:
--   * every login creates one row in auth_sessions
--   * the short-lived access JWT carries that session's id (`sid`)
--   * middleware/auth.js only accepts the JWT while its session row is
--     active, so revoking a session kills its access token immediately
--   * refresh_tokens holds the (hashed) one-time refresh tokens that mint
--     new access tokens; each use rotates the token
--
-- Run once against the Stocksy Postgres database.
-- (gen_random_uuid() is already used by 001_create_users.sql.)

CREATE TABLE IF NOT EXISTS auth_sessions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at     TIMESTAMPTZ NOT NULL,
  revoked_at     TIMESTAMPTZ,
  revoke_reason  VARCHAR(40),
  user_agent     VARCHAR(300),
  ip             VARCHAR(64)
);

CREATE INDEX IF NOT EXISTS idx_auth_sessions_user_active
  ON auth_sessions(user_id) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id  UUID NOT NULL REFERENCES auth_sessions(id) ON DELETE CASCADE,
  -- SHA-256 of the token. The plain token only ever exists in the client's
  -- cookie / secure storage, so a database leak does not leak live sessions.
  token_hash  CHAR(64) NOT NULL UNIQUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_session ON refresh_tokens(session_id);
