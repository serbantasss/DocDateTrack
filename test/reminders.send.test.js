const assert = require('node:assert/strict');
const { after, before, beforeEach, describe, it } = require('node:test');

const Category = require('../models/category');
const Document = require('../models/document');
const DocumentInstance = require('../models/documentInstance');
const Owner = require('../models/owner');
const ReminderLog = require('../models/reminderLog');
const { createMailer } = require('../services/mailer');
const { formatSummary, sendReminders } = require('../services/reminders');
const { createTestConfig, createUser } = require('./helpers/app');
const { clearTestDb, startTestDb, stopTestDb } = require('./helpers/db');

const NOW = new Date(2026, 10, 17, 12, 0);
const APP_URL = 'https://docs.example.test';
const day = (isoDate) => new Date(`${isoDate}T00:00:00Z`);
const daysAfterNow = (days) => new Date(NOW.getTime() + days * 24 * 60 * 60 * 1000);

/** A nodemailer transport that records messages and fails for the addresses in `failFor`. */
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

function createLogger() {
  const entries = [];
  const record =
    (level) =>
    (...args) =>
      entries.push([level, args.map(String).join(' ')]);
  return {
    info: record('info'),
    warn: record('warn'),
    error: record('error'),
    messages: (level) => entries.filter(([entry]) => entry === level).map(([, text]) => text),
  };
}

const countsOf = ({ messages: _messages, ...counts }) => counts;
const recipientsOf = (transport) => transport.messages.map((message) => message.envelope.to[0]);

async function createFixtures() {
  await createUser({
    username: 'alex',
    email: 'alex@example.test',
    role: 'admin',
    display_name: 'Alex Admin',
  });
  await createUser({ username: 'mia', email: 'mia@example.test', role: 'member' });
  const [ana, ben, cleo] = await Owner.create([
    { first_name: 'Ana', last_name: 'Pop', email: 'ana@example.test' },
    { first_name: 'Ben', last_name: 'Ray' },
    { first_name: 'Cleo', last_name: 'Day', email: 'cleo@example.test' },
  ]);
  const [passport, insurance] = await Category.create([
    { name: 'Passport' },
    { name: 'Insurance', scope: 'company' },
  ]);
  const [anaPassport, benInsurance, cleoPassport] = await Document.create([
    { owner: ana, category: passport },
    { owner: ben, category: insurance },
    { owner: cleo, category: passport },
    { owner: ana, category: insurance },
  ]);
  const [, anaCurrent, benCurrent] = await DocumentInstance.create([
    { document: anaPassport, expires_at: day('2020-01-01') },
    { document: anaPassport, expires_at: day('2026-11-01') },
    { document: benInsurance, expires_at: day('2026-11-27') },
    { document: cleoPassport, expires_at: day('2030-01-01') },
  ]);
  return { anaPassport, benInsurance, anaCurrent, benCurrent };
}

function setup(env = {}, transportOptions = {}) {
  const config = createTestConfig({ APP_URL, ...env });
  const transport = createStubTransport(transportOptions);
  const mailer = createMailer(config, { transport });
  const logger = createLogger();
  const send = (options = {}) => sendReminders({ config, mailer, now: NOW, logger, ...options });
  return { config, transport, logger, send };
}

before(startTestDb);
after(stopTestDb);
beforeEach(clearTestDb);

