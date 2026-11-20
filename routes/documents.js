const express = require('express');

const documents = require('../controllers/documentController');

const router = express.Router();

router.get('/', documents.index);
router.get('/new', documents.newForm);
router.post('/', documents.create);
router.get('/:id', documents.show);
router.get('/:id/edit', documents.edit);
router.put('/:id', documents.update);
router.delete('/:id', documents.destroy);

module.exports = router;
