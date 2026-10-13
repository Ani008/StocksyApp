const express = require('express');
const router = express.Router();
const { signupUser, loginUser, logoutUser, refreshSession } = require('../controllers/auth');
const { deleteAccountHandler } = require('../controllers/accountController');
const { authLimiter } = require('../middleware/rateLimiter');
const { protect } = require('../middleware/auth');
const { cookieCsrfGuard } = require('../utils/authCookies');

router.post('/signup', authLimiter, signupUser);
router.post('/login', authLimiter, loginUser);
router.post('/refresh', cookieCsrfGuard, authLimiter, refreshSession);
router.post('/logout', cookieCsrfGuard, logoutUser);
router.delete('/account', protect, authLimiter, deleteAccountHandler);

module.exports = router;