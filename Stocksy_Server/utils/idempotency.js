// utils/idempotency.js
//
// Helpers for order idempotency keys (security review item 13).
//
//   readIdempotencyKey(req)  -> validated key string, or null if none sent
//   fingerprintOrder(...)    -> SHA-256 hex of the order's essential fields
//
// Header: `Idempotency-Key` (the IETF draft name) or `X-Idempotency-Key` (what
// the Stocksy client sends; already allowed by config/cors.js).
//
// Set REQUIRE_IDEMPOTENCY_KEY=true to reject orders that arrive WITHOUT a key.
// Leave it off until every client in the wild sends one (store builds of the
// native app lag behind the web app), then turn it on.

const crypto = require('node:crypto');
const { ValidationError } = require('./errors');

// 8-80 chars of letters, digits and - _ . : (a UUID fits comfortably).
const KEY_RE = /^[A-Za-z0-9_.:-]{8,80}$/;

function readIdempotencyKey(req, env = process.env) {
  const raw = req.get('Idempotency-Key') ?? req.get('X-Idempotency-Key');

  if (raw == null || raw === '') {
    if (env.REQUIRE_IDEMPOTENCY_KEY === 'true') {
      throw new ValidationError('An Idempotency-Key header is required to place an order');
    }
    return null;
  }

  const key = String(raw).trim();
  if (!KEY_RE.test(key)) {
    throw new ValidationError(
      'Idempotency-Key must be 8-80 characters: letters, digits, "-", "_", "." or ":"'
    );
  }
  return key;
}

const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));

/**
 * What makes two order requests "the same order". Deliberately excludes
 * display-only fields (name) and free-form metadata, so cosmetic differences
 * on a retry do not turn a legitimate replay into a 422.
 *
 * For MARKET orders the client's `price` is just the live price at the moment
 * of the tap (the server ignores it and fills at its own LTP), and it changes
 * every tick. It is not part of what the user asked for, so it is left out:
 * otherwise a retry a second later would look like a different order.
 */
function fingerprintOrder(walletId, payload) {
  const isMarket = payload.order_type === 'MARKET' || payload.order_type === 'SL_M';
  const canonical = JSON.stringify([
    String(walletId),
    payload.instrument_key ?? null,
    payload.symbol ?? null,
    payload.order_type ?? null,
    payload.side ?? null,
    num(payload.quantity),
    // MARKET has no limit price; SL_M has no limit price either (trigger only).
    isMarket ? null : num(payload.price),
    payload.order_type === 'MARKET' ? null : num(payload.trigger_price),
    payload.product_type ?? 'CNC',
  ]);
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

module.exports = { readIdempotencyKey, fingerprintOrder, KEY_RE };
