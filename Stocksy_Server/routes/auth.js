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
const { usernameAvailableHandler } = require('../controllers/profileController');
const { authLimiter, otpLimiter, usernameCheckLimiter } = require('../middleware/rateLimiter');
const { protect } = require('../middleware/auth');
const { cookieCsrfGuard } = require('../utils/authCookies');

// GET /api/auth/username-available?username=  — public (the signup screen has no login yet)
router.get('/username-available', usernameCheckLimiter, usernameAvailableHandler);
router.post('/signup', authLimiter, signupUser);
router.post('/login', authLimiter, loginUser);
router.post('/verify-email', otpLimiter, verifyEmail);
router.post('/resend-verification', otpLimiter, resendVerification);
router.post('/refresh', cookieCsrfGuard, authLimiter, refreshSession);
router.post('/logout', cookieCsrfGuard, logoutUser);
router.delete('/account', protect, authLimiter, deleteAccountHandler);

module.exports = router;