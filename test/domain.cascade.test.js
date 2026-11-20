const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { after, before, beforeEach, describe, it, mock } = require('node:test');
const mongoose = require('mongoose');

const Category = require('../models/category');
const Document = require('../models/document');
const DocumentInstance = require('../models/documentInstance');
const Owner = require('../models/owner');
const ReminderLog = require('../models/reminderLog');
const { deleteDocuments, deleteVersions } = require('../services/cascade');
const { removeStoredFile, storedFilePath } = require('../services/storage');
const { clearTestDb, startTestDb, stopTestDb } = require('./helpers/db');
const { makeTempDir, removeTempDir } = require('./helpers/tmp');

const day = (isoDate) => new Date(`${isoDate}T00:00:00Z`);

let uploadDir;

function storeFile(name) {
  fs.writeFileSync(path.join(uploadDir, name), '%PDF-1.4\n');
  return { stored_name: name, original_name: `${name}.pdf`, mime_type: 'application/pdf', size: 9 };
}

async function createFixtures() {
  const [ana, ben] = await Owner.create([
    { first_name: 'Ana', last_name: 'Pop' },
    { first_name: 'Ben', last_name: 'Ray' },
  ]);
  const [passport, permit] = await Category.create([{ name: 'Passport' }, { name: 'Permit' }]);
  const [anaPassport, anaPermit, benPassport] = await Document.create([
    { owner: ana, category: passport },
    { owner: ana, category: permit },
    { owner: ben, category: passport },
  ]);
  await DocumentInstance.create([
    { document: anaPassport, expires_at: day('2025-01-01'), file: storeFile('a1') },
    { document: anaPassport, expires_at: day('2030-01-01'), file: storeFile('a2') },
    { document: anaPermit, expires_at: day('2027-01-01') },
    { document: anaPermit, expires_at: day('2028-01-01'), file: storeFile('gone') },
    { document: benPassport, expires_at: day('2029-01-01'), file: storeFile('b1') },
  ]);
  fs.unlinkSync(path.join(uploadDir, 'gone'));
  return { ana, ben, anaPassport, benPassport };
}

before(startTestDb);
after(stopTestDb);
beforeEach(async () => {
  await clearTestDb();
  if (uploadDir) removeTempDir(uploadDir);
  uploadDir = makeTempDir('cascade-');
});

describe('storage', () => {
  it('only resolves bare file names inside the upload directory', () => {
    assert.equal(storedFilePath('/srv/uploads', 'abc.pdf'), path.join('/srv/uploads', 'abc.pdf'));
    for (const name of ['', '.', '..', '.env', '../secret', 'a/b', 'a\\b', 'a\0b', null, 42]) {
      assert.equal(storedFilePath('/srv/uploads', name), null, String(name));
    }
    assert.throws(() => storedFilePath('', 'abc.pdf'), TypeError);
  });

  it('removes stored files and ignores files that are already gone', async () => {
    storeFile('present');
    assert.equal(await removeStoredFile(uploadDir, 'present'), true);
    assert.equal(fs.existsSync(path.join(uploadDir, 'present')), false);
    assert.equal(await removeStoredFile(uploadDir, 'present'), false);
    assert.equal(await removeStoredFile(uploadDir, '../present'), false);
  });
});

