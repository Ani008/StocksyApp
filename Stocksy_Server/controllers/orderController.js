const { placeOrder, cancelOrder, getOrders } = require('../services/orderService');
const { getPositions, getPortfolioSummary, getTrades } = require('../services/positionService');
const { sendError } = require('../utils/errors');
const { readIdempotencyKey } = require('../utils/idempotency');
const { recordActivitySafe } = require('../services/streakService');
const logger = require('../utils/logger');

// ── POST /api/orders ──────────────────────────────────────────────────────────
async function createOrder(req, res) {
  try {
    const userId = req.user.id; // set by protect() middleware
    const { wallet_id, ...orderPayload } = req.body;

    if (!wallet_id) return res.status(400).json({ message: 'wallet_id is required', code: 'VALIDATION_ERROR', severity: 'error' });

    // Idempotency-Key (security review item 13): a retry / double tap of the
    // same order returns the original order instead of placing a second one.
    const idempotencyKey = readIdempotencyKey(req);
    let replayed = false;

    const order = await placeOrder(userId, wallet_id, orderPayload, {
      idempotencyKey,
      onReplay: () => { replayed = true; },
    });

    // Placing an order (delivery or intraday, buy or sell) is what earns the
    // day's streak. The order already exists at this point, so this can never
    // fail the request: errors are logged inside and swallowed. Only this route
    // counts. Orders the system creates itself (auto square-off, triggered
    // stop-losses) don't go through here and must not earn a day.
    await recordActivitySafe(userId, 'order');

    if (replayed) res.set('Idempotent-Replayed', 'true');
    return res.status(201).json({
      message: 'Order placed successfully',
      order: sanitiseOrder(order),
    });
  } catch (err) {
    return sendError(res, err, logger);
  }
}

// ── GET /api/orders ───────────────────────────────────────────────────────────
async function listOrders(req, res) {
  try {
    const userId = req.user.id;
    const { wallet_id, status, limit = 20, offset = 0 } = req.query;
    const orders = await getOrders(userId, { walletId: wallet_id, status, limit: +limit, offset: +offset });
    // idempotency_key / request_hash are internal bookkeeping, not API fields.
    return res.json({
      orders: orders.map(({ idempotency_key, request_hash, ...o }) => o),
    });
  } catch (err) {
    return sendError(res, err, logger);
  }
}

// ── DELETE /api/orders/:id ────────────────────────────────────────────────────
async function cancelOrderHandler(req, res) {
  try {
    const result = await cancelOrder(req.user.id, req.params.id);
    return res.json(result);
  } catch (err) {
    return sendError(res, err, logger);
  }
}

// ── GET /api/portfolio ────────────────────────────────────────────────────────
async function getPortfolio(req, res) {
  try {
    const summary = await getPortfolioSummary(req.user.id);
    return res.json(summary);
  } catch (err) {
    return sendError(res, err, logger);
  }
}

// ── GET /api/positions ────────────────────────────────────────────────────────
async function getPositionsHandler(req, res) {
  try {
    const { wallet_id } = req.query;
    const positions = await getPositions(req.user.id, wallet_id);
    return res.json({ positions });
  } catch (err) {
    return sendError(res, err, logger);
  }
}

// ── GET /api/trades ───────────────────────────────────────────────────────────
async function getTradesHandler(req, res) {
  try {
    const { wallet_id, instrument_key, limit = 20, offset = 0 } = req.query;
    const trades = await getTrades(req.user.id, {
      walletId: wallet_id, instrumentKey: instrument_key,
      limit: +limit, offset: +offset
    });
    return res.json({ trades });
  } catch (err) {
    return sendError(res, err, logger);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function sanitiseOrder(order) {
  // Strip internal fields from API response
  const { metadata, idempotency_key, request_hash, ...rest } = order;
  return rest;
}

module.exports = {
  createOrder,
  listOrders,
  cancelOrderHandler,
  getPortfolio,
  getPositionsHandler,
  getTradesHandler,
};