-- =============================================================
-- 013_web_push_subscriptions.sql
--
-- Browser/PWA push subscriptions (Web Push API). One row per
-- browser install; a user can have several (phone + laptop).
--
-- endpoint is UNIQUE on purpose: the same browser re-subscribing, or a
-- different person logging in on the same browser, must MOVE the row to
-- that user rather than leave the old user's alerts going to this device.
-- =============================================================

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint      TEXT NOT NULL UNIQUE,
  p256dh        TEXT NOT NULL,
  auth          TEXT NOT NULL,
  user_agent    VARCHAR(300),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_success  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user ON push_subscriptions(user_id);
