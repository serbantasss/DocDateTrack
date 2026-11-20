const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { after, before, beforeEach, describe, it } = require('node:test');
const mongoose = require('mongoose');

const Category = require('../models/category');
const Document = require('../models/document');
const DocumentInstance = require('../models/documentInstance');
const Owner = require('../models/owner');
const User = require('../models/user');
const { formatSummary, migrateLegacyData } = require('../tasks/migrate-legacy-data');
const { clearTestDb, startTestDb, stopTestDb } = require('./helpers/db');
const { makeTempDir } = require('./helpers/tmp');

const { ObjectId } = mongoose.Types;
const LEGACY_PASSWORD = 'legacy-password-1';

function legacyCredentials(password) {
  const salt = crypto.randomBytes(32).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 25000, 512, 'sha256').toString('hex');
  return { hash, salt, attempts: 0, last: new Date('2023-06-01T10:00:00Z') };
}

const idFrom = (isoDate) => ObjectId.createFromTime(Date.parse(isoDate) / 1000);
const collection = (name) => mongoose.connection.collection(name);

async function insertLegacyData() {
  // Same shape as the indexes created by the 0.x app (passport-local-mongoose v8): not sparse.
  await collection('owners').createIndex({ username: 1 }, { unique: true });
  await collection('owners').createIndex({ email: 1 }, { unique: true });

  const ids = {
    alice: idFrom('2023-01-01'),
    bob: idFrom('2023-02-01'),
    carol: idFrom('2023-03-01'),
    dan: idFrom('2023-04-01'),
    passport: new ObjectId(),
    registration: new ObjectId(),
    medical: new ObjectId(),
    misc: new ObjectId(),
    alicePassport: new ObjectId(),
    bobMedical: new ObjectId(),
    danMisc: new ObjectId(),
    scan: new ObjectId(),
    renewed: new ObjectId(),
    unsafe: new ObjectId(),
    orphan: new ObjectId(),
  };

  await collection('owners').insertMany([
    {
      _id: ids.bob,
      username: 'bob',
      first_name: 'Bob',
      last_name: 'Sample',
      email: 'bob@example.test',
      ...legacyCredentials('bob-password-1'),
    },
    {
      _id: ids.alice,
      username: 'Alice.Admin',
      first_name: 'Alice',
      last_name: 'Example',
      email: 'Alice@Example.test',
      phone: '555-0100',
      ...legacyCredentials(LEGACY_PASSWORD),
    },
    {
      _id: ids.carol,
      username: 'Carol Șerban',
      first_name: 'Carol',
      last_name: 'Șerban',
      email: 'carol@example.test',
      ...legacyCredentials('carol-password'),
    },
    { _id: ids.dan, first_name: 'Dan', last_name: 'Demo', email: 'dan@example.test' },
  ]);
  await collection('categories').insertMany([
    { _id: ids.passport, name: 'Passport', relation: 'DP' },
    { _id: ids.registration, name: 'Company registration', relation: 'DF' },
    { _id: ids.medical, name: 'Medical certificate', relation: 'DPF' },
    { _id: ids.misc, name: 'Miscellaneous' },
  ]);
  await collection('documents').insertMany([
    { _id: ids.alicePassport, owner: ids.alice, category: ids.passport, status: 'Expired' },
    { _id: ids.bobMedical, owner: ids.bob, category: ids.medical, status: 'Updated' },
    { _id: ids.danMisc, owner: ids.dan, category: ids.misc },
  ]);
  await collection('documentinstances').insertMany([
    {
      _id: ids.scan,
      document: ids.alicePassport,
      expire_date_raw: new Date('2024-05-10T00:00:00Z'),
      update_date_raw: new Date('2019-05-10T00:00:00Z'),
      document_file: 'Passport-Alice_Example-1700000000000.pdf',
    },
    {
      _id: ids.renewed,
      document: ids.alicePassport,
      expire_date_raw: new Date('2030-01-01T15:30:00Z'),
      update_date_raw: new Date('2031-02-02T09:00:00Z'),
      document_file: 'renewed.png',
    },
    {
      _id: ids.unsafe,
      document: ids.bobMedical,
      expire_date_raw: new Date('2027-03-01T00:00:00Z'),
      document_file: '../../etc/passwd',
    },
    {
      _id: ids.orphan,
      document: new ObjectId(),
      expire_date_raw: new Date('2026-12-31T00:00:00Z'),
      document_file: 'orphan.pdf',
    },
  ]);
  return ids;
}

