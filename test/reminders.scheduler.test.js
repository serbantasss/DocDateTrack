const assert = require('node:assert/strict');
const { setTimeout: sleep } = require('node:timers/promises');
const { after, before, beforeEach, describe, it } = require('node:test');
const cron = require('node-cron');

const { ConfigError } = require('../config');
const Category = require('../models/category');
const Document = require('../models/document');
const DocumentInstance = require('../models/documentInstance');
const Owner = require('../models/owner');
const ReminderLog = require('../models/reminderLog');
const { createMailer } = require('../services/mailer');
const { startReminderScheduler, validateReminderCron } = require('../services/scheduler');
const { todayUtc } = require('../services/status');
const { createTestConfig, createUser } = require('./helpers/app');
const { clearTestDb, startTestDb, stopTestDb } = require('./helpers/db');

const EVERY_SECOND = '* * * * * *';
const DAY_MS = 24 * 60 * 60 * 1000;

function createStubTransport() {
  const messages = [];
  return {
    name: 'stub',
    version: '1.0.0',
    messages,
    send(mail, callback) {
      messages.push(mail.data);
      callback(null, { envelope: mail.message.getEnvelope(), messageId: '<1@example.test>' });
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

async function waitFor(condition, { timeout = 5000 } = {}) {
  const deadline = Date.now() + timeout;
  while (!(await condition())) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for the scheduled job.');
    await sleep(20);
  }
}

const isScheduled = () =>
  [...cron.getTasks().values()].some((task) => task.name === 'email-reminders');
const runSummaries = (logger) =>
  logger.messages('info').filter((message) => message.startsWith('Email reminders: '));

async function createExpiredDocument() {
  await createUser({ username: 'alex', email: 'alex@example.test', role: 'admin' });
  const owner = await Owner.create({ first_name: 'Ana', last_name: 'Pop' });
  const category = await Category.create({ name: 'Passport' });
  const document = await Document.create({ owner, category });
  await DocumentInstance.create({
    document,
    expires_at: new Date(todayUtc().getTime() - 3 * DAY_MS),
  });
}

before(startTestDb);
after(stopTestDb);
beforeEach(clearTestDb);

describe('validateReminderCron', () => {
  it('accepts the expressions node-cron understands', () => {
    for (const expression of ['0 8 * * *', '30 7 * * 1-5', '0 */6 * * *', '@daily']) {
      assert.doesNotThrow(() => validateReminderCron(expression), expression);
    }
  });

  it('explains what is wrong with an invalid expression', () => {
    assert.throws(
      () => validateReminderCron('every morning'),
      (error) =>
        error instanceof ConfigError &&
        error.problems.length === 1 &&
        /^REMINDER_CRON must be a cron expression .* got "every morning"/.test(error.problems[0]),
    );
    assert.throws(() => validateReminderCron('0 25 * * *'), /25 is a invalid expression for hour/);
  });
});

describe('startReminderScheduler', () => {
  it('does nothing while reminders are disabled', () => {
    const logger = createLogger();
    const config = createTestConfig({ SMTP_HOST: 'smtp.example.test' });

    assert.equal(startReminderScheduler({ config, logger }), null);
    assert.deepEqual(logger.messages('info'), [
      'Email reminders are off (REMINDERS_ENABLED=false).',
    ]);
    assert.equal(isScheduled(), false);
  });

  it('warns and does nothing when no SMTP server is configured', () => {
    const logger = createLogger();
    const config = createTestConfig({ REMINDERS_ENABLED: 'true' });

    assert.equal(startReminderScheduler({ config, logger }), null);
    assert.match(logger.messages('warn')[0], /enabled, but no SMTP server is configured/);
    assert.equal(isScheduled(), false);
  });

  it('refuses an invalid REMINDER_CRON, even while reminders are disabled', () => {
    for (const REMINDERS_ENABLED of ['true', 'false']) {
      const config = createTestConfig({
        REMINDERS_ENABLED,
        REMINDER_CRON: '0 8 * *',
        SMTP_HOST: 'smtp.example.test',
      });
      assert.throws(
        () => startReminderScheduler({ config, logger: createLogger() }),
        /REMINDER_CRON must be a cron expression/,
      );
    }
    assert.equal(isScheduled(), false);
  });

  it('sends the reminders on schedule until it is stopped', async () => {
    await createExpiredDocument();
    const config = createTestConfig({
      REMINDERS_ENABLED: 'true',
      REMINDER_CRON: EVERY_SECOND,
      APP_URL: 'https://docs.example.test',
    });
    const transport = createStubTransport();
    const logger = createLogger();

    const scheduler = startReminderScheduler({
      config,
      mailer: createMailer(config, { transport }),
      logger,
    });
    try {
      assert.equal(isScheduled(), true);
      assert.match(
        logger.messages('info')[0],
        /^Email reminders are on: schedule "\* \* \* \* \* \*" \(.+\), next run .+\.$/,
      );
      await waitFor(() => runSummaries(logger).length >= 2);
    } finally {
      await scheduler.stop();
    }

    assert.equal(isScheduled(), false);
    assert.equal(transport.messages.length, 1);
    assert.equal(await ReminderLog.countDocuments(), 1);
    const [first, second] = runSummaries(logger);
    assert.equal(
      first,
      'Email reminders: 1 document needs attention. Sent 1 of 1 email (1 new reminder).',
    );
    assert.match(second, /everyone has already been reminded/);
    assert.deepEqual(logger.messages('warn'), []);

    const runs = runSummaries(logger).length;
    await sleep(1500);
    assert.equal(runSummaries(logger).length, runs);
  });

  it('never overlaps runs, and stop() waits for the running one', async () => {
    await createExpiredDocument();
    const config = createTestConfig({ REMINDERS_ENABLED: 'true', REMINDER_CRON: EVERY_SECOND });
    let sendCalls = 0;
    let release = () => {};
    const mailer = {
      isConfigured: true,
      verify: async () => true,
      send() {
        sendCalls += 1;
        return new Promise((resolve) => {
          release = resolve;
        });
      },
    };
    const logger = createLogger();

    const scheduler = startReminderScheduler({ config, mailer, logger });
    let stopped = false;
    try {
      await waitFor(() => sendCalls === 1);
      await waitFor(() => logger.messages('warn').some((message) => /overlap/.test(message)));
      const stopping = scheduler.stop().then(() => {
        stopped = true;
      });
      await sleep(200);
      assert.equal(stopped, false);
      release();
      await stopping;
    } finally {
      release();
      await scheduler.stop();
    }

    assert.equal(stopped, true);
    assert.equal(sendCalls, 1);
    assert.equal(await ReminderLog.countDocuments(), 1);
    assert.equal(isScheduled(), false);
  });

  it('logs a failed run and keeps the schedule', async (t) => {
    t.mock.method(Document, 'find', () => {
      throw new Error('Database unavailable');
    });
    const config = createTestConfig({ REMINDERS_ENABLED: 'true', REMINDER_CRON: EVERY_SECOND });
    const logger = createLogger();

    const scheduler = startReminderScheduler({
      config,
      mailer: createMailer(config, { transport: createStubTransport() }),
      logger,
    });
    try {
      await waitFor(() => logger.messages('error').length >= 2);
    } finally {
      await scheduler.stop();
    }
    assert.match(
      logger.messages('error')[0],
      /^Email reminders failed: Error: Database unavailable/,
    );
    assert.match(logger.messages('warn')[0], /^APP_URL is http:\/\/localhost:8080, so links/);
  });
});
