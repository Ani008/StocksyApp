/**
 * services/competitionService.js
 *
 * VU Trading Competition: registration (stage 3). A student picks a division and
 * the server saves it. The contest wallet, trading and scoring come in later
 * stages.
 *
 * The server decides everything. Hiding the card in the app does not close these
 * rules: every join is checked here on its own, even if someone calls the API by
 * hand. A join is allowed only when
 *   - the switches could be read (otherwise fail closed),
 *   - competition_visible AND competition_registration_open are ON,
 *   - the contest has not started yet (registration closes at competition_starts_at),
 *   - the division is one of the real divisions.
 *
 * One entry per student: the database's UNIQUE key is the final word, so a double
 * tap or a second device gives the same single entry, never two.
 *
 * Built by a factory so tests can hand it fake repositories and a fake clock.
 */

const { ValidationError, ConflictError, CompetitionClosedError } = require("../utils/errors");
const { STARTS_AT_KEY } = require("../config/competition");

function createCompetitionService({ repo, features, competitionKey, divisions, now = () => new Date() }) {
  const validKeys = new Set(divisions.map((d) => d.key));

  const normalizeDivision = (raw) => String(raw ?? "").trim().toUpperCase();

  // Is registration allowed right now? { open, startsAt }
  function registrationState(cfg) {
    const startsAt = cfg.settings[STARTS_AT_KEY]; // ISO or null
    const open =
      cfg.ok &&
      cfg.features.competition_visible === true &&
      cfg.features.competition_registration_open === true &&
      !!startsAt &&
      now().getTime() < Date.parse(startsAt); // no date set = closed (fail closed)
    return { open, startsAt };
  }

  /**
   * Everything the page needs in one call: the switches, the countdown target,
   * the divisions to pick from and this student's own entry (or null).
   * `serverTime` lets the app correct for a wrong phone clock.
   */
  async function getStatus(userId) {
    const cfg = await features.getFeatures();
    const entry = await repo.findEntry(userId, competitionKey); // reading your own entry is always fine
    const { open, startsAt } = registrationState(cfg);
    return {
      visible: cfg.ok && cfg.features.competition_visible === true,
      registrationOpen: open,
      startsAt,
      serverTime: now().toISOString(),
      divisions,
      entry,
    };
  }

  /** Save the student's division. Returns { entry, created }. */
  async function join(userId, rawDivision) {
    const division = normalizeDivision(rawDivision);
    if (!validKeys.has(division)) throw new ValidationError("Please select your division.");

    const cfg = await features.requireReadable(); // throws when the switches can't be read

    const { open, startsAt } = registrationState(cfg);
    if (!open) {
      const started = startsAt && now().getTime() >= Date.parse(startsAt);
      throw new CompetitionClosedError(
        started
          ? "Registration has closed because the contest has started."
          : "Registration is not open right now.",
        "REGISTRATION_CLOSED",
      );
    }

    const inserted = await repo.insertEntry(userId, competitionKey, division);
    if (inserted) return { entry: inserted, created: true };

    // They already have an entry (double tap, second device, a race).
    const existing = await repo.findEntry(userId, competitionKey);
    if (existing && existing.division === division) return { entry: existing, created: false };
    throw new ConflictError(
      existing ? `You have already joined Division ${existing.division}.` : "You have already joined.",
      "ALREADY_JOINED",
    );
  }

  return { getStatus, join };
}

let _service = null;
const service = () =>
  (_service ||= createCompetitionService({
    repo: require("../repositories/competitionRepository"),
    features: require("./featureService"),
    ...(({ COMPETITION_KEY, DIVISIONS }) => ({ competitionKey: COMPETITION_KEY, divisions: DIVISIONS }))(
      require("../config/competition"),
    ),
  }));

module.exports = {
  createCompetitionService,
  getStatus: (...a) => service().getStatus(...a),
  join: (...a) => service().join(...a),
};
