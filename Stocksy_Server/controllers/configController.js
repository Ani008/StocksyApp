const features = require("../services/featureService");
const logger = require("../utils/logger");

// ── GET /api/config/features ─────────────────────────────────────────────────
// PUBLIC (no login): the app asks on launch and when it comes back to the
// foreground which features to show. Never cached by the phone or a proxy.
//
//   { success: true,
//     features: { competition_visible, competition_registration_open, competition_enabled },
//     settings: { competition_starts_at },   // ISO time, or null
//     serverTime }                           // lets the app correct a wrong phone clock
//
// When the switches can't be read it answers 503 (never a guess), so the app
// keeps what it last knew and holds competition actions back.
async function getFeaturesHandler(req, res) {
  res.set("Cache-Control", "no-store");
  try {
    const cfg = await features.getFeatures();
    if (!cfg.ok) {
      return res.status(503).json({
        success: false,
        message: "Settings are unavailable right now.",
        code: "CONFIG_UNAVAILABLE",
        severity: "error",
      });
    }
    return res.json({
      success: true,
      features: cfg.features,
      settings: cfg.settings,
      serverTime: new Date().toISOString(),
    });
  } catch (err) {
    logger.error(`[CONFIG] ${err.message}`);
    return res.status(503).json({
      success: false,
      message: "Settings are unavailable right now.",
      code: "CONFIG_UNAVAILABLE",
      severity: "error",
    });
  }
}

module.exports = { getFeaturesHandler };
