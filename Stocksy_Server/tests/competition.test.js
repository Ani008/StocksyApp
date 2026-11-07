// VU Trading Competition (stage 3): the feature switches and registration.
// No database, no real clock: the repositories are in-memory stand-ins.
const test = require('node:test');
const assert = require('node:assert/strict');

const { createFeatureService } = require('../services/featureService');
const { createCompetitionService } = require('../services/competitionService');
const { DIVISIONS } = require('../config/competition');
const { mapErrorToResponse } = require('../utils/errors');

const STARTS = '2026-11-18T12:00:00+05:30';
const ist = (d, hhmm = '12:00') => new Date(`${d}T${hhmm}:00+05:30`);

// A fake app_features table.
const rows = (over = {}) => {
  const base = {
    competition_visible: false,
    competition_registration_open: false,
    competition_enabled: false,
  };
  const flags = { ...base, ...over };
  return [
    ...Object.entries(flags).map(([feature_key, enabled]) => ({ feature_key, enabled, value: null })),
    { feature_key: 'competition_starts_at', enabled: true, value: STARTS },
  ];
};

function fakeFeatureRepo(initial) {
  const repo = {
    data: initial,
    fail: false,
    calls: 0,
    async getAll() {
      repo.calls += 1;
      if (repo.fail) throw new Error('connection refused');
      return repo.data;
    },
  };
  return repo;
}

function fakeEntryRepo() {
  const entries = new Map(); // userId -> { division, joinedAt }
  return {
    entries,
    async findEntry(userId) { return entries.get(userId) || null; },
    async insertEntry(userId, _key, division) {
      if (entries.has(userId)) return null; // the UNIQUE key
      const e = { division, joinedAt: new Date().toISOString() };
      entries.set(userId, e);
      return e;
    },
  };
}

function setup({ flags = {}, at = ist('2026-11-16', '10:00'), ttlMs = 0 } = {}) {
  const featureRepo = fakeFeatureRepo(rows(flags));
  const clock = { t: at };
  const features = createFeatureService(featureRepo, { ttlMs, now: () => clock.t.getTime() });
  const repo = fakeEntryRepo();
  const service = createCompetitionService({
    repo, features, competitionKey: 'vu-2026', divisions: DIVISIONS, now: () => clock.t,
  });
  return { featureRepo, features, repo, service, clock };
}

const OPEN = { competition_visible: true, competition_registration_open: true };

// ── feature switches ────────────────────────────────────────────────────────
test('all switches start OFF, and a missing row also reads as OFF', async () => {
  const { features, featureRepo } = setup();
  const cfg = await features.getFeatures();
  assert.equal(cfg.ok, true);
  assert.deepEqual(cfg.features, {
    competition_visible: false,
    competition_registration_open: false,
    competition_enabled: false,
  });
  featureRepo.data = []; // table emptied
  features.clearCache();
  const empty = await features.getFeatures();
  assert.equal(empty.features.competition_visible, false);
  assert.equal(empty.settings.competition_starts_at, null);
});

test('a switch flipped in the database is seen without a restart (cache expires)', async () => {
  const { features, featureRepo, clock } = setup({ ttlMs: 10_000 });
  assert.equal((await features.getFeatures()).features.competition_visible, false);
  featureRepo.data = rows({ competition_visible: true });
  assert.equal((await features.getFeatures()).features.competition_visible, false); // still cached
  clock.t = new Date(clock.t.getTime() + 11_000);
  assert.equal((await features.getFeatures()).features.competition_visible, true); // refreshed
});

test('the cache stops many callers hammering the database', async () => {
  const { features, featureRepo } = setup({ ttlMs: 10_000 });
  await Promise.all(Array.from({ length: 50 }, () => features.getFeatures()));
  await features.getFeatures();
  assert.equal(featureRepo.calls, 1);
});

test('FAIL CLOSED: if the database is down every switch is OFF, even after it was ON', async () => {
  const { features, featureRepo, clock } = setup({ flags: OPEN, ttlMs: 10_000 });
  assert.equal((await features.getFeatures()).features.competition_visible, true);
  featureRepo.fail = true;
  clock.t = new Date(clock.t.getTime() + 11_000); // cache expired: no stale "ON" is served
  const cfg = await features.getFeatures();
  assert.equal(cfg.ok, false);
  assert.equal(cfg.features.competition_visible, false);
  assert.equal(cfg.features.competition_registration_open, false);
  await assert.rejects(() => features.requireReadable(), { name: 'FeatureUnavailableError' });
});

test('a garbled start date reads as no date', async () => {
  const { features, featureRepo } = setup();
  featureRepo.data = [{ feature_key: 'competition_starts_at', enabled: true, value: 'not a date' }];
  assert.equal((await features.getFeatures()).settings.competition_starts_at, null);
});

// ── joining ─────────────────────────────────────────────────────────────────
test('a student joins and the division is saved', async () => {
  const { service, repo } = setup({ flags: OPEN });
  const r = await service.join('u1', 'c');
  assert.equal(r.created, true);
  assert.equal(r.entry.division, 'C'); // trimmed + upper-cased
  assert.equal(repo.entries.get('u1').division, 'C');
});