describe('sendReminders', () => {
  it('emails the administrators every expired and expiring document once', async () => {
    const { anaPassport, benInsurance, anaCurrent, benCurrent } = await createFixtures();
    const { transport, send } = setup();

    const summary = await send();
    assert.deepEqual(countsOf(summary), {
      dryRun: false,
      documents: 2,
      recipients: 1,
      emails: 1,
      items: 2,
      sent: 1,
      failed: 0,
      skipped: 0,
    });
    assert.deepEqual(recipientsOf(transport), ['alex@example.test']);
    assert.equal(
      transport.messages[0].subject,
      '[DocDateTrack] 1 document expired, 1 expiring soon',
    );
    assert.equal(summary.messages[0].status, 'sent');

    const logs = await ReminderLog.find().sort({ stage: 1 }).lean();
    assert.deepEqual(
      logs.map((log) => [
        log.recipient,
        String(log.document),
        String(log.version),
        log.stage,
        log.expires_at.toISOString(),
      ]),
      [
        [
          'alex@example.test',
          String(anaPassport._id),
          String(anaCurrent._id),
          'expired',
          '2026-11-01T00:00:00.000Z',
        ],
        [
          'alex@example.test',
          String(benInsurance._id),
          String(benCurrent._id),
          'expiring',
          '2026-11-27T00:00:00.000Z',
        ],
      ],
    );

    const again = await send();
    assert.equal(transport.messages.length, 1);
    assert.deepEqual(countsOf(again), {
      dryRun: false,
      documents: 2,
      recipients: 1,
      emails: 0,
      items: 0,
      sent: 0,
      failed: 0,
      skipped: 1,
    });
    assert.equal(
      formatSummary(again),
      '2 documents need attention; everyone has already been reminded, so there is nothing new ' +
        'to send.',
    );
    assert.equal(await ReminderLog.countDocuments(), 2);
  });

  it('also emails owners their own documents when NOTIFY_OWNERS is on', async () => {
    await createFixtures();
    const { transport, send } = setup({ NOTIFY_OWNERS: 'true' });

    const summary = await send();
    assert.deepEqual(
      transport.messages.map((message) => [message.envelope.to[0], message.subject]),
      [
        ['alex@example.test', '[DocDateTrack] 1 document expired, 1 expiring soon'],
        ['ana@example.test', '[DocDateTrack] 1 document expired'],
      ],
    );
    assert.match(transport.messages[1].text, /Passport — Ana Pop/);
    assert.doesNotMatch(transport.messages[1].text, /Ben Ray/);
    assert.deepEqual([summary.recipients, summary.items, summary.sent], [2, 3, 2]);
    assert.equal(
      formatSummary(summary),
      '2 documents need attention. Sent 2 of 2 emails (3 new reminders).',
    );
  });

  it('reminds again once an expiring document has expired', async () => {
    await createFixtures();
    const { transport, send } = setup();
    await send();

    const later = await send({ now: daysAfterNow(11) });
    assert.equal(later.items, 1);
    const message = transport.messages[1];
    assert.equal(message.subject, '[DocDateTrack] 1 document expired');
    assert.match(message.text, /- Insurance — Ben Ray\n {2}Expiry date: 27 Nov 2026 \(yesterday\)/);
    assert.doesNotMatch(message.text, /Passport — Ana Pop/);
    assert.match(
      message.text,
      /1 more document you were already reminded about still needs attention\./,
    );
    assert.equal(await ReminderLog.countDocuments({ stage: 'expired' }), 2);
  });

  it('starts over when a renewal is uploaded', async () => {
    const { anaPassport } = await createFixtures();
    const { transport, send } = setup();
    await send();
    await DocumentInstance.create({ document: anaPassport, expires_at: day('2026-12-01') });

    const summary = await send();
    assert.equal(summary.items, 1);
    assert.equal(transport.messages[1].subject, '[DocDateTrack] 1 document expiring soon');
    assert.match(
      transport.messages[1].text,
      /- Passport — Ana Pop\n {2}Expiry date: 1 Dec 2026 \(in 14 days\)/,
    );
  });

  it('starts over when the expiry date of the current version is corrected', async () => {
    const { benCurrent } = await createFixtures();
    const { transport, send } = setup();
    await send();
    benCurrent.expires_at = day('2026-11-25');
    await benCurrent.save();

    const summary = await send();
    assert.equal(summary.items, 1);
    assert.match(
      transport.messages[1].text,
      /- Insurance — Ben Ray\n {2}Expiry date: 25 Nov 2026 \(in 8 days\)/,
    );
  });

  it('records only the emails that were sent, so failed ones are retried', async () => {
    await createFixtures();
    const { config, logger, transport, send } = setup(
      { NOTIFY_OWNERS: 'true' },
      { failFor: ['alex@example.test'] },
    );

    const first = await send();
    assert.deepEqual(recipientsOf(transport), ['ana@example.test']);
    assert.deepEqual(
      first.messages.map((message) => [message.to, message.status, message.error]),
      [
        ['alex@example.test', 'failed', 'Mailbox unavailable'],
        ['ana@example.test', 'sent', null],
      ],
    );
    assert.deepEqual(await ReminderLog.distinct('recipient'), ['ana@example.test']);
    assert.deepEqual(logger.messages('error'), [
      'Could not send the reminder email to alex@example.test: Mailbox unavailable',
    ]);
    assert.equal(
      formatSummary(first),
      '2 documents need attention. Sent 1 of 2 emails (3 new reminders); 1 failed and will be ' +
        'retried by the next run.',
    );

    const working = createStubTransport();
    const second = await sendReminders({
      config,
      mailer: createMailer(config, { transport: working }),
      now: NOW,
      logger,
    });
    assert.deepEqual(recipientsOf(working), ['alex@example.test']);
    assert.deepEqual([second.items, second.sent, second.skipped], [2, 1, 1]);
    assert.equal(await ReminderLog.countDocuments(), 3);
  });

  it('only plans in a dry run: nothing is sent or recorded and no SMTP server is needed', async () => {
    await createFixtures();
    const config = createTestConfig({ APP_URL, NOTIFY_OWNERS: 'true' });
    const logger = createLogger();

    const summary = await sendReminders({
      config,
      mailer: createMailer(config),
      now: NOW,
      dryRun: true,
      logger,
    });
    assert.deepEqual(
      summary.messages.map((message) => [message.to, message.status, message.subject]),
      [
        ['alex@example.test', 'planned', '[DocDateTrack] 1 document expired, 1 expiring soon'],
        ['ana@example.test', 'planned', '[DocDateTrack] 1 document expired'],
      ],
    );
    assert.deepEqual(
      summary.messages[0].groups.map((group) => [group.label, group.items.map((i) => i.title)]),
      [
        ['Expired', ['Passport — Ana Pop']],
        ['Expiring soon', ['Insurance — Ben Ray']],
      ],
    );
    assert.equal(
      formatSummary(summary),
      '2 documents need attention. Would send 2 emails (3 new reminders).',
    );

    const transport = createStubTransport();
    await sendReminders({
      config,
      mailer: createMailer(config, { transport }),
      now: NOW,
      dryRun: true,
      logger,
    });
    assert.equal(transport.messages.length, 0);
    assert.equal(await ReminderLog.countDocuments(), 0);
    assert.deepEqual(logger.messages('info'), []);
  });

  it('refuses to send without SMTP settings', async () => {
    const config = createTestConfig();
    await assert.rejects(
      sendReminders({ config, mailer: createMailer(config), now: NOW }),
      /Email is not configured/,
    );
  });

  it('sends nothing while no document needs attention', async () => {
    await createUser({ username: 'alex', email: 'alex@example.test', role: 'admin' });
    const owner = await Owner.create({ first_name: 'Dan', last_name: 'Lee' });
    const category = await Category.create({ name: 'Passport' });
    const document = await Document.create({ owner, category });
    await DocumentInstance.create({ document, expires_at: day('2027-06-01') });
    await Document.create({ owner, category: await Category.create({ name: 'Visa' }) });
    const { transport, send } = setup();

    const summary = await send();
    assert.equal(transport.messages.length, 0);
    assert.deepEqual([summary.documents, summary.recipients, summary.emails], [0, 0, 0]);
    assert.equal(
      formatSummary(summary),
      'No documents are expired or expiring soon; nothing to send.',
    );
  });
});

