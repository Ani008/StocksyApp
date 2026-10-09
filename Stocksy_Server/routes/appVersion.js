const express = require('express');
const router = express.Router();
const { getAppVersion } = require('../controllers/appVersionController');

router.get('/version', getAppVersion);

module.exports = router;