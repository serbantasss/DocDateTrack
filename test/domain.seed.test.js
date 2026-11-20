const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { promisify } = require('node:util');
const { after, before, beforeEach, describe, it } = require('node:test');
const mongoose = require('mongoose');

const Category = require('../models/category');
const Document = require('../models/document');
const DocumentInstance = require('../models/documentInstance');
const Owner = require('../models/owner');
const User = require('../models/user');
const { findDocumentsWithStatus, summarize } = require('../services/documents');
const { assertSeedableDatabase, formatSummary, seedDemoData } = require('../tasks/seed-demo-data');
const { createTestApp, createUser, loginAgent } = require('./helpers/app');
const { clearTestDb, getTestDbUri, startTestDb, stopTestDb } = require('./helpers/db');
const { makeTempDir, removeTempDir } = require('./helpers/tmp');

const runFile = promisify(execFile);
const SEEDER = path.join(__dirname, '..', 'tasks', 'seed-demo-data.js');
const DEMO_PASSWORD = 'LocalDemoOnly123!';
const NOW = new Date('2026-03-15T10:00:00Z');

let uploadDir;

async function countRecords() {
  const models = { users: User, owners: Owner, categories: Category, documents: Document };
  const counts = { versions: await DocumentInstance.countDocuments() };
  for (const [key, Model] of Object.entries(models)) counts[key] = await Model.countDocuments();
  return counts;
}

async function statusSummary(warningDays = 30) {
  return summarize(await findDocumentsWithStatus({ now: NOW, warningDays }));
}

before(startTestDb);
after(stopTestDb);
beforeEach(async () => {
  await clearTestDb();
  if (uploadDir) removeTempDir(uploadDir);
  uploadDir = makeTempDir('seed-');
});

describe('seeder safety rule', () => {
  it('only accepts database names ending in _dev or _demo unless forced', () => {
    for (const name of ['docdatetrack_dev', 'docdatetrack_demo', 'shop_dev']) {
      assert.doesNotThrow(() => assertSeedableDatabase(name), name);
    }
    for (const name of [
      'docdatetrack',
      'docdatetrack_test',
      'docdatetrack_dev_backup',
      'docdatetrack-dev',
      'docdatetrack_DEV',
      'dev',
      '',
      undefined,
    ]) {
      assert.throws(() => assertSeedableDatabase(name), /Refusing to seed the database/, name);
    }
    assert.doesNotThrow(() => assertSeedableDatabase('docdatetrack', { force: true }));
  });

  it('refuses to write to the test database without force', async () => {
    await assert.rejects(
      seedDemoData({ now: NOW, uploadDir }),
      /Refusing to seed the database "docdatetrack_test.*--force/,
    );
    assert.deepEqual(await countRecords(), {
      users: 0,
      owners: 0,
      categories: 0,
      documents: 0,
      versions: 0,
    });
    assert.deepEqual(fs.readdirSync(uploadDir), []);
  });
});

