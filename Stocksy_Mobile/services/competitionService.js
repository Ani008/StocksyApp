// services/competitionService.js
//
// VU Trading Competition calls. Silent: the page shows its own messages.
import api from "./api";

/**
 * My status: { visible, registrationOpen, startsAt, serverTime, divisions, entry }.
 * `entry` is null until I join, else { division, joinedAt }.
 */
export const getCompetitionStatus = async () => {
  const res = await api.get("/competition/me", { silent: true });
  return res.data;
};

/** Save my division. Resolves { entry, created }. Safe to repeat. */
export const joinCompetition = async (division) => {
  const res = await api.post("/competition/join", { division }, { silent: true });
  return res.data;
};
