# Stocksy 
Full-stack real-time stock tracking app built with React Native (Expo), Node.js + Express, Redis, MongoDB, and Upstox WebSocket API.

---

## Project Structure

```
STOCKSY/
├── STOCKSY_MOBILE/     # React Native App (Expo)
├── STOCKSY_SERVER/     # Node.js + Express + WebSocket backend
└── backend_py/         # Python service — Upstox → Redis pipeline
```

---

## Prerequisites

Make sure you have these installed before starting:

| Tool | Version | Check |
|------|---------|-------|
| Node.js | 18+ | `node -v` |
| Python | 3.10+ | `python --version` |
| Expo Go | Latest | Install on your phone |
| npm | 9+ | `npm -v` |

> **Important:** Your phone and laptop must be on the **same WiFi network** for Expo to work.

---

## 1. Clone the Repository

```bash
git clone https://github.com/Ani008/stocksy.git
cd STOCKSY
```

---

## 2. Create ENV Files

You need **3 separate `.env` files** — one in each folder. Never commit these to Git.

### `backend_py/.env`
```env
REDIS_HOST=
REDIS_PORT=
REDIS_PASSWORD=
UPSTOX_ACCESS_TOKEN=     
INTERNAL_API_KEY=        # must be IDENTICAL to Stocksy_Server's INTERNAL_API_KEY
```

### `STOCKSY_SERVER/.env`
```env
PORT=5000
REDIS_HOST=
REDIS_PORT=
REDIS_PASSWORD=
MONGO_URI=               
JWT_SECRET=              
INTERNAL_API_KEY=        # shared secret for backend_py -> POST /api/fundamentals (24+ chars)
ADMIN_USER_IDS=          # comma-separated user ids allowed to see /api/revenue/*
NODE_ENV=production      # production: ONLY CORS_ORIGINS may use the API from a browser
CORS_ORIGINS=            # origins of the WEB APP, comma-separated, e.g. https://app.stocksy.online
# ── optional ──
COOKIE_DOMAIN=           # e.g. .stocksy.online if the web app and API are sibling subdomains
COOKIE_SAMESITE=lax      # lax (default) | strict | none (only if web app and API are on different sites)
ACCESS_TOKEN_TTL_SECONDS=900    # access token lifetime (default 15 min)
REFRESH_TOKEN_TTL_DAYS=30       # refresh token lifetime, renewed on each use
SESSION_ABSOLUTE_DAYS=90        # hard cap on a login session
WS_MAX_CONNECTIONS_PER_IP=10    # simultaneous WebSockets per client IP
WS_MAX_PAYLOAD_BYTES=1024       # largest message a client may send us
```

> **Sessions (web vs native).** The web app/PWA keeps its login in two HttpOnly cookies
> (nothing in localStorage). The native apps keep using `Authorization: Bearer`, now with a
> short-lived access token plus a refresh token. Run the new migration once:
> `psql -d <db> -f Stocksy_Server/migrations/013_auth_sessions.sql`.
> Everyone is signed out once when this ships (old 30-day tokens are no longer accepted).
>
> **`CORS_ORIGINS`** — list the origin(s) the *web app* is served from, not the API's own
> address. Empty in production = no browser origin is allowed. In development
> (`NODE_ENV` not `production`) `http://localhost:*` and `http://127.0.0.1:*` are allowed
> automatically, so `expo start --web` works without setting it.

> **`INTERNAL_API_KEY`** — the fundamentals scheduler (`backend_py/fundamentals.py`) sends
> this in an `X-Internal-Key` header. If it is missing or shorter than 24 characters the
> server rejects every `POST /api/fundamentals` (fails closed). Generate one with:
> `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
>
> **`ADMIN_USER_IDS`** — the revenue endpoints are admin only. Use the `id` (UUID) of your
> account from the `users` table, not your email. If this is empty, nobody can access
> `/api/revenue/*`.

### `STOCKSY_MOBILE/.env`
```env
API_BASE_URL=http://YOUR_PC_LAN_IP:5000/api     # e.g. http://192.168.1.42:5000/api
API_TIMEOUT=10000
APP_ENV=development
```

> **How to find your LAN IP:**
> - Windows: run `ipconfig` → look for **IPv4 Address**
> - Mac/Linux: run `ifconfig` → look for `inet` under `en0`
>
> ⚠️ Do NOT use `localhost` in the mobile `.env` — your phone is a separate device and cannot reach your laptop via localhost.

---

## 3. Install Dependencies

```bash
# Python service
cd backend_py
pip install websockets redis requests protobuf python-dotenv

# Node backend
cd ../STOCKSY_SERVER
npm install

# React Native app
cd ../STOCKSY_MOBILE
npm install
```

---

## 4. Run the Project

You need **3 terminals open simultaneously.**

### Terminal 1 — Python Market Data Service
```bash
cd backend_py
python websocket_client.py
```
✅ Expected output:
```
Connection established
Saved to Redis: NSE_INDEX|Nifty 50 → {'ltpc': {'ltp': 23892.4, ...}}
```

### Terminal 2 — Node.js Backend
```bash
cd STOCKSY_SERVER
node server.js
```
✅ Expected output:
```
Redis connected successfully!
Server running on port 5000
WebSocket enabled on port 5000
```

### Terminal 3 — React Native App
```bash
cd STOCKSY_MOBILE
npx expo start
```
Then open **Expo Go** on your phone and scan the QR code from the terminal.

---

## 5. Verify Everything is Working

Run this in a separate terminal to confirm the full pipeline is live:
```bash
cd STOCKSY_SERVER
node test_ws.js
```
✅ Expected output (updates every second):
```
Connected to Stocksy Server!
Received: { type: 'MARKET_DATA', timestamp: ..., data: { 'NSE_INDEX|Nifty 50': { ... } } }
```

---

## Common Errors & Fixes

| Error | Cause | Fix |
|-------|-------|-----|
| `getaddrinfo failed` | No internet or expired Upstox token | Check internet. Regenerate token in Upstox Developer Console. |
| `Found 0 instruments in Redis` | Python service not running | Start `python websocket_client.py` first |
| `Network Error` in app | Wrong LAN IP in mobile `.env` | Run `ipconfig`/`ifconfig`, update `API_BASE_URL` |
| `port 5000 already in use` | Previous server still running | Run `npx kill-port 5000` then restart |
| `Cannot find module` errors | Wrong working directory | Make sure you `cd` into the correct folder before running |
| App shows "Off" indicator | WebSocket not reachable from phone | Confirm phone and laptop are on the same WiFi |
| `Metro bundler stuck` | Stale cache | Run `npx expo start --clear` |

---

## Notes

- The Upstox access token **expires every 24 hours**. Regenerate it from the [Upstox Developer Console](https://developer.upstox.com) and update `backend_py/.env` before starting each session.
- Market data only flows during **NSE trading hours** (Mon–Fri, 9:15 AM – 3:30 PM IST). Outside hours, Redis will have no data and the app will show "Loading...".
- The Python service auto-reconnects if the Upstox connection drops. The Node server does not need a restart unless you change `.env`.
