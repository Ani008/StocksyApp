import api from "./api";

/**
 * Fetch the supply chain graph for one stock.
 * GET /api/supply-chain/:symbol
 *
 * Resolves to:
 *   { company, suppliers[], customers[] }   — data exists
 *   null                                    — 404, no data in the DB for this stock
 * Throws on any other failure (network, 500, ...), which api.js has already
 * toasted — the screen shows its own retry state.
 *
 * `skipNotFoundToast` stops api.js flashing a red toast for the 404, since
 * "no data" is a normal empty state here, not an error.
 */
export async function fetchSupplyChain(symbol) {
  try {
    const response = await api.get(
      `/supply-chain/${encodeURIComponent(symbol)}`,
      { skipNotFoundToast: true }
    );
    return response.data;
  } catch (err) {
    if (err.response?.status === 404) return null;
    throw err;
  }
}