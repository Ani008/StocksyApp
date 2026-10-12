const express = require('express');
const router = express.Router();
const { signupUser, loginUser } = require('../controllers/auth');
const { refresh, getSession, logout, logoutAll, wsTicket } = require('../controllers/session');
const { deleteAccountHandler } = require('../controllers/accountController');
const { authLimiter, sessionLimiter } = require('../middleware/rateLimiter');
const { protect } = require('../middleware/auth');

router.post('/signup', authLimiter, signupUser);
router.post('/login', authLimiter, loginUser);

// Session lifecycle (see controllers/session.js)
router.post('/refresh', sessionLimiter, refresh);
router.get('/session', sessionLimiter, protect, getSession);
router.post('/logout', sessionLimiter, logout);
router.post('/logout-all', sessionLimiter, protect, logoutAll);
router.post('/ws-ticket', sessionLimiter, protect, wsTicket);

router.delete('/account', protect, authLimiter, deleteAccountHandler);

module.exports = router;
