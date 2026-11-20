const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const path = require('node:path');
const { after, before, beforeEach, describe, it } = require('node:test');
const { promisify } = require('node:util');
const mongoose = require('mongoose');

const Category = require('../models/category');
const Document = require('../models/document');
const DocumentInstance = require('../models/documentInstance');
const Owner = require('../models/owner');
const ReminderLog = require('../models/reminderLog');
const { createMailer } = require('../services/mailer');
const { todayUtc } = require('../services/status');
const { USAGE, UsageError, main, parseCliArgs, runReminders } = require('../tasks/send-reminders');
const { createTestConfig, createUser } = require('./helpers/app');
const { clearTestDb, getTestDbUri, startTestDb, stopTestDb } = require('./helpers/db');

const execFileAsync = promisify(execFile);
const SCRIPT = path.join(__dirname, '..', 'tasks', 'send-reminders.js');
const DAY_MS = 24 * 60 * 60 * 1000;
// main() returns before connecting to this database in every test that uses it.
const ENV = { NODE_ENV: 'test', MONGODB_URI: 'mongodb://127.0.0.1:9/unused' };

function createStubTransport({ failFor = [] } = {}) {
  const messages = [];
  return {
    name: 'stub',
    version: '1.0.0',
    messages,
    send(mail, callback) {
      const envelope = mail.message.getEnvelope();
      if (envelope.to.some((address) => failFor.includes(address))) {
        callback(new Error('Mailbox unavailable'));
        return;
      }
      messages.push({ ...mail.data, envelope });
      callback(null, { envelope, messageId: `<${messages.length}@example.test>` });
    },
  };
}

function createOutput() {
  const entries = [];
  const record =
    (level) =>
    (...args) =>
      entries.push([level, args.map(String).join(' ')]);
  return {
    log: record('log'),
    info: record('info'),
    warn: record('warn'),
    error: record('error'),
    text: (level) =>
      entries
        .filter(([entry]) => entry === level)
        .map(([, text]) => text)
        .join('\n'),
  };
}

async function createFixtures() {
  await createUser({
    username: 'alex',
    email: 'alex@example.test',
    role: 'admin',
    display_name: 'Alex Admin',
  });
  const [ana, ben] = await Owner.create([
    { first_name: 'Ana', last_name: 'Pop', email: 'ana@example.test' },
    { first_name: 'Ben', last_name: 'Ray' },
  ]);
  const [passport, insurance] = await Category.create([
    { name: 'Passport' },
    { name: 'Insurance' },
  ]);
  const [anaPassport, benInsurance, benPassport] = await Document.create([
    { owner: ana, category: passport },
    { owner: ben, category: insurance },
    { owner: ben, category: passport },
  ]);
  const fromToday = (days) => new Date(todayUtc().getTime() + days * DAY_MS);
  await DocumentInstance.create([
    { document: anaPassport, expires_at: fromToday(-3) },
    { document: benInsurance, expires_at: fromToday(10) },
    { document: benPassport, expires_at: fromToday(800) },
  ]);
}

describe('parseCliArgs', () => {
  it('reads the command and its options', () => {
    assert.deepEqual(parseCliArgs([]), { command: 'send' });
    assert.deepEqual(parseCliArgs(['--dry-run']), { command: 'dry-run' });
    assert.deepEqual(parseCliArgs(['--test', ' ops@example.test ']), {
      command: 'test',
      to: 'ops@example.test',
    });
    assert.deepEqual(parseCliArgs(['--test=ops@example.test']), {
      command: 'test',
      to: 'ops@example.test',
    });
    assert.deepEqual(parseCliArgs(['-h']), { command: 'help' });
    assert.deepEqual(parseCliArgs(['--dry-run', '--help']), { command: 'help' });
  });

  it('rejects invalid arguments', () => {
    const cases = [
      [['--force'], /Unknown option '--force'/],
      [['now'], /Unexpected argument 'now'/],
      [['--test'], /'--test <value>' argument missing/],
      [['--test', 'ops'], /--test needs an email address, got "ops"/],
      [['--dry-run', '--test', 'ops@example.test'], /either --dry-run or --test, not both/],
    ];
    for (const [args, message] of cases) {
      assert.throws(
        () => parseCliArgs(args),
        (error) => error instanceof UsageError && message.test(error.message),
        args.join(' '),
      );
    }
  });
});

