const express = require('express');
const users = require('../controllers/userController');

// Mounted behind requireAdmin (app.js).
const router = express.Router();

router.get('/', users.list);
router.get('/new', users.showCreate);
router.post('/', users.create);
router.get('/:id/edit', users.showEdit);
router.put('/:id', users.update);
router.delete('/:id', users.remove);

module.exports = router;
