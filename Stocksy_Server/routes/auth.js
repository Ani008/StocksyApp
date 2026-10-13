const express = require('express');
const router = express.Router();
const {
  signupUser,
  loginUser,
  verifyEmail,
  resendVerification,
  logoutUser,
  refreshSession,
} = require('../controllers/auth');
const { deleteAccountHandler } = require('../controllers/accountController');
const { authLimiter, otpLimiter } = require('../middleware/rateLimiter');
const { protect } = require('../middleware/auth');
const { cookieCsrfGuard } = require('../utils/authCookies');

router.post('/signup', authLimiter, signupUser);
router.post('/login', authLimiter, loginUser);
router.post('/verify-email', otpLimiter, verifyEmail);
router.post('/resend-verification', otpLimiter, resendVerification);
router.post('/refresh', cookieCsrfGuard, authLimiter, refreshSession);
router.post('/logout', cookieCsrfGuard, logoutUser);
router.delete('/account', protect, authLimiter, deleteAccountHandler);

module.exports = router;