test('a double tap or a second device gives one entry, not two', async () => {
  const { service, repo } = setup({ flags: OPEN });
  const results = await Promise.all([service.join('u1', 'B'), service.join('u1', 'B')]);
  assert.equal(repo.entries.size, 1);
  assert.deepEqual(results.map((r) => r.entry.division), ['B', 'B']);
  assert.equal(results.filter((r) => r.created).length, 1);
});

test('joining again with a DIFFERENT division is refused and keeps the first', async () => {
  const { service, repo } = setup({ flags: OPEN });
  await service.join('u1', 'B');
  await assert.rejects(() => service.join('u1', 'D'), (e) => {
    assert.equal(e.name, 'ConflictError');
    assert.equal(e.code, 'ALREADY_JOINED');
    assert.match(e.message, /Division B/);
    return true;
  });
  assert.equal(repo.entries.get('u1').division, 'B');
});

test('only real divisions are accepted (A to G)', async () => {
  const { service, repo } = setup({ flags: OPEN });
  for (const bad of ['', 'Z', 'H', 'AA', '1', null, undefined, '<script>']) {
    await assert.rejects(() => service.join('u1', bad), { name: 'ValidationError' });
  }
  for (const good of 'ABCDEFG') await service.join(`u-${good}`, good);
  assert.equal(repo.entries.size, 7);
});

test('NOT allowed while the competition is hidden or registration is closed', async () => {
  for (const flags of [
    {},
    { competition_visible: true },
    { competition_registration_open: true },
    { competition_enabled: true }, // trading switch alone does not open registration
  ]) {
    const { service, repo } = setup({ flags });
    await assert.rejects(() => service.join('u1', 'A'), { name: 'CompetitionClosedError', code: 'REGISTRATION_CLOSED' });
    assert.equal(repo.entries.size, 0);
  }
});

test('registration closes the moment the contest starts: no late joiners', async () => {
  const { service, clock } = setup({ flags: OPEN, at: ist('2026-11-18', '11:59') });
  await service.join('u1', 'A'); // one minute before
  clock.t = ist('2026-11-18', '12:00');
  await assert.rejects(() => service.join('u2', 'A'), { code: 'REGISTRATION_CLOSED' });
});

test('no start date set = closed (fail closed)', async () => {
  const { service, featureRepo, features } = setup({ flags: OPEN });
  featureRepo.data = featureRepo.data.filter((r) => r.feature_key !== 'competition_starts_at');
  features.clearCache();
  await assert.rejects(() => service.join('u1', 'A'), { code: 'REGISTRATION_CLOSED' });
});

test('FAIL CLOSED: a database outage blocks joining and creates nothing', async () => {
  const { service, featureRepo, repo } = setup({ flags: OPEN });
  featureRepo.fail = true;
  await assert.rejects(() => service.join('u1', 'A'), { name: 'FeatureUnavailableError' });
  assert.equal(repo.entries.size, 0);
});

test('an extended start date (changed in the database) keeps registration open', async () => {
  const { service, featureRepo, features, clock } = setup({ flags: OPEN, at: ist('2026-11-18', '13:00') });
  await assert.rejects(() => service.join('u1', 'A'), { code: 'REGISTRATION_CLOSED' });
  featureRepo.data = rows(OPEN).map((r) => (r.feature_key === 'competition_starts_at' ? { ...r, value: '2026-11-19T12:00:00+05:30' } : r));
  features.clearCache();
  assert.equal((await service.join('u1', 'A')).created, true);
});

// ── status for the page ─────────────────────────────────────────────────────
test('status shows the divisions, the countdown target and my entry', async () => {
  const { service } = setup({ flags: OPEN });
  let st = await service.getStatus('u1');
  assert.equal(st.visible, true);
  assert.equal(st.registrationOpen, true);
  assert.equal(st.entry, null);
  assert.equal(st.startsAt, '2026-11-18T06:30:00.000Z'); // 12:00 IST
  assert.deepEqual(st.divisions.map((d) => d.key), ['A', 'B', 'C', 'D', 'E', 'F', 'G']);
  assert.ok(st.serverTime);
  await service.join('u1', 'E');
  st = await service.getStatus('u1');
  assert.equal(st.entry.division, 'E');
});

test('I can still see my own entry after registration closes or the card is hidden', async () => {
  const { service, featureRepo, features } = setup({ flags: OPEN });
  await service.join('u1', 'F');
  featureRepo.data = rows({}); // everything switched off
  features.clearCache();
  const st = await service.getStatus('u1');
  assert.equal(st.visible, false);
  assert.equal(st.registrationOpen, false);
  assert.equal(st.entry.division, 'F'); // history is never hidden
});

test("status never shows someone else's entry", async () => {
  const { service } = setup({ flags: OPEN });
  await service.join('u1', 'A');
  assert.equal((await service.getStatus('u2')).entry, null);
});

// ── error mapping ───────────────────────────────────────────────────────────
test('errors map to the standard API contract', () => {
  const closed = mapErrorToResponse(new (require('../utils/errors').CompetitionClosedError)('x', 'REGISTRATION_CLOSED'));
  assert.equal(closed.status, 403);
  assert.equal(closed.body.code, 'REGISTRATION_CLOSED');
  const down = mapErrorToResponse(new (require('../utils/errors').FeatureUnavailableError)());
  assert.equal(down.status, 503);
  assert.equal(down.body.code, 'FEATURE_UNAVAILABLE');
});
