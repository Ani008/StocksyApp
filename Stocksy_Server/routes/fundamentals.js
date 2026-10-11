const express = require('express');

const router = express.Router();

const {
  ingestFundamentals,
  getFundamentals,
} = require('../controllers/fundamentals');
const { requireInternalKey } = require('../middleware/internalAuth');

router.get('/:symbol',getFundamentals);

// Write path: only Stocksy's own fundamentals scheduler (backend_py) may call
// this, using the shared INTERNAL_API_KEY. It overwrites the fundamentals
// cache for every stock, so it must never be open to the public.
router.post('/', requireInternalKey, ingestFundamentals);


module.exports = router;