describe('cascade deletes', () => {
  it('deletes the documents of an owner with their versions and files', async () => {
    const { ana, benPassport } = await createFixtures();

    const result = await deleteDocuments({ owner: ana._id }, { uploadDir });

    assert.deepEqual(result, { documents: 2, versions: 4, files: 2 });
    assert.deepEqual(
      (await Document.find().lean()).map((document) => String(document._id)),
      [String(benPassport._id)],
    );
    assert.equal(await DocumentInstance.countDocuments(), 1);
    assert.deepEqual(fs.readdirSync(uploadDir), ['b1']);
  });

  it('deletes only the matching versions', async () => {
    const { anaPassport } = await createFixtures();

    const result = await deleteVersions(
      { document: anaPassport._id, expires_at: { $lt: day('2026-01-01') } },
      { uploadDir },
    );

    assert.deepEqual(result, { versions: 1, files: 1 });
    assert.equal(await DocumentInstance.countDocuments({ document: anaPassport._id }), 1);
    assert.deepEqual(fs.readdirSync(uploadDir).sort(), ['a2', 'b1']);
  });

  it('removes the reminder log entries of deleted versions', async () => {
    const { anaPassport, benPassport } = await createFixtures();
    const logFor = (version) => ({
      recipient: 'admin@example.test',
      document: version.document,
      version: version._id,
      stage: 'expired',
      expires_at: version.expires_at,
    });
    const anaVersions = await DocumentInstance.find({ document: anaPassport._id });
    const benVersion = await DocumentInstance.findOne({ document: benPassport._id });
    await ReminderLog.create([...anaVersions.map(logFor), logFor(benVersion)]);

    await deleteDocuments({ _id: anaPassport._id }, { uploadDir });

    const remaining = await ReminderLog.find().lean();
    assert.deepEqual(
      remaining.map((log) => String(log.version)),
      [String(benVersion._id)],
    );
  });

  it('removes the file a concurrent edit put on a version that is being deleted', async () => {
    const { benPassport } = await createFixtures();
    const exec = mongoose.Query.prototype.exec;
    let edited = false;
    // Simulate an edit that replaces the file just before the version is deleted.
    mock.method(mongoose.Query.prototype, 'exec', async function (...args) {
      const deleting = this.op === 'findOneAndDelete' || this.op === 'deleteMany';
      if (!edited && deleting && this.model === DocumentInstance) {
        edited = true;
        await DocumentInstance.updateOne(
          { document: benPassport._id },
          { $set: { file: storeFile('b1-replacement') } },
        );
        await removeStoredFile(uploadDir, 'b1');
      }
      return exec.apply(this, args);
    });
    try {
      await deleteDocuments({ _id: benPassport._id }, { uploadDir });
    } finally {
      mock.restoreAll();
    }

    assert.equal(edited, true);
    assert.equal(fs.readdirSync(uploadDir).includes('b1-replacement'), false);
    assert.equal(await DocumentInstance.countDocuments({ document: benPassport._id }), 0);
  });

  it('also deletes versions saved while their documents were being deleted', async () => {
    const { anaPassport } = await createFixtures();
    const exec = mongoose.Query.prototype.exec;
    let added = false;
    mock.method(mongoose.Query.prototype, 'exec', async function (...args) {
      if (!added && this.op === 'deleteMany' && this.model === Document) {
        added = true;
        await DocumentInstance.create({
          document: anaPassport._id,
          expires_at: day('2032-01-01'),
          file: storeFile('late'),
        });
      }
      return exec.apply(this, args);
    });
    let result;
    try {
      result = await deleteDocuments({ _id: anaPassport._id }, { uploadDir });
    } finally {
      mock.restoreAll();
    }

    assert.equal(added, true);
    assert.deepEqual(result, { documents: 1, versions: 3, files: 3 });
    assert.equal(await DocumentInstance.countDocuments({ document: anaPassport._id }), 0);
    assert.equal(fs.readdirSync(uploadDir).includes('late'), false);
  });

  it('does nothing when nothing matches', async () => {
    await createFixtures();
    assert.deepEqual(await deleteDocuments({ notes: 'none' }, { uploadDir }), {
      documents: 0,
      versions: 0,
      files: 0,
    });
    assert.equal(await DocumentInstance.countDocuments(), 5);
  });

  it('requires the upload directory', async () => {
    await assert.rejects(deleteDocuments({}, {}), TypeError);
    await assert.rejects(deleteVersions({}, {}), TypeError);
  });
});
