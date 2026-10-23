import api from "./api";

// The streak is saved on the server (see Stocksy_Server/routes/streak.js).
//
// There is no "record today" call on purpose: the server records a day itself
// when the user places an order or makes their Nifty call. The app only reads.
//
// Both calls are `silent`: they run in the background, so a failed one must not
// pop an error toast (the hook just keeps showing the last streak it has and
// tries again next time). Session expiry is still handled by the interceptor.

// ── The streak as it stands. Records nothing. ────────────────────────────────
// Returns { current, longest, lastCheckIn, aliveThrough, history, offDays,
//           lostStreak, today }.
export const getStreak = async () => {
  const response = await api.get("/streak", { silent: true });
  return response.data;
};

// ── One-time upload of the streak the device had before the server kept it. ──
// Offered once so an existing streak isn't lost; the server decides whether to
// accept it. Records nothing for today. Returns the same shape as getStreak.
export const importStreakDays = async (importDays) => {
  const response = await api.post("/streak/import", { importDays }, { silent: true });
  return response.data;
};

const streakService = { getStreak, importStreakDays };
export default streakService;