async function snapshot() {
  const result = {};
  const collections = await mongoose.connection.db.listCollections().toArray();
  for (const { name } of collections.sort((a, b) => a.name.localeCompare(b.name))) {
    result[name] = {
      documents: await collection(name).find().sort({ _id: 1 }).toArray(),
      indexes: (await collection(name).indexes()).map((index) => index.name).sort(),
    };
  }
  return result;
}

let uploadDir;

before(async () => {
  await startTestDb();
  uploadDir = makeTempDir('legacy-uploads-');
  fs.writeFileSync(path.join(uploadDir, 'Passport-Alice_Example-1700000000000.pdf'), '%PDF-1.4 x');
});
after(stopTestDb);
beforeEach(clearTestDb);

describe('migrate-legacy-data', () => {
  it('writes nothing in dry-run mode', async () => {
    await insertLegacyData();
    const before = await snapshot();
    const summary = await migrateLegacyData({ dryRun: true, uploadDir });
    assert.deepEqual(await snapshot(), before);

    assert.equal(summary.dryRun, true);
    assert.deepEqual(
      summary.users.created.map((user) => [user.username, user.role]),
      [
        ['alice.admin', 'admin'],
        ['bob', 'member'],
        ['carol.serban', 'member'],
      ],
    );
    assert.equal(summary.versions.converted, 4);
    assert.match(formatSummary(summary), /DRY RUN/);
  });

  it('converts legacy owners, categories, documents and versions', async () => {
    const ids = await insertLegacyData();
    const summary = await migrateLegacyData({ uploadDir });
    assert.deepEqual(summary.errors, []);

    const users = await User.find().sort({ username: 1 }).lean();
    assert.deepEqual(
      users.map((user) => [user.username, user.email, user.role, user.display_name]),
      [
        ['alice.admin', 'alice@example.test', 'admin', 'Alice Example'],
        ['bob', 'bob@example.test', 'member', 'Bob Sample'],
        ['carol.serban', 'carol@example.test', 'member', 'Carol Șerban'],
      ],
    );
    assert.equal(summary.users.created[2].renamedFrom, 'Carol Șerban');
    const authenticate = User.authenticate();
    assert.equal((await authenticate('alice.admin', LEGACY_PASSWORD)).user.username, 'alice.admin');
    assert.equal((await authenticate('ALICE@example.test', LEGACY_PASSWORD)).user.role, 'admin');
    assert.equal((await authenticate('alice.admin', 'wrong-password')).user, false);
    assert.ok((await authenticate('carol@example.test', 'carol-password')).user);

    const owners = await collection('owners').find().toArray();
    assert.equal(owners.length, 4);
    for (const owner of owners) {
      for (const field of ['username', 'hash', 'salt', 'attempts', 'last']) {
        assert.equal(field in owner, false, `${owner.first_name}.${field}`);
      }
    }
    assert.equal((await Owner.findById(ids.alice)).phone, '555-0100');
    assert.deepEqual(summary.owners.droppedIndexes, ['username_1', 'email_1']);
    const ownerIndexes = (await collection('owners').indexes()).map((index) => index.name);
    assert.equal(ownerIndexes.includes('username_1'), false);
    assert.equal(ownerIndexes.includes('email_1'), false);
    await Owner.create([
      { first_name: 'No', last_name: 'Email' },
      { first_name: 'Also', last_name: 'None' },
    ]);

    const categories = await collection('categories').find().sort({ name: 1 }).toArray();
    assert.deepEqual(
      categories.map((category) => [category.name, category.scope, 'relation' in category]),
      [
        ['Company registration', 'company', false],
        ['Medical certificate', 'employee', false],
        ['Miscellaneous', 'personal', false],
        ['Passport', 'personal', false],
      ],
    );
    assert.equal(await collection('documents').countDocuments({ status: { $exists: true } }), 0);

    const scan = await DocumentInstance.findById(ids.scan);
    assert.equal(scan.expires_at.toISOString(), '2024-05-10T00:00:00.000Z');
    assert.equal(scan.issued_at.toISOString(), '2019-05-10T00:00:00.000Z');
    assert.deepEqual(scan.file.toObject(), {
      stored_name: 'Passport-Alice_Example-1700000000000.pdf',
      original_name: 'Passport-Alice_Example-1700000000000.pdf',
      mime_type: 'application/pdf',
      size: 10,
    });
    await scan.validate();

    const renewed = await DocumentInstance.findById(ids.renewed);
    assert.equal(renewed.expires_at.toISOString(), '2030-01-01T00:00:00.000Z');
    assert.equal(renewed.issued_at, undefined);
    assert.equal(renewed.file.mime_type, 'image/png');
    assert.equal(renewed.file.size, undefined);

    const unsafe = await DocumentInstance.findById(ids.unsafe);
    assert.equal(unsafe.file, undefined);

    const raw = await collection('documentinstances').find().toArray();
    for (const version of raw) {
      for (const field of ['expire_date_raw', 'update_date_raw', 'document_file']) {
        assert.equal(field in version, false);
      }
    }

    assert.equal(summary.versions.filesLinked, 3);
    assert.deepEqual(
      summary.versions.missingFiles.map((file) => file.name),
      ['renewed.png', 'orphan.pdf'],
    );
    assert.deepEqual(summary.versions.unsafeFiles, [
      { id: String(ids.unsafe), name: '../../etc/passwd' },
    ]);
    assert.equal(summary.versions.issueDatesDropped, 1);
    assert.deepEqual(summary.versions.orphans, [String(ids.orphan)]);
    assert.equal(summary.documents.cleaned, 2);
    assert.equal(summary.categories.converted, 4);
    assert.equal(summary.owners.cleaned, 3);
    assert.match(formatSummary(summary), /3 created/);
    assert.match(
      formatSummary(summary),
      /2 files not found in UPLOAD_DIR, 1 issue date after expiry dropped, 1 orphan$/m,
    );

    const documents = await Document.find().populate('owner').populate('category');
    assert.equal(documents.length, 3);
    assert.ok(documents.every((document) => document.title.includes(' — ')));
    assert.equal(await Category.countDocuments({ scope: 'employee' }), 1);
  });

  it('is idempotent', async () => {
    await insertLegacyData();
    await migrateLegacyData({ uploadDir });
    const afterFirstRun = await snapshot();

    const summary = await migrateLegacyData({ uploadDir });
    assert.deepEqual(await snapshot(), afterFirstRun);
    assert.equal(summary.users.created.length, 0);
    assert.equal(summary.owners.cleaned, 0);
    assert.equal(summary.categories.converted, 0);
    assert.equal(summary.documents.cleaned, 0);
    assert.equal(summary.versions.converted, 0);
    assert.equal(summary.versions.orphans.length, 1);
  });

  it('keeps existing accounts and reports username conflicts', async () => {
    await User.register(
      new User({ username: 'bob', email: 'robert@example.test', role: 'admin' }),
      'existing-password',
    );
    await User.register(
      new User({ username: 'alice', email: 'alice@example.test' }),
      'existing-password',
    );
    await insertLegacyData();
    const summary = await migrateLegacyData({ uploadDir });

    assert.deepEqual(
      summary.users.created.map((user) => [user.username, user.role]),
      [['carol.serban', 'member']],
    );
    assert.deepEqual(
      summary.users.skipped.map((user) => user.username),
      ['Alice.Admin'],
    );
    assert.deepEqual(
      summary.users.conflicts.map((user) => user.username),
      ['bob'],
    );
    const bob = await collection('owners').findOne({ first_name: 'Bob' });
    assert.ok(bob.hash, 'conflicting accounts keep their legacy credentials');
    assert.equal(await User.countDocuments(), 3);
  });
});
