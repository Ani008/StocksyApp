// config/competition.js
//
// The one competition we run right now. When Stocksy gets several events this
// becomes a table; until then the key below tags every entry.

const COMPETITION_KEY = "vu-2026";

// Division A to G. To add a division, add its letter here: the app reads the
// list from the server, so no app release is needed.
const DIVISION_LETTERS = ["A", "B", "C", "D", "E", "F", "G"];

const DIVISIONS = DIVISION_LETTERS.map((key) => ({ key, label: `Division ${key}` }));

// The switches in app_features.
const FLAGS = ["competition_visible", "competition_registration_open", "competition_enabled"];
const STARTS_AT_KEY = "competition_starts_at";

module.exports = { COMPETITION_KEY, DIVISION_LETTERS, DIVISIONS, FLAGS, STARTS_AT_KEY };
