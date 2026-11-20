const fs = require('node:fs');
const path = require('node:path');

// Scratch space inside the project (ignored with node_modules) instead of the OS temp directory.
const BASE_DIR = path.join(__dirname, '..', '..', 'node_modules', '.cache', 'docdatetrack-tests');
const createdDirs = new Set();

/** Creates a unique, empty directory that is removed automatically when the process exits. */
function makeTempDir(prefix = 'tmp-') {
  fs.mkdirSync(BASE_DIR, { recursive: true });
  const dir = fs.mkdtempSync(path.join(BASE_DIR, prefix));
  createdDirs.add(dir);
  return dir;
}

function removeTempDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
  createdDirs.delete(dir);
}

process.on('exit', () => {
  for (const dir of createdDirs) fs.rmSync(dir, { recursive: true, force: true });
});

module.exports = { makeTempDir, removeTempDir };