describe('main', () => {
  it('prints the help', async () => {
    const output = createOutput();
    assert.equal(await main(['--help'], { env: ENV, output }), 0);
    assert.equal(output.text('log'), USAGE);
  });

  it('prints the problem and the usage for invalid arguments', async () => {
    const output = createOutput();
    assert.equal(await main(['--force'], { env: ENV, output }), 1);
    assert.match(output.text('error'), /^Unknown option '--force'/);
    assert.ok(output.text('error').endsWith(USAGE));
  });

  it('reports configuration problems', async () => {
    const output = createOutput();
    assert.equal(await main(['--dry-run'], { env: { MONGODB_URI: 'localhost' }, output }), 1);
    assert.match(output.text('error'), /MONGODB_URI must start with mongodb:\/\//);
  });

  it('needs SMTP settings to send reminders or a test email', async () => {
    for (const args of [[], ['--test', 'ops@example.test']]) {
      const output = createOutput();
      assert.equal(await main(args, { env: ENV, output }), 1);
      assert.match(output.text('error'), /^Email is not configured\./);
    }
  });

  it('sends a test email', async () => {
    const transport = createStubTransport();
    const output = createOutput();
    const env = { ...ENV, APP_NAME: 'Family Docs' };

    assert.equal(await main(['--test', 'ops@example.test'], { env, output, transport }), 0);
    assert.equal(transport.messages.length, 1);
    const [message] = transport.messages;
    assert.deepEqual(message.envelope.to, ['ops@example.test']);
    assert.equal(message.subject, '[Family Docs] Test email');
    assert.match(message.text, /This is a test email from Family Docs\. If you can read it/);
    assert.match(message.html, /This is a test email from Family Docs\./);
    assert.match(output.text('log'), /^Sent a test email to ops@example\.test\./);
  });

  it('reports a test email that could not be sent', async () => {
    const transport = createStubTransport({ failFor: ['ops@example.test'] });
    const output = createOutput();

    assert.equal(await main(['--test', 'ops@example.test'], { env: ENV, output, transport }), 1);
    assert.equal(
      output.text('error'),
      'Could not send the test email to ops@example.test: Mailbox unavailable',
    );
  });
});

describe('sending from the command line', () => {
  before(startTestDb);
  after(stopTestDb);
  beforeEach(clearTestDb);

  it('lists the planned emails in a dry run', async () => {
    await createFixtures();
    const config = createTestConfig({
      APP_URL: 'https://docs.example.test',
      NOTIFY_OWNERS: 'true',
    });
    const output = createOutput();

    assert.equal(
      await runReminders({ config, mailer: createMailer(config), dryRun: true, output }),
      0,
    );
    const text = output.text('log');
    assert.match(text, /^Dry run: nothing is sent or recorded\.\n\nTo: {6}Alex Admin/);
    assert.match(
      text,
      new RegExp(
        [
          'To: {6}Alex Admin <alex@example\\.test> \\(administrator\\)',
          'Subject: \\[DocDateTrack\\] 1 document expired, 1 expiring soon',
          ' {2}Expired:',
          ' {4}- Passport — Ana Pop, expiry date .+ \\(3 days ago\\)',
          ' {6}https://docs\\.example\\.test/documents/[0-9a-f]{24}',
          ' {2}Expiring soon:',
          ' {4}- Insurance — Ben Ray, expiry date .+ \\(in 10 days\\)',
        ].join('\n'),
      ),
    );
    assert.match(text, /To: {6}Ana Pop <ana@example\.test> \(owner contact of Ana Pop\)/);
    assert.ok(text.endsWith('2 documents need attention. Would send 2 emails (3 new reminders).'));
    assert.equal(output.text('warn'), '');
    assert.equal(await ReminderLog.countDocuments(), 0);
  });

  it('sends the reminders and fails when an email could not be sent', async () => {
    await createFixtures();
    const config = createTestConfig();
    const failing = createOutput();

    const failed = await runReminders({
      config,
      mailer: createMailer(config, {
        transport: createStubTransport({ failFor: ['alex@example.test'] }),
      }),
      output: failing,
    });
    assert.equal(failed, 1);
    assert.match(failing.text('warn'), /^Warning: APP_URL is http:\/\/localhost:8080, so links/);
    assert.match(failing.text('error'), /Could not send the reminder email to alex@example\.test/);

    const transport = createStubTransport();
    const output = createOutput();
    assert.equal(
      await runReminders({ config, mailer: createMailer(config, { transport }), output }),
      0,
    );
    assert.equal(
      output.text('info'),
      'Sent a reminder email to alex@example.test: [DocDateTrack] 1 document expired, 1 expiring soon',
    );
    assert.equal(
      output.text('log'),
      '2 documents need attention. Sent 1 of 1 email (2 new reminders).',
    );
    assert.equal(await ReminderLog.countDocuments(), 2);
  });

  it('runs as a script', async () => {
    await createFixtures();
    const uri = new URL(getTestDbUri());
    uri.pathname = `/${mongoose.connection.name}`;
    const env = {
      PATH: process.env.PATH,
      NODE_ENV: 'test',
      MONGODB_URI: uri.href,
      APP_URL: 'https://docs.example.test',
    };
    if (process.env.TZ) env.TZ = process.env.TZ;

    const { stdout, stderr } = await execFileAsync(process.execPath, [SCRIPT, '--dry-run'], {
      env,
      timeout: 30_000,
    });
    assert.equal(stderr, '');
    assert.match(stdout, /^Dry run: nothing is sent or recorded\./);
    assert.match(stdout, /To: {6}Alex Admin <alex@example\.test> \(administrator\)/);
    assert.match(stdout, /Would send 1 email \(2 new reminders\)\.\n$/);
    assert.equal(await ReminderLog.countDocuments(), 0);
  });
});
