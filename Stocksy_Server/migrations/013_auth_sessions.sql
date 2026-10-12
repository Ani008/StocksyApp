-- =============================================================
-- AUTH SESSIONS (server-tracked, revocable)
-- =============================================================
-- Before this, a login handed out a 30-day JWT that the server never
-- tracked: logout did nothing, and resetting a password or deleting an
-- account could not invalidate tokens that were already out there.
--
-- Now every login creates one row here. The short-lived access JWT
-- carries this row's id as its `sid` claim, and a long-lived refresh
-- token (stored only as a SHA-256 hash, never in plain text) is rotated
-- on every use. Revoking = setting revoked_at.
--
-- Run once:  psql -d <your db> -f migrations/013_auth_sessions.sql

CREATE TABLE IF NOT EXISTS auth_sessions (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  refresh_hash         CHAR(64) NOT NULL UNIQUE,   -- current refresh token
  prev_refresh_hash    CHAR(64),                   -- previous one (reuse detection)
  rotated_at           TIMESTAMPTZ,

  client_type          VARCHAR(10) NOT NULL DEFAULT 'native'
                         CHECK (client_type IN ('web', 'native')),
  user_agent           VARCHAR(255),

  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at           TIMESTAMPTZ NOT NULL,       -- sliding refresh expiry
  absolute_expires_at  TIMESTAMPTZ NOT NULL,       -- hard cap, never extended
  revoked_at           TIMESTAMPTZ,
  revoked_reason       VARCHAR(40)
);

CREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON auth_sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_prev ON auth_sessions (prev_refresh_hash);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_expiry ON auth_sessions (expires_at);
