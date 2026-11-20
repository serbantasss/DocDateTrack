const express = require('express');

const versions = require('../controllers/versionController');
const { verifyCsrf } = require('../middleware/csrf');
const { uploadSingle } = require('../services/uploads');

const router = express.Router();

router.get('/', versions.index);
router.get('/new', versions.newForm);
// Multipart forms: the CSRF token can only be checked once multer has parsed the body.
router.post('/', uploadSingle('file'), verifyCsrf, versions.create);
router.get('/:id', versions.show);
router.get('/:id/edit', versions.edit);
router.put('/:id', uploadSingle('file'), verifyCsrf, versions.update);
router.get('/:id/download', versions.download);
router.delete('/:id', versions.destroy);

module.exports = router;
