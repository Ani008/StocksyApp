import api from "./api";

// Errors (validation, network, session) are already surfaced as toasts by the
// interceptor in services/api.js, so callers only need to catch to stop their
// own spinners.

// ── List: every watchlist the user has, each with its stocks ─────────────────
export const getWatchlists = async () => {
  const response = await api.get("/watchlists");
  return response.data.watchlists;
};

// ── Create: optionally adds a stock to the new list straight away ────────────
export const createWatchlist = async ({ name, instrumentKey }) => {
  const response = await api.post("/watchlists", {
    name,
    instrument_key: instrumentKey,
  });
  return response.data.watchlist;
};

// ── Delete a whole watchlist ─────────────────────────────────────────────────
export const deleteWatchlist = async (watchlistId) => {
  const response = await api.delete(`/watchlists/${watchlistId}`);
  return response.data;
};

// ── Add / remove a stock. Both return the updated watchlist. ─────────────────
export const addToWatchlist = async ({ watchlistId, instrumentKey }) => {
  const response = await api.post(`/watchlists/${watchlistId}/items`, {
    instrument_key: instrumentKey,
  });
  return response.data.watchlist;
};

// Instrument keys contain "|" and spaces (e.g. "NSE_EQ|INE009A01021"), so the
// key must be URL-encoded to travel in the path.
export const removeFromWatchlist = async ({ watchlistId, instrumentKey }) => {
  const response = await api.delete(
    `/watchlists/${watchlistId}/items/${encodeURIComponent(instrumentKey)}`,
  );
  return response.data.watchlist;
};

const watchlistService = {
  getWatchlists,
  createWatchlist,
  deleteWatchlist,
  addToWatchlist,
  removeFromWatchlist,
};
export default watchlistService;
