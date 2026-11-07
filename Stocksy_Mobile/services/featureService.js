// services/featureService.js
//
// Remote feature switches (GET /api/config/features, public). Silent: the screens
// decide what to show, an error toast here would only be noise.
import api from "./api";

/**
 * { features: { competition_visible, ... }, settings: { competition_starts_at },
 *   serverTime }. Throws on a network error OR a response that doesn't look right,
 * so a half-broken answer is never mistaken for "switched on".
 */
export const fetchAppFeatures = async () => {
  const res = await api.get("/config/features", { silent: true });
  const data = res?.data;
  if (!data || data.success !== true || typeof data.features !== "object" || data.features === null) {
    throw new Error("Invalid features response");
  }
  return data;
};
