const Document = require('../models/document');
const DocumentInstance = require('../models/documentInstance');
// populate() below needs these models registered, also in scripts that never load them.
require('../models/category');
require('../models/owner');
const { STATUS_META, computeStatus, daysUntil } = require('./status');

/**
 * Loads documents (owner and category populated) together with their current version — the one
 * with the latest expiry date — and the computed status.
 */
async function findDocumentsWithStatus({ match = {}, now = new Date(), warningDays } = {}) {
  const documents = await Document.find(match).populate('owner').populate('category');
  if (documents.length === 0) return [];

  const versionStats = await DocumentInstance.aggregate([
    { $match: { document: { $in: documents.map((document) => document._id) } } },
    { $sort: { expires_at: -1, _id: -1 } },
    { $group: { _id: '$document', current: { $first: '$$ROOT' }, count: { $sum: 1 } } },
  ]);
  const statsByDocument = new Map(versionStats.map((stats) => [String(stats._id), stats]));

  return documents.map((document) => {
    const stats = statsByDocument.get(String(document._id));
    const currentVersion = stats ? DocumentInstance.hydrate(stats.current) : null;
    const expiresAt = currentVersion?.expires_at ?? null;
    return {
      document,
      currentVersion,
      versionCount: stats?.count ?? 0,
      status: computeStatus(expiresAt, { now, warningDays }),
      daysUntil: daysUntil(expiresAt, now),
    };
  });
}

function compareDays(a, b) {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a - b;
}

/** Most urgent first: by status (expired, expiring, missing, valid), then by days left. */
function sortByUrgency(rows) {
  return [...rows].sort(
    (a, b) =>
      STATUS_META[a.status].rank - STATUS_META[b.status].rank ||
      compareDays(a.daysUntil, b.daysUntil) ||
      a.document.title.localeCompare(b.document.title),
  );
}

function summarize(rows) {
  const summary = { expired: 0, expiring: 0, valid: 0, missing: 0, total: rows.length };
  for (const row of rows) summary[row.status] += 1;
  return summary;
}

module.exports = { findDocumentsWithStatus, sortByUrgency, summarize };
