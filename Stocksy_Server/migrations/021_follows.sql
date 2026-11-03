-- =============================================================
-- FOLLOWS  (who follows whom)
-- =============================================================
--
-- One row = "follower_id follows following_id". Following is one-way and needs
-- no approval (like a public Instagram account). Two people following each
-- other is simply two rows.
--
-- Both columns cascade, so deleting an account (accountDeletionRepository does
-- a plain DELETE FROM users) removes that user from everyone's lists and
-- counts automatically.
--
-- The primary key is the uniqueness rule (you can follow someone only once) and
-- also answers "does A follow B?". The CHECK stops anyone following themselves,
-- even if a bug or a hand-written request ever skipped the controller's check.
--
-- Run once against the Stocksy Postgres database.

CREATE TABLE IF NOT EXISTS follows (
  follower_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  following_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  PRIMARY KEY (follower_id, following_id),
  CHECK (follower_id <> following_id)
);

-- "Who does X follow?"  — newest first, plus the following count.
-- Also what the leaderboard's "friends" ranking will read from.
CREATE INDEX IF NOT EXISTS idx_follows_follower_recent
  ON follows (follower_id, created_at DESC, following_id DESC);

-- "Who follows X?"  — newest first, plus the followers count.
CREATE INDEX IF NOT EXISTS idx_follows_following_recent
  ON follows (following_id, created_at DESC, follower_id DESC);
