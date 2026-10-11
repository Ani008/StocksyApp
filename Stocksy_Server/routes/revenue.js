/**
 * routes/revenue.js
 * Platform revenue endpoints — mount in server.js:
 *   app.use('/api/revenue', require('./routes/revenue'));
 *
 * This data is platform-wide (every user's trades), so these routes are
 * ADMIN ONLY: `protect` checks that someone is logged in, and `adminOnly`
 * then checks that their user id is listed in the ADMIN_USER_IDS env var
 * (comma-separated). If that variable is empty or unset, nobody can access
 * these routes — the routes fail closed.
 */

const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const { adminOnly } = require('../middleware/adminOnly');
const {
  getSummary,
  getMonthly,
  getDaily,
  getBySymbol,
  getLedger,
} = require('../controllers/revenueController');

// GET /api/revenue/summary    — headline card: all-time / this month / today
// GET /api/revenue/monthly    — month-by-month trend
// GET /api/revenue/daily      — day-by-day trend
// GET /api/revenue/by-symbol  — which stocks earn the most brokerage
// GET /api/revenue/ledger     — raw paginated ledger
router.get('/summary',    protect, adminOnly, getSummary);
router.get('/monthly',    protect, adminOnly, getMonthly);
router.get('/daily',      protect, adminOnly, getDaily);
router.get('/by-symbol',  protect, adminOnly, getBySymbol);
router.get('/ledger',     protect, adminOnly, getLedger);

module.exports = router;