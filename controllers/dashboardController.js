const Category = require('../models/category');
const DocumentInstance = require('../models/documentInstance');
const Owner = require('../models/owner');
const { findDocumentsWithStatus, sortByUrgency, summarize } = require('../services/documents');
const { STATUS, daysUntil } = require('../services/status');

const ATTENTION_LIMIT = 10;
const RECENT_VERSIONS_LIMIT = 5;

async function show(req, res) {
  const { expiryWarningDays: warningDays } = req.app.get('config');
  const now = new Date();
  const [rows, ownerCount, categoryCount, recentVersions] = await Promise.all([
    findDocumentsWithStatus({ now, warningDays }),
    Owner.countDocuments(),
    Category.countDocuments(),
    DocumentInstance.find()
      .sort({ createdAt: -1, _id: -1 })
      .limit(RECENT_VERSIONS_LIMIT)
      .populate({ path: 'document', populate: [{ path: 'owner' }, { path: 'category' }] }),
  ]);

  const summary = summarize(rows);
  const attention = sortByUrgency(
    rows.filter((row) => row.status === STATUS.EXPIRED || row.status === STATUS.EXPIRING),
  );
  const needsOnboarding = ownerCount === 0 || categoryCount === 0 || summary.total === 0;

  res.render('dashboard', {
    title: 'Dashboard',
    summary,
    attention: attention.slice(0, ATTENTION_LIMIT),
    attentionTotal: attention.length,
    recentVersions: recentVersions.map((version) => ({
      version,
      daysUntil: daysUntil(version.expires_at, now),
    })),
    onboarding: needsOnboarding
      ? { owners: ownerCount, categories: categoryCount, documents: summary.total }
      : null,
  });
}

module.exports = { show };
