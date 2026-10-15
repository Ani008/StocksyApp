// Idempotency keys for order placement (security review item 13).
//
// THE PROBLEM
//   On a flaky mobile connection a request can reach the server and succeed
//   while the response is lost. The app then sees a timeout, the user taps
//   again, and a second order is placed. Double taps do the same.
//
// THE FIX
//   Every order request carries a random key. The server remembers it: the
//   same key again returns the order it already created instead of placing
//   another. So a retry is always safe, as long as the retry reuses the key.
//
// THE RULE THE APP FOLLOWS (createOrderAttempt below)
//   * One key per order the user is trying to place.
//   * Keep it across retries/double taps of that SAME order, including after
//     a timeout / dropped connection / 5xx, because the order may or may not
//     have been placed ("ambiguous" failure).
//   * Throw it away after success, and after a definite rejection (4xx:
//     insufficient funds, market closed, validation...), because nothing was
//     placed and the user may change the order and try again.
//   * Throw it away if the user changes the order (quantity, price, side...).
//
// No imports on purpose: pure JS so it runs in React Native, the browser and
// plain Node tests alike.

const HEX = [];
for (let i = 0; i < 256; i++) HEX.push((i + 0x100).toString(16).slice(1));

/** RFC 4122 version-4 UUID. Uses the platform CSPRNG when there is one. */
export function newIdempotencyKey(cryptoImpl = globalThis.crypto) {
  if (cryptoImpl && typeof cryptoImpl.randomUUID === "function") {
    return cryptoImpl.randomUUID();
  }
  const b = new Uint8Array(16);
  if (cryptoImpl && typeof cryptoImpl.getRandomValues === "function") {
    // native: App.js loads react-native-get-random-values, which provides this
    cryptoImpl.getRandomValues(b);
  } else {
    // Last resort. A key only has to be unique per user, not secret.
    for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  }
  b[6] = (b[6] & 0x0f) | 0x40; // version 4
  b[8] = (b[8] & 0x3f) | 0x80; // RFC 4122 variant
  return (
    HEX[b[0]] + HEX[b[1]] + HEX[b[2]] + HEX[b[3]] + "-" +
    HEX[b[4]] + HEX[b[5]] + "-" +
    HEX[b[6]] + HEX[b[7]] + "-" +
    HEX[b[8]] + HEX[b[9]] + "-" +
    HEX[b[10]] + HEX[b[11]] + HEX[b[12]] + HEX[b[13]] + HEX[b[14]] + HEX[b[15]]
  );
}

/**
 * Did this failure leave it UNKNOWN whether the order was placed?
 *   no response at all (timeout, offline, connection reset) -> unknown
 *   5xx / 408 (gateway timeout, server fell over mid-request) -> unknown
 *   any other HTTP error (400, 401, 422, 429...)             -> definitely NOT placed
 */
export function isAmbiguousFailure(err) {
  const status = err?.response?.status;
  if (!err?.response) return true;
  return status >= 500 || status === 408;
}

const num = (v) => (v === null || v === undefined || v === "" ? null : Number(v));

/**
 * The parts of an order request that are the user's INTENT. Mirrors the
 * server's fingerprint (Stocksy_Server/utils/idempotency.js): the live price
 * sent with a MARKET order is not intent, it changes every tick, so a retry a
 * second later must still count as the same order.
 */
export function orderIntent(payload = {}) {
  const isMarket = payload.order_type === "MARKET" || payload.order_type === "SL_M";
  return JSON.stringify([
    payload.wallet_id ?? null,
    payload.instrument_key ?? null,
    payload.symbol ?? null,
    payload.order_type ?? null,
    payload.side ?? null,
    num(payload.quantity),
    isMarket ? null : num(payload.price),
    payload.order_type === "MARKET" ? null : num(payload.trigger_price),
    payload.product_type ?? "CNC",
  ]);
}

/**
 * Holds the idempotency key for ONE order the user is trying to place.
 * Create one per screen / flow (e.g. useRef(createOrderAttempt()).current).
 *
 *   const key = attempt.keyFor(payload);           // same key while the order is unchanged
 *   try { await placeOrder(payload, { idempotencyKey: key }); attempt.succeeded(); }
 *   catch (e) { attempt.failed(e); ... }
 */
export function createOrderAttempt({ generate = newIdempotencyKey } = {}) {
  let key = null;
  let intent = null;
  const clear = () => { key = null; intent = null; };

  return {
    keyFor(payload) {
      const now = orderIntent(payload);
      if (key === null || now !== intent) {
        key = generate();
        intent = now;
      }
      return key;
    },
    succeeded: clear,
    failed(err) {
      if (!isAmbiguousFailure(err)) clear();
    },
    reset: clear,
  };
}
