const cron = require('node-cron');

const { ConfigError } = require('../config');
const { createFormatter } = require('../lib/format');
const { createMailer } = require('./mailer');
const { appUrlWarning, formatSummary, sendReminders } = require('./reminders');

// bin/www gives the whole shutdown 10 s; leave time to close the servers and MongoDB afterwards.
const STOP_TIMEOUT_MS = 5000;

/** Throws a ConfigError unless `expression` is a cron expression node-cron accepts. */
function validateReminderCron(expression) {
  const { valid, errors } = cron.validateDetailed(expression);
  if (valid) return;
  throw new ConfigError([
    `REMINDER_CRON must be a cron expression (minute hour day-of-month month day-of-week) such ` +
      `as "0 8 * * *" for every day at 08:00, got "${expression}" ` +
      `(${errors.map((error) => error.message).join('; ')}).`,
  ]);
}

function cronLogger(logger) {
  const text = (message) =>
    `Email reminders: ${message instanceof Error ? message.message : message}`;
  return {
    info: (message) => logger.info(text(message)),
    warn: (message) => logger.warn(text(message)),
    error: (message, error) => logger.error(text(message), ...(error ? [error] : [])),
    debug: () => {},
  };
}

async function finishesWithin(promise, ms) {
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(resolve, ms, false);
  });
  try {
    return await Promise.race([promise.then(() => true), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Schedules sendReminders() on `config.reminders.cron` in the server's time zone (TZ). Returns
 * `{ stop() }`, or null when reminders are disabled or no SMTP server is configured. Runs never
 * overlap, and their errors are logged instead of thrown. stop() cancels the schedule and waits
 * (up to 5 s) for a run in progress.
 */
function startReminderScheduler({ config, mailer = createMailer(config), logger = console }) {
  validateReminderCron(config.reminders.cron);
  if (!config.reminders.enabled) {
    logger.info('Email reminders are off (REMINDERS_ENABLED=false).');
    return null;
  }
  if (!mailer.isConfigured) {
    logger.warn(
      'Email reminders are enabled, but no SMTP server is configured (set SMTP_HOST or ' +
        'SMTP_URL), so no reminders will be sent.',
    );
    return null;
  }

  let currentRun = null;
  async function run() {
    try {
      const summary = await sendReminders({ config, mailer, logger });
      logger.info(`Email reminders: ${formatSummary(summary)}`);
    } catch (error) {
      logger.error('Email reminders failed:', error);
    }
  }
  const task = cron.schedule(
    config.reminders.cron,
    () => {
      currentRun = run().finally(() => {
        currentRun = null;
      });
      return currentRun;
    },
    { name: 'email-reminders', noOverlap: true, logger: cronLogger(logger) },
  );

  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const nextRun = createFormatter({ locale: config.dateLocale }).dateTime(task.getNextRun());
  logger.info(
    `Email reminders are on: schedule "${config.reminders.cron}" (${timeZone}), next run ${nextRun}.`,
  );
  const warning = appUrlWarning(config);
  if (warning) logger.warn(warning);
  mailer.verify().catch((error) => {
    logger.warn(
      `Email reminders: the SMTP server check failed (${error.message}). Check the SMTP ` +
        'settings, e.g. with: npm run reminders:send -- --test you@example.com',
    );
  });

  return {
    async stop() {
      task.destroy();
      if (currentRun && !(await finishesWithin(currentRun, STOP_TIMEOUT_MS))) {
        logger.warn(
          `Email reminders: the running job did not finish within ${STOP_TIMEOUT_MS / 1000} s.`,
        );
      }
    },
  };
}

module.exports = { startReminderScheduler, validateReminderCron };
