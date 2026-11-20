const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { after, afterEach, before, beforeEach, describe, it } = require('node:test');
const { promisify } = require('node:util');
const mongoose = require('mongoose');

const Category = require('../models/category');
const Document = require('../models/document');
const DocumentInstance = require('../models/documentInstance');
const Owner = require('../models/owner');
const {
  USAGE,
  UsageError,
  checkUploads,
  exitCodeFor,
  formatReport,
  main,
  parseCliArgs,
} = require('../tasks/check-uploads');
const { clearTestDb, getTestDbUri, startTestDb, stopTestDb } = require('./helpers/db');
const { makeTempDir, removeTempDir } = require('./helpers/tmp');

const execFileAsync = promisify(execFile);
const SCRIPT = path.join(__dirname, '..', 'tasks', 'check-uploads.js');
// main() returns before connecting to this database in every test that uses it.
const ENV = { NODE_ENV: 'test', MONGODB_URI: 'mongodb://127.0.0.1:9/unused' };
const TWO_HOURS_AGO = new Date(Date.now() - 2 * 60 * 60 * 1000);

function createOutput() {
  const entries = [];
  const record =
    (level) =>
    (...args) =>
      entries.push([level, args.map(String).join(' ')]);
  return {
    log: record('log'),
    error: record('error'),
    text: (level) =>
      entries
        .filter(([entry]) => entry === level)
        .map(([, text]) => text)
        .join('\n'),
  };
}

const appName = (extension) => `${crypto.randomUUID()}.${extension}`;

function writeFile(dir, name, { modifiedAt } = {}) {
  const filePath = path.join(dir, name);
  fs.writeFileSync(filePath, 'content');
  if (modifiedAt) fs.utimesSync(filePath, modifiedAt, modifiedAt);
}

async function createDocument() {
  const owner = await Owner.create({ first_name: 'Ana', last_name: 'Pop' });
  const category = await Category.create({ name: 'Passport' });
  return Document.create({ owner, category });
}

function versionWithFile(document, storedName, originalName = storedName) {
  return {
    document,
    expires_at: new Date('2030-01-01T00:00:00Z'),
    file: { stored_name: storedName, original_name: originalName, mime_type: 'application/pdf' },
  };
}

describe('parseCliArgs', () => {
  it('reads the options', () => {
    assert.deepEqual(parseCliArgs([]), { deleteOrphans: false });
    assert.deepEqual(parseCliArgs(['--delete-orphans']), { deleteOrphans: true });
    assert.deepEqual(parseCliArgs(['-h']), { help: true });
    assert.deepEqual(parseCliArgs(['--delete-orphans', '--help']), { help: true });
  });

  it('rejects unknown options and arguments', () => {
    for (const args of [['--bogus'], ['uploads'], ['--delete-orphans=yes']]) {
      assert.throws(() => parseCliArgs(args), UsageError, args.join(' '));
    }
  });
});

