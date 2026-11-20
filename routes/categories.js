const express = require('express');
const categories = require('../controllers/categoryController');

const router = express.Router();

router.get('/', categories.list);
router.get('/new', categories.newForm);
router.post('/', categories.create);
router.get('/:id', categories.show);
router.get('/:id/edit', categories.editForm);
router.put('/:id', categories.update);
router.delete('/:id', categories.destroy);

module.exports = router;
