/**
 * routes/watchlists.js
 * Mount in server.js: app.use('/api/watchlists', require('./routes/watchlists'));
 */

const express = require("express");
const router = express.Router();
const { protect } = require("../middleware/auth");
const {
  listWatchlistsHandler,
  createWatchlistHandler,
  deleteWatchlistHandler,
  addItemHandler,
  removeItemHandler,
} = require("../controllers/watchlistController");

// GET    /api/watchlists                          — the user's watchlists, each with its stocks
// POST   /api/watchlists                          — create one ({ name, instrument_key? })
// DELETE /api/watchlists/:id                      — delete one (and its stocks)
// POST   /api/watchlists/:id/items                — add a stock ({ instrument_key })
// DELETE /api/watchlists/:id/items/:instrumentKey — remove a stock (key URL-encoded)
router.get("/", protect, listWatchlistsHandler);
router.post("/", protect, createWatchlistHandler);
router.delete("/:id", protect, deleteWatchlistHandler);
router.post("/:id/items", protect, addItemHandler);
router.delete("/:id/items/:instrumentKey", protect, removeItemHandler);

module.exports = router;
