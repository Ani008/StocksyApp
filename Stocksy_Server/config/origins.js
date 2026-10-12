// config/origins.js
//
// ONE place that decides which browser origins (the web app / PWA) may talk
// to this API. Used by the CORS middleware, the CSRF origin check and the
// WebSocket handshake, so they can never disagree.
//
//   CORS_ORIGINS=https://app.stocksy.online,https://stocksy.online
//
// These are the origins of the WEB APP (where the pages are served from) —
// NOT the API's own address. (The old commented-out CORS block listed
// https://api.stocksy.online, which is the API itself, so it would have
// blocked the real web app.)
//
// Non-browser clients (the native apps, curl, the Python workers) send no
// Origin header at all and are never affected by this list.
//
// In development (NODE_ENV !== "production") http://localhost and
// http://127.0.0.1 on any port are also allowed so `expo start --web` works.
// In production ONLY the list is allowed; an empty list means no browser
// origin is allowed (fails closed).

const DEV_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?$/i;

const normalize = (o) => String(o || "").trim().replace(/\/+$/, "").toLowerCase();

const isProduction = () => process.env.NODE_ENV === "production";

function getAllowedOrigins() {
  return String(process.env.CORS_ORIGINS || "")
    .split(",")
    .map(normalize)
    .filter(Boolean);
}

function isAllowedOrigin(origin) {
  if (!origin) return false;
  const o = normalize(origin);
  if (getAllowedOrigins().includes(o)) return true;
  return !isProduction() && DEV_ORIGIN.test(o);
}

module.exports = { getAllowedOrigins, isAllowedOrigin, isProduction };
