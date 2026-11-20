const Document = require('../models/document');
const DocumentInstance = require('../models/documentInstance');
const ReminderLog = require('../models/reminderLog');
const { removeStoredFile } = require('./storage');

async function removeFiles(uploadDir, storedNames) {
  let removed = 0;
  for (const storedName of storedNames) {
    try {
      if (await removeStoredFile(uploadDir, storedName)) removed += 1;
    } catch (error) {
      // The records are already gone, so a file that cannot be deleted must not fail the request.
      console.warn(`Unable to delete uploaded file ${storedName}: ${error.message}`);
    }
  }
  return removed;
}

/**
 * Deletes the versions matching `filter` (with their reminder log entries), then their uploaded
 * files. Records go first: an interruption can leave an orphaned file behind, but never a version
 * pointing at a missing file. Each version is read in the same operation that deletes it, so a
 * file replaced by a concurrent edit is the one that gets removed.
 */
async function deleteVersions(filter, { uploadDir }) {
  if (!uploadDir) throw new TypeError('uploadDir is required');
  const versionIds = await DocumentInstance.find(filter).distinct('_id');
  if (versionIds.length === 0) return { versions: 0, files: 0 };
  const storedNames = [];
  let deleted = 0;
  for (const _id of versionIds) {
    const version = await DocumentInstance.findOneAndDelete({ _id })
      .select('file.stored_name')
      .lean();
    if (!version) continue;
    deleted += 1;
    if (version.file?.stored_name) storedNames.push(version.file.stored_name);
  }
  await ReminderLog.deleteMany({ version: { $in: versionIds } });
  return { versions: deleted, files: await removeFiles(uploadDir, storedNames) };
}

/** Deletes the documents matching `filter` together with all their versions and files. */
async function deleteDocuments(filter, { uploadDir }) {
  if (!uploadDir) throw new TypeError('uploadDir is required');
  const documentIds = await Document.find(filter).distinct('_id');
  if (documentIds.length === 0) return { documents: 0, versions: 0, files: 0 };
  const byDocument = { document: { $in: documentIds } };
  const first = await deleteVersions(byDocument, { uploadDir });
  const { deletedCount } = await Document.deleteMany({ _id: { $in: documentIds } });
  // A version saved while the documents were being deleted would otherwise be unreachable.
  const late = await deleteVersions(byDocument, { uploadDir });
  return {
    documents: deletedCount,
    versions: first.versions + late.versions,
    files: first.files + late.files,
  };
}

module.exports = { deleteVersions, deleteDocuments };
