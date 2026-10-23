import api from "./api";

// Errors (game not ready yet, network, session) are already surfaced as toasts
// by the interceptor in services/api.js, so callers only need to catch to stop
// their own spinners.

// ── Today's game: the rounds, my answers so far, and (only once I have answered
// every round) the result with the numbers behind each question ──────────────
export const getStockOfTheDayToday = async () => {
  const response = await api.get("/stock-of-the-day/today");
  return response.data;
};

// ── Lock in one answer. Safe to repeat: the server keeps the first answer for a
// round and returns the current state again. ──────────────────────────────────
export const submitStockOfTheDayAnswer = async (roundIndex, pickedKey) => {
  const response = await api.post("/stock-of-the-day/answer", { roundIndex, pickedKey });
  return response.data;
};

const stockOfTheDayService = { getStockOfTheDayToday, submitStockOfTheDayAnswer };
export default stockOfTheDayService;
