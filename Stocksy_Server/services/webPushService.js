/**
 * services/webPushService.js
 *
 * Browser / PWA push notifications (Web Push + VAPID).
 *
 * Off unless configured. Needs these env vars:
 *   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY   (generate: npx web-push generate-vapid-keys)
 *   VAPID_SUBJECT                          (mailto:you@domain or https://domain)
 * Kill switch: WEB_PUSH_ENABLED=false turns it off without removing the keys.
 *
 * Contract: sendToUser() NEVER throws and never blocks the caller for long.
 * A push is a convenience on top of the email / in-app event that already
 * exists — a push failure must never fail an order or an alert.
 */

const webpush = require("web-push");
const repo = require("../repositories/pushSubscriptionRepository");
const logger = require("../utils/logger");

let configured = null; // null = not tried yet

function isEnabled() {
  if (configured !== null) return configured;

  const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT, WEB_PUSH_ENABLED } = process.env;

  if (String(WEB_PUSH_ENABLED).toLowerCase() === "false") {
    configured = false;
    return configured;
  }
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY || !VAPID_SUBJECT) {
    logger.info("[PUSH] Web push disabled (VAPID_* env vars not set)");
    configured = false;
    return configured;
  }

  try {
    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
    configured = true;
    logger.info("[PUSH] Web push enabled");
  } catch (err) {
    logger.error(`[PUSH] Invalid VAPID configuration, push disabled: ${err.message}`);
    configured = false;
  }
  return configured;
}

function getPublicKey() {
  return isEnabled() ? process.env.VAPID_PUBLIC_KEY : null;
}

// Push services cap payloads at ~4KB; keep ours tiny and free of secrets.
function buildPayload({ title, body, url = "/", tag }) {
  return JSON.stringify({
    title: String(title || "Stocksy").slice(0, 80),
    body: String(body || "").slice(0, 160),
    url: typeof url === "string" && url.startsWith("/") && !url.startsWith("//") ? url : "/",
    tag: tag ? String(tag).slice(0, 64) : undefined,
  });
}

async function sendToUser(userId, message) {
  try {
    if (!isEnabled()) return { sent: 0, removed: 0 };

    const subs = await repo.listForUser(userId);
    if (!subs.length) return { sent: 0, removed: 0 };

    const payload = buildPayload(message);
    let sent = 0;
    let removed = 0;

    await Promise.all(
      subs.map(async (sub) => {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            payload,
            // urgency high: price alerts are time-sensitive. TTL 10 min: a price
            // alert delivered an hour later is misleading, so let it expire.
            { TTL: 600, urgency: "high", timeout: 8000 },
          );
          sent += 1;
          repo.markSuccess(sub.id).catch(() => {});
        } catch (err) {
          if (err && (err.statusCode === 404 || err.statusCode === 410)) {
            // Subscription is gone (uninstalled, permission revoked) — prune it.
            removed += 1;
            await repo.deleteById(sub.id).catch(() => {});
          } else {
            logger.warn(`[PUSH] send failed (${err && err.statusCode}): ${err && err.message}`);
          }
        }
      }),
    );

    return { sent, removed };
  } catch (err) {
    logger.error(`[PUSH] sendToUser failed: ${err.message}`);
    return { sent: 0, removed: 0 };
  }
}

// Fire-and-forget wrapper for call sites that must not await.
function notifyUser(userId, message) {
  sendToUser(userId, message).catch(() => {});
}

// Test hook.
function _reset() {
  configured = null;
}

module.exports = { isEnabled, getPublicKey, sendToUser, notifyUser, buildPayload, _reset };
