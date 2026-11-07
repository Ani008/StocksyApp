const { pool } = require("../config/postgres");

// Every row of app_features (a handful). Read by featureService, which caches it.
const getAll = async () => {
  const { rows } = await pool.query(
    `SELECT feature_key, enabled, value FROM app_features`,
  );
  return rows;
};

module.exports = { getAll };
