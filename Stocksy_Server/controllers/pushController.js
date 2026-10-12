const repo = require("../repositories/pushSubscriptionRepository");
const webPush = require("../services/webPushService");
const logger = require("../utils/logger");

const fail = (res, status, message, code) =>
  res.status(status).json({ message, code, severity: "error" });

// Push endpoints are always https URLs on the browser vendor's push service.
const isValidEndpoint = (e) => {
  if (typeof e !== "string" || e.length > 1000) return false;
  try {
    return new URL(e).protocol === "https:";
  } catch {
    return false;
  }
};
const isB64Url = (s, max) => typeof s === "string" && s.length > 0 && s.length <= max && /^[A-Za-z0-9_-]+=*$/.test(s);

// GET /api/push/public-key — the browser needs this to subscribe.
const publicKeyHandler = (req, res) => {
  const key = webPush.getPublicKey();
  if (!key) return res.json({ enabled: false, publicKey: null });
  res.json({ enabled: true, publicKey: key });
};

// POST /api/push/subscribe   body: { endpoint, keys: { p256dh, auth } }
const subscribeHandler = async (req, res) => {
  if (!webPush.isEnabled()) {
    return fail(res, 503, "Push notifications aren't available right now.", "PUSH_DISABLED");
  }

  const { endpoint, keys } = req.body || {};
  if (!isValidEndpoint(endpoint) || !keys || !isB64Url(keys.p256dh, 200) || !isB64Url(keys.auth, 100)) {
    return fail(res, 400, "Invalid push subscription.", "INVALID_SUBSCRIPTION");
  }

  try {
    await repo.upsertSubscription({
      userId: req.user.id,
      endpoint,
      p256dh: keys.p256dh,
      auth: keys.auth,
      userAgent: String(req.headers["user-agent"] || "").slice(0, 300),
    });
    res.status(201).json({ subscribed: true });
  } catch (err) {
    logger.error(`[PUSH] subscribe failed: ${err.message}`);
    fail(res, 500, "Something went wrong. Please try again.", "UNKNOWN_ERROR");
  }
};

// POST /api/push/unsubscribe   body: { endpoint }
const unsubscribeHandler = async (req, res) => {
  const { endpoint } = req.body || {};
  if (!isValidEndpoint(endpoint)) {
    return fail(res, 400, "Invalid push subscription.", "INVALID_SUBSCRIPTION");
  }
  try {
    await repo.deleteByEndpoint({ userId: req.user.id, endpoint });
    res.json({ subscribed: false });
  } catch (err) {
    logger.error(`[PUSH] unsubscribe failed: ${err.message}`);
    fail(res, 500, "Something went wrong. Please try again.", "UNKNOWN_ERROR");
  }
};

module.exports = { publicKeyHandler, subscribeHandler, unsubscribeHandler };
