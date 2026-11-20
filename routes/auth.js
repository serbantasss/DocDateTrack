const express = require('express');
const auth = require('../controllers/authController');
const { authLimiter } = require('../middleware/rateLimit');

const router = express.Router();

router.get('/login', auth.showLogin);
router.post('/login', authLimiter, auth.login);
router.post('/logout', auth.logout);
router.get('/register', auth.showRegister);
router.post('/register', authLimiter, auth.register);

module.exports = router;
