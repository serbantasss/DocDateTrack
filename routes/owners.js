const express = require('express');
const owners = require('../controllers/ownerController');

const router = express.Router();

router.get('/', owners.list);
router.get('/new', owners.newForm);
router.post('/', owners.create);
router.get('/:id', owners.show);
router.get('/:id/edit', owners.editForm);
router.put('/:id', owners.update);
router.delete('/:id', owners.destroy);

module.exports = router;