describe('main', () => {
  it('prints the help', async () => {
    const output = createOutput();
    assert.equal(await main(['--help'], { env: ENV, output }), 0);
    assert.equal(output.text('log'), USAGE);
  });

  it('exits with 2 for invalid arguments and settings', async () => {
    const usage = createOutput();
    assert.equal(await main(['--force'], { env: ENV, output: usage }), 2);
    assert.match(
      usage.text('error'),
      /^Unknown option '--force'.*\n\nUsage: npm run uploads:check/s,
    );

    const settings = createOutput();
    assert.equal(await main([], { env: { MONGODB_URI: 'localhost' }, output: settings }), 2);
    assert.match(settings.text('error'), /MONGODB_URI must start with mongodb:\/\//);
  });
});

describe('checking the upload directory', () => {
  let uploadDir;

  before(startTestDb);
  after(stopTestDb);
  beforeEach(async () => {
    await clearTestDb();
    uploadDir = makeTempDir('check-uploads-');
  });
  afterEach(() => removeTempDir(uploadDir));

  async function createFixtures() {
    const document = await createDocument();
    const names = {
      used: appName('pdf'),
      legacy: 'Passport-Ana_Pop-1700000000000.pdf',
      missing: appName('png'),
      oldOrphan: appName('jpg'),
      newOrphan: appName('webp'),
      foreign: 'holiday.jpg',
      unfinished: crypto.randomUUID(),
    };
    await DocumentInstance.create([
      versionWithFile(document, names.used),
      versionWithFile(document, names.legacy),
      versionWithFile(document, names.missing, 'passport-scan.png'),
      { document, expires_at: new Date('2031-01-01T00:00:00Z') },
    ]);
    writeFile(uploadDir, names.used, { modifiedAt: TWO_HOURS_AGO });
    writeFile(uploadDir, names.legacy, { modifiedAt: TWO_HOURS_AGO });
    writeFile(uploadDir, names.oldOrphan, { modifiedAt: TWO_HOURS_AGO });
    writeFile(uploadDir, names.newOrphan);
    writeFile(uploadDir, names.foreign, { modifiedAt: TWO_HOURS_AGO });
    writeFile(uploadDir, names.unfinished, { modifiedAt: TWO_HOURS_AGO });
    writeFile(uploadDir, '.gitkeep', { modifiedAt: TWO_HOURS_AGO });
    fs.mkdirSync(path.join(uploadDir, 'archive'));
    return names;
  }

  it('reports unused files and versions whose file is missing', async () => {
    const names = await createFixtures();
    const report = await checkUploads({ uploadDir });

    assert.equal(report.entries, 7);
    assert.equal(report.versions, 3);
    const statuses = Object.fromEntries(
      report.orphans.map((orphan) => [orphan.name, orphan.status]),
    );
    assert.deepEqual(statuses, {
      archive: 'other',
      [names.oldOrphan]: 'deletable',
      [names.newOrphan]: 'recent',
      [names.foreign]: 'foreign',
      [names.unfinished]: 'foreign',
    });
    assert.deepEqual(
      report.missing.map(({ storedName, originalName }) => ({ storedName, originalName })),
      [{ storedName: names.missing, originalName: 'passport-scan.png' }],
    );
    assert.equal(exitCodeFor(report), 1);
    assert.equal(fs.readdirSync(uploadDir).length, 8);

    const text = formatReport(report);
    assert.match(text, /^Checked .+: 7 entries, 3 versions with a file\./);
    assert.match(text, /Not used by any version \(5\):/);
    assert.match(
      text,
      new RegExp(
        `- ${names.oldOrphan} \\(7 B, modified .+ UTC\\): can be deleted with --delete-orphans`,
      ),
    );
    assert.match(text, /- holiday\.jpg .+: not named like a DocDateTrack upload/);
    assert.match(text, /- archive: not a regular file; left alone/);
    assert.match(text, /Versions whose file is missing \(1\):/);
    assert.match(text, new RegExp(`“passport-scan\\.png”, stored as ${names.missing}`));
  });

  it('deletes only old unused files that the app created', async () => {
    const names = await createFixtures();
    const report = await checkUploads({ uploadDir, deleteOrphans: true });

    const deleted = report.orphans.filter((orphan) => orphan.status === 'deleted');
    assert.deepEqual(
      deleted.map((orphan) => orphan.name),
      [names.oldOrphan],
    );
    assert.equal(fs.existsSync(path.join(uploadDir, names.oldOrphan)), false);
    for (const kept of [names.used, names.legacy, names.newOrphan, names.foreign, '.gitkeep']) {
      assert.ok(fs.existsSync(path.join(uploadDir, kept)), kept);
    }
    assert.match(formatReport(report), /Deleted 1 unused file\./);
    // The recent upload, the foreign files and the missing file still need attention.
    assert.equal(exitCodeFor(report), 1);
  });

  it('finds no problems when files and versions match', async () => {
    const document = await createDocument();
    const name = appName('pdf');
    await DocumentInstance.create(versionWithFile(document, name));
    writeFile(uploadDir, name);

    const report = await checkUploads({ uploadDir, deleteOrphans: true });
    assert.deepEqual(report.orphans, []);
    assert.deepEqual(report.missing, []);
    assert.equal(exitCodeFor(report), 0);
    assert.match(formatReport(report), /No problems found\.$/);
  });

  it('runs as a script', async () => {
    const document = await createDocument();
    const used = appName('pdf');
    const orphan = appName('pdf');
    await DocumentInstance.create(versionWithFile(document, used));
    writeFile(uploadDir, used);
    writeFile(uploadDir, orphan, { modifiedAt: TWO_HOURS_AGO });

    const uri = new URL(getTestDbUri());
    uri.pathname = `/${mongoose.connection.name}`;
    const env = { PATH: process.env.PATH, NODE_ENV: 'test', MONGODB_URI: uri.href };
    const run = (args, extraEnv = {}) =>
      execFileAsync(process.execPath, [SCRIPT, ...args], {
        env: { ...env, ...extraEnv },
        timeout: 30_000,
      }).then(
        ({ stdout, stderr }) => ({ code: 0, stdout, stderr }),
        (error) => ({ code: error.code, stdout: error.stdout, stderr: error.stderr }),
      );

    const check = await run([], { UPLOAD_DIR: uploadDir });
    assert.equal(check.code, 1);
    assert.match(check.stdout, new RegExp(`- ${orphan} .+: can be deleted with --delete-orphans`));

    const cleanup = await run(['--delete-orphans'], { UPLOAD_DIR: uploadDir });
    assert.equal(cleanup.code, 0);
    assert.equal(cleanup.stderr, '');
    assert.match(cleanup.stdout, new RegExp(`- ${orphan} \\(7 B, modified .+ UTC\\): deleted\n`));
    assert.match(cleanup.stdout, /\n\nDeleted 1 unused file\.\n$/);
    assert.deepEqual(fs.readdirSync(uploadDir), [used]);

    const missingDir = path.join(uploadDir, 'missing');
    const failed = await run([], { UPLOAD_DIR: missingDir });
    assert.equal(failed.code, 2);
    assert.match(failed.stderr, /^Unable to read UPLOAD_DIR .+missing: ENOENT/);
  });
});
