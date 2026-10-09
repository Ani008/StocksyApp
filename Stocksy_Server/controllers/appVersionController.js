const { buildVersionResponse, VersionConfigError } = require('../services/appVersionService');
const logger = require('../utils/logger');

// GET /api/app/version — public, no secrets in the payload.
function getAppVersion(req, res) {
  try {
    const payload = buildVersionResponse();
    res.set('Cache-Control', 'public, max-age=60');
    return res.json(payload);
  } catch (err) {
    if (err instanceof VersionConfigError) {
      logger.error(`[APP_VERSION_MISCONFIGURED] ${err.message}`);
      res.set('Cache-Control', 'no-store');
      return res.status(503).json({
        message: 'Version information is temporarily unavailable.',
        code: 'APP_VERSION_UNAVAILABLE',
        severity: 'warning',
      });
    }
    logger.error(`[APP_VERSION_ERROR] ${err.message}`);
    res.set('Cache-Control', 'no-store');
    return res.status(500).json({
      message: 'Something went wrong. Please try again.',
      code: 'UNKNOWN_ERROR',
      severity: 'error',
    });
  }
}

module.exports = { getAppVersion };