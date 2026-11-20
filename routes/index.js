const express = require('express');

const categoriesRouter = require('./categories');
const dashboardRouter = require('./dashboard');
const documentsRouter = require('./documents');
const ownersRouter = require('./owners');
const versionsRouter = require('./versions');

const router = express.Router();

router.use('/', dashboardRouter);
router.use('/documents', documentsRouter);
router.use('/versions', versionsRouter);
router.use('/owners', ownersRouter);
router.use('/categories', categoriesRouter);

module.exports = router;