describe('seeding demo data', () => {
  it('creates accounts, owners, categories and documents of every status', async () => {
    const summary = await seedDemoData({ now: NOW, uploadDir, force: true });

    assert.deepEqual(summary.users, { created: ['demo', 'demo.member'], existing: [] });
    const demo = await User.findOne({ username: 'demo' });
    assert.equal(demo.role, 'admin');
    assert.equal(demo.email, 'demo@example.test');
    assert.equal(demo.display_name, 'Demo Admin');
    const member = await User.findOne({ username: 'demo.member' });
    assert.equal(member.role, 'member');
    assert.equal(member.email, 'member@example.test');

    const counts = await countRecords();
    assert.ok(counts.owners >= 5 && counts.categories >= 8, JSON.stringify(counts));
    assert.ok(counts.documents > counts.owners && counts.versions > 0, JSON.stringify(counts));
    for (const key of ['owners', 'categories', 'documents']) {
      assert.deepEqual(summary[key], { created: counts[key], existing: 0 }, key);
    }
    assert.equal(summary.versions.created, counts.versions);

    for (const owner of await Owner.find().lean()) {
      if (owner.email) assert.match(owner.email, /@example\.test$/);
    }
    assert.deepEqual((await Category.distinct('scope')).sort(), [
      'company',
      'employee',
      'personal',
    ]);

    const statuses = await statusSummary();
    for (const status of ['expired', 'expiring', 'valid', 'missing']) {
      assert.ok(statuses[status] > 0, `${status}: ${JSON.stringify(statuses)}`);
    }
    assert.equal(statuses.total, counts.documents);

    const renewed = (await findDocumentsWithStatus({ now: NOW })).filter(
      (row) => row.status === 'valid' && row.versionCount > 1,
    );
    assert.ok(renewed.length > 0, 'a document with an expired and a newer valid version');
    for (const row of renewed) {
      const versions = await DocumentInstance.find({ document: row.document._id }).lean();
      assert.ok(versions.some((version) => version.expires_at < NOW));
    }
    for (const version of await DocumentInstance.find().lean()) {
      assert.equal(version.expires_at.toISOString().slice(11), '00:00:00.000Z');
      assert.ok(version.issued_at <= version.expires_at && version.issued_at <= NOW);
    }

    assert.match(formatSummary(summary), /Accounts: +2 created \(demo, demo\.member\)/);
  });

  it('is idempotent', async () => {
    await seedDemoData({ now: NOW, uploadDir, force: true });
    const counts = await countRecords();
    const statuses = await statusSummary();
    const files = fs.readdirSync(uploadDir).sort();

    const second = await seedDemoData({ now: NOW, uploadDir, force: true });

    assert.deepEqual(await countRecords(), counts);
    assert.deepEqual(await statusSummary(), statuses);
    assert.deepEqual(fs.readdirSync(uploadDir).sort(), files);
    assert.deepEqual(second.users, { created: [], existing: ['demo', 'demo.member'] });
    assert.deepEqual(second.owners, { created: 0, existing: counts.owners });
    assert.deepEqual(second.categories, { created: 0, existing: counts.categories });
    assert.deepEqual(second.documents, { created: 0, existing: counts.documents });
    assert.deepEqual(second.versions, { created: 0, files: 0 });
  });

  it('only adds versions to demo documents that have none', async () => {
    await seedDemoData({ now: NOW, uploadDir, force: true });
    const document = await Document.findById((await DocumentInstance.findOne()).document);
    const { deletedCount } = await DocumentInstance.deleteMany({ document: document._id });
    await Owner.updateOne({ _id: document.owner }, { $set: { phone: '+1 555 0000' } });

    const summary = await seedDemoData({ now: NOW, uploadDir, force: true });

    assert.ok(deletedCount > 0);
    assert.equal(summary.versions.created, deletedCount);
    assert.equal(await DocumentInstance.countDocuments({ document: document._id }), deletedCount);
    assert.equal((await Owner.findById(document.owner)).phone, '+1 555 0000');
  });

  it('keeps every status when the warning period changes', async () => {
    for (const warningDays of [0, 365, 3650]) {
      await clearTestDb();
      await seedDemoData({ now: NOW, uploadDir, force: true, warningDays });
      const statuses = await statusSummary(warningDays);
      for (const status of ['expired', 'expiring', 'valid', 'missing']) {
        assert.ok(
          statuses[status] > 0,
          `${warningDays} days, ${status}: ${JSON.stringify(statuses)}`,
        );
      }
    }
  });

  it('writes the sample PDFs that the versions reference', async () => {
    const summary = await seedDemoData({
      now: NOW,
      uploadDir: path.join(uploadDir, 'new'),
      force: true,
    });
    const dir = path.join(uploadDir, 'new');
    const versions = await DocumentInstance.find({ file: { $exists: true } }).lean();

    assert.ok(versions.length > 0);
    assert.equal(summary.versions.files, versions.length);
    assert.deepEqual(
      fs.readdirSync(dir).sort(),
      versions.map((version) => version.file.stored_name).sort(),
    );
    for (const { file } of versions) {
      const content = fs.readFileSync(path.join(dir, file.stored_name));
      const text = content.toString('latin1');
      assert.match(file.stored_name, /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}\.pdf$/);
      assert.match(file.original_name, /^[a-z0-9-]+-\d{4}\.pdf$/);
      assert.equal(file.mime_type, 'application/pdf');
      assert.equal(file.size, content.length);
      assert.equal(text.slice(0, 8), '%PDF-1.4');
      assert.match(text, /\(Sample document \\227 DocDateTrack demo data\) Tj/);
      assert.match(text, /%%EOF\n$/);

      // The cross-reference table must point at the objects, or readers have to repair the file.
      const xrefOffset = Number(/startxref\n(\d+)\n/.exec(text)[1]);
      assert.equal(text.slice(xrefOffset, xrefOffset + 4), 'xref');
      const entries = text.slice(xrefOffset).match(/^\d{10} 00000 n $/gm);
      entries.forEach((entry, index) => {
        const offset = Number(entry.slice(0, 10));
        assert.equal(
          text.slice(offset, offset + `${index + 1} 0 obj`.length),
          `${index + 1} 0 obj`,
        );
      });
      const length = Number(/\/Length (\d+) >>\nstream\n/.exec(text)[1]);
      const streamStart = text.indexOf('stream\n') + 'stream\n'.length;
      assert.equal(text.slice(streamStart + length, streamStart + length + 10), '\nendstream');
    }
  });

  it('leaves existing accounts untouched', async () => {
    await createUser({ username: 'demo', email: 'someone@example.test', role: 'member' });
    const before = await User.findOne({ username: 'demo' }).select('+hash +salt').lean();

    const summary = await seedDemoData({ now: NOW, uploadDir, force: true });

    assert.deepEqual(summary.users, { created: ['demo.member'], existing: ['demo'] });
    const after = await User.findOne({ username: 'demo' }).select('+hash +salt').lean();
    assert.deepEqual(after, before);
  });

  it('lets the demo accounts sign in and browse the demo data', async () => {
    await seedDemoData({ uploadDir, force: true });
    const { app } = createTestApp();

    const admin = await loginAgent(app, { username: 'demo', password: DEMO_PASSWORD });
    const owners = await admin.get('/owners').expect(200);
    assert.match(owners.text, /Zoë-Ann O'Neil/);
    assert.match(owners.text, /\d+ expired/);
    const categories = await admin.get('/categories').expect(200);
    assert.match(categories.text, /Fire safety certificate/);

    const member = await loginAgent(app, {
      username: 'member@example.test',
      password: DEMO_PASSWORD,
    });
    await member.get('/owners').expect(200);
  });
});