describe('reminder emails', () => {
  it('link to APP_URL, format dates with DATE_LOCALE and escape names in HTML', async () => {
    const owner = await Owner.create({
      first_name: '<Ana>',
      last_name: 'Pop & "Co"',
      email: 'ana@example.test',
    });
    const category = await Category.create({ name: 'Passport' });
    const document = await Document.create({ owner, category });
    await DocumentInstance.create({ document, expires_at: day('2026-11-17') });
    await createUser({
      username: 'alex',
      email: 'alex@example.test',
      role: 'admin',
      display_name: 'Alex Admin',
    });
    const { config, transport, send } = setup({
      APP_NAME: 'Family Docs',
      APP_URL: 'https://example.test/docs',
      DATE_LOCALE: 'en-US',
      NOTIFY_OWNERS: 'true',
    });

    await send();
    const [adminEmail, ownerEmail] = transport.messages;
    const url = `https://example.test/docs/documents/${document._id}`;

    assert.equal(adminEmail.subject, '[Family Docs] 1 document expiring soon');
    assert.equal(adminEmail.from, config.smtp.from);
    assert.equal(adminEmail.headers['Auto-Submitted'], 'auto-generated');
    assert.deepEqual(adminEmail.to, { name: 'Alex Admin', address: 'alex@example.test' });
    assert.ok(adminEmail.text.startsWith('Hello Alex Admin,\n\nThese documents in Family Docs'));
    assert.ok(
      adminEmail.text.includes(
        `EXPIRING SOON (1)\n- Passport — <Ana> Pop & "Co"\n  Expiry date: Nov 17, 2026 (today)\n  ${url}\n`,
      ),
    );
    assert.ok(adminEmail.text.includes('Open Family Docs: https://example.test/docs/\n'));
    assert.match(adminEmail.text, /because you are an administrator of Family Docs\./);

    assert.ok(adminEmail.html.includes(`<a href="${url}"`));
    assert.ok(adminEmail.html.includes('Passport — &lt;Ana&gt; Pop &amp; &quot;Co&quot;</a>'));
    assert.ok(adminEmail.html.includes('Expiry date: Nov 17, 2026 (today)'));
    assert.ok(!adminEmail.html.includes('<Ana>'));

    assert.deepEqual(ownerEmail.to, { name: '<Ana> Pop & "Co"', address: 'ana@example.test' });
    assert.match(ownerEmail.text, /recorded for <Ana> Pop & "Co" in Family Docs\./);
    assert.ok(ownerEmail.html.includes('Hello &lt;Ana&gt; Pop &amp; &quot;Co&quot;,'));
    assert.ok(!ownerEmail.html.includes('<Ana>'));
  });
});
