const express = require('express');
const account = require('../controllers/accountController');
const { authLimiter } = require('../middleware/rateLimit');

const router = express.Router();

router.get('/', account.show);
router.post('/', account.updateProfile);
router.post('/password', authLimiter, account.changePassword);

module.exports = router;
