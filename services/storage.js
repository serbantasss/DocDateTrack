const fs = require('node:fs/promises');
const path = require('node:path');

/**
 * Absolute path of a stored upload, or null when `storedName` is not a bare file name. Stored names
 * come from the database and must never let a request reach outside the upload directory.
 */
function storedFilePath(uploadDir, storedName) {
  if (!uploadDir) throw new TypeError('uploadDir is required');
  if (typeof storedName !== 'string' || storedName === '' || storedName.startsWith('.')) {
    return null;
  }
  if (/[\\/\0]/.test(storedName) || storedName !== path.basename(storedName)) return null;
  return path.join(uploadDir, storedName);
}

/** Deletes a stored upload. Returns true if a file was deleted; a missing file is not an error. */
async function removeStoredFile(uploadDir, storedName) {
  const filePath = storedFilePath(uploadDir, storedName);
  if (!filePath) return false;
  try {
    await fs.unlink(filePath);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

module.exports = { storedFilePath, removeStoredFile };
