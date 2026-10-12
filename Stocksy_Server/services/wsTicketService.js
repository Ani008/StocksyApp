// services/wsTicketService.js
//
// A browser WebSocket cannot send an Authorization header, and putting the
// real token in the URL leaks it into logs and the browser console. Instead
// the logged-in client asks POST /api/auth/ws-ticket for a random one-time
// ticket (valid 30 s, usable once) and connects with ?ticket=… .
// A leaked ticket is worthless seconds later.

const crypto = require("crypto");
const { client: redis } = require("../config/redis");

const TTL_SECONDS = 30;
const key = (t) => `wsticket:${t}`;

async function issueTicket(userId, sid) {
  const ticket = crypto.randomBytes(24).toString("base64url");
  await redis.set(key(ticket), JSON.stringify({ uid: String(userId), sid }), { EX: TTL_SECONDS });
  return { ticket, expiresIn: TTL_SECONDS };
}

// Returns { uid, sid } or null. GETDEL makes it single-use even if two
// connections race for the same ticket.
async function consumeTicket(ticket) {
  if (!ticket || typeof ticket !== "string" || ticket.length > 100) return null;
  try {
    const raw = await redis.getDel(key(ticket));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

module.exports = { issueTicket, consumeTicket, TTL_SECONDS };
