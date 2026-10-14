const repo = require("../repositories/watchlistRepository");
const INSTRUMENTS = require("../config/instruments");
const { ValidationError, NotFoundError, sendError } = require("../utils/errors");
const logger = require("../utils/logger");

const MAX_WATCHLISTS = 10;
const MAX_NAME_LENGTH = 30;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// A malformed id can never match a row — answer 404 instead of letting
// Postgres throw a cast error that would surface as a 500.
const assertListId = (id) => {
  if (!UUID_RE.test(String(id))) throw new NotFoundError("Watchlist not found");
};

// Trim, collapse inner whitespace, enforce 1–30 characters.
const cleanName = (raw) => {
  const name = String(raw ?? "").trim().replace(/\s+/g, " ");
  if (!name) throw new ValidationError("Give your watchlist a name");
  if (name.length > MAX_NAME_LENGTH) {
    throw new ValidationError(`Watchlist name can be at most ${MAX_NAME_LENGTH} characters`);
  }
  return name;
};

const assertInstrument = (key) => {
  if (typeof key !== "string" || !Object.prototype.hasOwnProperty.call(INSTRUMENTS, key)) {
    throw new ValidationError("Unknown stock");
  }
};

// Shape sent to the app. Symbol / name / sector come from the server's own
// instrument list, not from anything the client sent. An item whose instrument
// has since been removed from that list is dropped rather than shown broken.
const serialize = (list) => ({
  id: list.id,
  name: list.name,
  created_at: list.created_at,
  items: list.items
    .filter((i) => Object.prototype.hasOwnProperty.call(INSTRUMENTS, i.instrument_key))
    .map((i) => ({
      instrument_key: i.instrument_key,
      symbol: INSTRUMENTS[i.instrument_key].symbol,
      name: INSTRUMENTS[i.instrument_key].name,
      sector: INSTRUMENTS[i.instrument_key].sector,
      added_at: i.added_at,
    })),
});

// ── GET /api/watchlists ───────────────────────────────────────────────────────
async function listWatchlistsHandler(req, res) {
  try {
    const lists = await repo.getWatchlistsByUser(req.user.id);
    return res.json({ watchlists: lists.map(serialize) });
  } catch (err) {
    return sendError(res, err, logger);
  }
}

// ── POST /api/watchlists ──────────────────────────────────────────────────────
// Body: { name, instrument_key? } — instrument_key adds that stock to the new
// list straight away (the "create a new watchlist" flow on the stock page).
async function createWatchlistHandler(req, res) {
  try {
    const userId = req.user.id;
    const name = cleanName(req.body?.name);
    const instrumentKey = req.body?.instrument_key;

    if (instrumentKey !== undefined && instrumentKey !== null) {
      assertInstrument(instrumentKey);
    }

    if ((await repo.countWatchlists(userId)) >= MAX_WATCHLISTS) {
      throw new ValidationError(
        `You can have up to ${MAX_WATCHLISTS} watchlists. Delete one to make a new one.`,
      );
    }

    let created;
    try {
      created = await repo.createWatchlist({ userId, name });
    } catch (err) {
      if (repo.isUniqueViolation(err)) {
        throw new ValidationError(`You already have a watchlist called "${name}"`);
      }
      throw err;
    }

    if (instrumentKey) {
      await repo.addItem({ watchlistId: created.id, userId, instrumentKey });
    }

    const watchlist = await repo.getWatchlistById({ watchlistId: created.id, userId });
    return res.status(201).json({ message: "Watchlist created", watchlist: serialize(watchlist) });
  } catch (err) {
    return sendError(res, err, logger);
  }
}

// ── DELETE /api/watchlists/:id ────────────────────────────────────────────────
async function deleteWatchlistHandler(req, res) {
  try {
    assertListId(req.params.id);

    const deleted = await repo.deleteWatchlist({ watchlistId: req.params.id, userId: req.user.id });
    if (!deleted) throw new NotFoundError("Watchlist not found");

    return res.json({ message: "Watchlist deleted", id: deleted.id });
  } catch (err) {
    return sendError(res, err, logger);
  }
}

// ── POST /api/watchlists/:id/items ────────────────────────────────────────────
// Body: { instrument_key } — adding a stock that's already there is fine.
async function addItemHandler(req, res) {
  try {
    const userId = req.user.id;
    assertListId(req.params.id);
    assertInstrument(req.body?.instrument_key);

    const ok = await repo.addItem({
      watchlistId: req.params.id,
      userId,
      instrumentKey: req.body.instrument_key,
    });
    if (!ok) throw new NotFoundError("Watchlist not found");

    const watchlist = await repo.getWatchlistById({ watchlistId: req.params.id, userId });
    return res.json({ message: "Added to watchlist", watchlist: serialize(watchlist) });
  } catch (err) {
    return sendError(res, err, logger);
  }
}

// ── DELETE /api/watchlists/:id/items/:instrumentKey ───────────────────────────
// instrumentKey is URL-encoded by the client (keys contain "|" and spaces).
async function removeItemHandler(req, res) {
  try {
    const userId = req.user.id;
    assertListId(req.params.id);

    const ok = await repo.removeItem({
      watchlistId: req.params.id,
      userId,
      instrumentKey: req.params.instrumentKey,
    });
    if (!ok) throw new NotFoundError("Watchlist not found");

    const watchlist = await repo.getWatchlistById({ watchlistId: req.params.id, userId });
    return res.json({ message: "Removed from watchlist", watchlist: serialize(watchlist) });
  } catch (err) {
    return sendError(res, err, logger);
  }
}

module.exports = {
  listWatchlistsHandler,
  createWatchlistHandler,
  deleteWatchlistHandler,
  addItemHandler,
  removeItemHandler,
};
