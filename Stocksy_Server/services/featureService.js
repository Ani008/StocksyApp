/**
 * services/featureService.js
 *
 * Remote feature switches, read from the app_features table.
 *
 * Postgres is the single source of truth: flip a row with SQL and the app and the
 * server both follow, with no release, rebuild or restart. To keep 200+ students
 * resuming the app from hammering the database, the table is cached in memory for
 * a few seconds (FEATURE_CACHE_SECONDS, default 10), and concurrent reads while the
 * cache is empty share ONE query.
 *
 * FAILS CLOSED: if the table cannot be read, every switch reads as OFF and `ok` is
 * false. A stale cache is never served past its lifetime, so a database outage can
 * never leave the competition "on" by accident.
 *
 * Built by a factory so tests can hand it a fake repository and a fake clock.
 */

const logger = require("../utils/logger");
const { FeatureUnavailableError } = require("../utils/errors");
const { FLAGS, STARTS_AT_KEY } = require("../config/competition");

const DEFAULT_TTL_MS = Math.max(0, Number(process.env.FEATURE_CACHE_SECONDS ?? 10)) * 1000;

const allOff = () => Object.fromEntries(FLAGS.map((f) => [f, false]));

// A valid date as an ISO string, or null (a missing or garbled value = no date).
const toIso = (value) => {
  if (!value) return null;
  const t = Date.parse(value);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
};

function build(rows) {
  const byKey = new Map(rows.map((r) => [r.feature_key, r]));
  const features = allOff();
  for (const flag of FLAGS) features[flag] = byKey.get(flag)?.enabled === true; // missing row = off
  const settings = { [STARTS_AT_KEY]: toIso(byKey.get(STARTS_AT_KEY)?.value) };
  return { ok: true, features, settings };
}

const failed = () => ({ ok: false, features: allOff(), settings: { [STARTS_AT_KEY]: null } });

function createFeatureService(repo, { ttlMs = DEFAULT_TTL_MS, now = () => Date.now() } = {}) {
  let cache = null; // { at, value }
  let inflight = null;

  /** { ok, features: {flag: bool}, settings: { competition_starts_at: ISO|null } } */
  async function getFeatures() {
    if (cache && now() - cache.at < ttlMs) return cache.value;
    if (inflight) return inflight;

    inflight = (async () => {
      try {
        const value = build(await repo.getAll());
        cache = { at: now(), value };
        return value;
      } catch (err) {
        logger.error(`[FEATURES] Could not read app_features, failing closed: ${err.message}`);
        cache = null;
        return failed();
      } finally {
        inflight = null;
      }
    })();
    return inflight;
  }

  /** Throws FeatureUnavailableError when the switches can't be read. */
  async function requireReadable() {
    const cfg = await getFeatures();
    if (!cfg.ok) throw new FeatureUnavailableError();
    return cfg;
  }

  function clearCache() {
    cache = null;
  }

  return { getFeatures, requireReadable, clearCache };
}

let _service = null;
const service = () => (_service ||= createFeatureService(require("../repositories/featureRepository")));

module.exports = {
  createFeatureService,
  getFeatures: (...a) => service().getFeatures(...a),
  requireReadable: (...a) => service().requireReadable(...a),
};
