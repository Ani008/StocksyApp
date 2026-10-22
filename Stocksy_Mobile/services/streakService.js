import api from "./api";

// The streak is saved on the server (see Stocksy_Server/routes/streak.js).
//
// Both calls are `silent`: they run in the background every time the app opens,
// so a failed one must not pop an error toast (the hook just keeps showing the
// last streak it has and tries again next time). Session expiry is still
// handled by the interceptor as usual.

// ── The streak as it stands. Records nothing. ────────────────────────────────
// Returns { current, longest, lastCheckIn, history, today, isNewDay, lostStreak }.
export const getStreak = async () => {
  const response = await api.get("/streak", { silent: true });
  return response.data;
};

// ── Count today (the app opening) and return the streak. ─────────────────────
// Safe to repeat: the server counts a day once however many times or from
// however many devices this is called.
//
// `importDays` is the streak the device had saved before the server kept it,
// offered ONCE so an existing streak isn't lost. The server decides whether to
// accept it.
export const checkInStreak = async (importDays) => {
  const body = importDays && importDays.length ? { importDays } : {};
  const response = await api.post("/streak/check-in", body, { silent: true });
  return response.data;
};

const streakService = { getStreak, checkInStreak };
export default streakService;