describe('seeder command line', () => {
  const databases = [];

  function databaseUri(name) {
    try {
      const url = new URL(getTestDbUri());
      url.pathname = `/${name}`;
      databases.push(name);
      return url.toString();
    } catch {
      return null;
    }
  }

  async function runSeeder(uri, args = []) {
    try {
      const { stdout, stderr } = await runFile(process.execPath, [SEEDER, ...args], {
        env: { NODE_ENV: 'test', MONGODB_URI: uri, UPLOAD_DIR: uploadDir },
        timeout: 60_000,
      });
      return { code: 0, stdout, stderr };
    } catch (error) {
      if (typeof error.code !== 'number') throw error;
      return { code: error.code, stdout: error.stdout, stderr: error.stderr };
    }
  }

  function database(name) {
    return mongoose.connection.getClient().db(name);
  }

  after(async () => {
    for (const name of databases) await database(name).dropDatabase();
  });

  it('refuses other databases without writing anything', async (t) => {
    const uri = databaseUri('docdatetrack_cli_check');
    if (!uri) return t.skip('MONGODB_TEST_URI cannot be parsed as a URL');

    const result = await runSeeder(uri);

    assert.equal(result.code, 1);
    assert.match(result.stderr, /Refusing to seed the database "docdatetrack_cli_check"/);
    assert.deepEqual(await database('docdatetrack_cli_check').listCollections().toArray(), []);
    assert.deepEqual(fs.readdirSync(uploadDir), []);

    const unknown = await runSeeder(uri, ['--yes']);
    assert.equal(unknown.code, 1);
    assert.match(unknown.stderr, /Unknown argument\(s\): --yes/);
  });

  it('seeds _dev databases idempotently and others with --force', async (t) => {
    const uri = databaseUri('docdatetrack_cli_dev');
    if (!uri) return t.skip('MONGODB_TEST_URI cannot be parsed as a URL');

    const first = await runSeeder(uri);
    assert.equal(first.code, 0, first.stderr);
    assert.match(first.stdout, /Demo data in database "docdatetrack_cli_dev"/);
    assert.match(first.stdout, /Accounts: +2 created \(demo, demo\.member\)/);
    const db = database('docdatetrack_cli_dev');
    const owners = await db.collection('owners').countDocuments();
    const indexes = await db.collection('categories').indexes();
    assert.ok(indexes.some((index) => index.unique && index.key.name === 1));

    const second = await runSeeder(uri);
    assert.equal(second.code, 0, second.stderr);
    assert.match(second.stdout, /Owners: +0 created/);
    assert.match(second.stdout, /Versions: +0 created/);
    assert.equal(await db.collection('owners').countDocuments(), owners);

    const forced = await runSeeder(databaseUri('docdatetrack_cli_forced'), ['--force']);
    assert.equal(forced.code, 0, forced.stderr);
    assert.equal(
      await database('docdatetrack_cli_forced').collection('owners').countDocuments(),
      owners,
    );
  });
});
