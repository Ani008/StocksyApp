import api from "./api";

// Thin wrappers over /api/push. Errors bubble to the caller; the global
// interceptor in api.js already shows a toast for server-side failures.
export const getPushConfig = async () => {
  const res = await api.get("/push/public-key");
  return res.data; // { enabled, publicKey }
};

export const registerPushSubscription = async (body) => {
  const res = await api.post("/push/subscribe", body);
  return res.data;
};

export const removePushSubscription = async (endpoint) => {
  const res = await api.post("/push/unsubscribe", { endpoint });
  return res.data;
};
