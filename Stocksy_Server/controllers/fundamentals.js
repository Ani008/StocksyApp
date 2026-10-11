const { client: redis } = require("../config/redis");
const logger = require("../utils/logger");

const ingestFundamentals = async (req, res) => {
  try {
    const snapshot = req.body;

    // Reject anything that isn't the expected { stocks: { SYMBOL: {...} } }
    // shape — previously a bad body threw inside the handler (500) AFTER
    // it had already been written to Redis, replacing good data with junk.
    const stocks = snapshot && snapshot.stocks;
    if (
      !stocks ||
      typeof stocks !== "object" ||
      Array.isArray(stocks) ||
      Object.keys(stocks).length === 0
    ) {
      return res.status(400).json({
        message: "Invalid fundamentals snapshot.",
        code: "VALIDATION_ERROR",
        severity: "error",
      });
    }

    await redis.set("fundamentals:ALL", JSON.stringify(snapshot));

    console.log(`✅ Cached ${Object.keys(stocks).length} stocks`);
    res.json({
      success: true,
      stocks: Object.keys(stocks).length,
    });
  } catch (error) {
    logger.error(`[INGEST FUNDAMENTALS] ${error.message}`);
    res.status(500).json({
      message: "Something went wrong. Please try again.",
      code: "UNKNOWN_ERROR",
      severity: "error",
    });
  }
};

const getFundamentals = async (req, res) => {
    try {

        const { symbol } = req.params;

        const snapshot = await redis.get(
            "fundamentals:ALL"
        );

        if (!snapshot) {
            return res.status(404).json({
                message: "Fundamentals data isn't available right now",
                code: "FUNDAMENTALS_UNAVAILABLE",
                severity: "warning",
            });
        }

        const parsed = JSON.parse(snapshot);

        const stock =
            parsed.stocks[symbol];

        if (!stock) {
            return res.status(404).json({
                message: "Stock not found",
                code: "NOT_FOUND",
                severity: "error",
            });
        }

        return res.json(stock);

    } catch (err) {
        logger.error(`[GET FUNDAMENTALS] ${err.message}`);
        res.status(500).json({
            message: "Something went wrong. Please try again.",
            code: "UNKNOWN_ERROR",
            severity: "error",
        });
    }
};

module.exports = {
  ingestFundamentals,
  getFundamentals,
};