-- =============================================================
-- Order idempotency keys (security review item 13)
-- =============================================================
--
-- A client (web PWA or native app) sends a random key with every order it
-- places. If the same key arrives again for the same user - a retry after a
-- timeout, a double tap, a flaky mobile connection - the server returns the
-- order it already created instead of placing (and reserving margin for) a
-- second one.
--
--   idempotency_key  the client's key. NULL for orders that did not send one
--                    (old app versions, and server-generated orders such as
--                    square-off, RMS force-close and price-alert orders).
--   request_hash     SHA-256 of the order's essential fields. Lets the server
--                    tell "same request retried" (replay it) from "same key,
--                    different order" (reject it with 422).
--
-- The unique index is the safety net that makes this correct even if two
-- identical requests reach the server at the same instant.
--
-- Safe to run repeatedly. Safe to run BEFORE the new server code is deployed
-- (the old code simply ignores the new columns).

ALTER TABLE orders ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(80);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS request_hash    CHAR(64);

CREATE UNIQUE INDEX IF NOT EXISTS uq_orders_user_idempotency
  ON orders (user_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
