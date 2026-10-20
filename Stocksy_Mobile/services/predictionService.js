import api from "./api";

// Errors (window locked, no price yet, network, session) are already surfaced as
// toasts by the interceptor in services/api.js, so callers only need to catch
// to stop their own spinners.

// ── Today's card state: phase, countdown times, my call (if any), streak ─────
export const getNiftyToday = async () => {
  const response = await api.get("/predictions/nifty/today");
  return response.data;
};

// ── Lock in today's call. direction is "UP" or "DOWN". ───────────────────────
// Safe to repeat: the server keeps the first call and returns it again.
export const submitNiftyPrediction = async (direction) => {
  const response = await api.post("/predictions/nifty", { direction });
  return response.data;
};

const predictionService = { getNiftyToday, submitNiftyPrediction };
export default predictionService;
