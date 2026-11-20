#!/usr/bin/env node
/**
 * Sends the email reminders now: the job the server runs on REMINDER_CRON when
 * REMINDERS_ENABLED=true. See USAGE below or run `npm run reminders:send -- --help`.
 */
const { parseArgs } = require('node:util');
const mongoose = require('mongoose');

const { ConfigError, loadConfig } = require('../config');
const { NOT_CONFIGURED_MESSAGE, createMailer } = require('../services/mailer');
const {
  appUrlWarning,
  formatSummary,
  sendReminders,
  sendTestEmail,
} = require('../services/reminders');

const USAGE = `Usage: npm run reminders:send -- [options]

Emails the reminders about expired and expiring documents that have not been sent yet, like the
server does on its schedule (REMINDER_CRON) when REMINDERS_ENABLED=true. This command runs
whatever REMINDERS_ENABLED is set to; NOTIFY_OWNERS and the SMTP settings apply.

Options:
  --dry-run        Show who would get which reminders, without sending or recording anything
  --test <email>   Send a test email to <email> to check the SMTP settings
  -h, --help       Show this help`;

const EMAIL = /^[^\s@]+@[^\s@]+$/;

class UsageError extends Error {}

/** Returns `{ command: 'send' | 'dry-run' | 'help' }` or `{ command: 'test', to }`. */
function parseCliArgs(args) {
  let values;
  try {
    ({ values } = parseArgs({
      args,
      options: {
        'dry-run': { type: 'boolean' },
        test: { type: 'string' },
        help: { type: 'boolean', short: 'h' },
      },
      strict: true,
      allowPositionals: false,
    }));
  } catch (error) {
    throw new UsageError(error.message);
  }
  if (values.help) return { command: 'help' };
  if (values.test !== undefined) {
    if (values['dry-run']) throw new UsageError('Use either --dry-run or --test, not both.');
    const to = values.test.trim();
    if (!EMAIL.test(to)) {
      throw new UsageError(`--test needs an email address, got "${values.test}".`);
    }
    return { command: 'test', to };
  }
  return { command: values['dry-run'] ? 'dry-run' : 'send' };
}

function formatPlannedEmail(message) {
  const address = message.name ? `${message.name} <${message.to}>` : message.to;
  const reason = message.isAdmin
    ? 'administrator'
    : `owner contact of ${message.ownerNames.join(', ')}`;
  const lines = [`To:      ${address} (${reason})`, `Subject: ${message.subject}`];
  for (const group of message.groups) {
    lines.push(`  ${group.label}:`);
    for (const item of group.items) {
      lines.push(
        `    - ${item.title}, expiry date ${item.expiresOn} (${item.relative})`,
        `      ${item.url}`,
      );
    }
  }
  if (message.outstanding > 0) {
    lines.push(`  + ${message.outstanding} already reminded and still due (not listed again)`);
  }
  return lines.join('\n');
}

/** Sends (or with `dryRun` lists) the due reminders; resolves with the exit code. */
async function runReminders({ config, mailer, dryRun = false, output = console }) {
  const warning = appUrlWarning(config);
  if (warning) output.warn(`Warning: ${warning}`);
  const summary = await sendReminders({ config, mailer, dryRun, logger: output });
  if (dryRun) {
    output.log('Dry run: nothing is sent or recorded.');
    for (const message of summary.messages) output.log(`\n${formatPlannedEmail(message)}`);
    if (summary.messages.length > 0) output.log('');
  }
  output.log(formatSummary(summary));
  return summary.failed > 0 ? 1 : 0;
}

/**
 * Runs the command for `args` (process.argv without node and the script) and resolves with the
 * exit code. `transport` replaces the SMTP transport (tests).
 */
async function main(args, { env = process.env, output = console, transport } = {}) {
  let options;
  try {
    options = parseCliArgs(args);
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    output.error(`${error.message}\n\n${USAGE}`);
    return 1;
  }
  if (options.command === 'help') {
    output.log(USAGE);
    return 0;
  }

  let config;
  try {
    config = loadConfig(env, { requireSessionSecret: false });
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    output.error(error.message);
    return 1;
  }
  const mailer = createMailer(config, { transport });
  if (options.command !== 'dry-run' && !mailer.isConfigured) {
    output.error(NOT_CONFIGURED_MESSAGE);
    return 1;
  }

  if (options.command === 'test') {
    try {
      await sendTestEmail({ config, mailer, to: options.to });
    } catch (error) {
      output.error(`Could not send the test email to ${options.to}: ${error.message}`);
      return 1;
    }
    output.log(
      `Sent a test email to ${options.to}. If it does not arrive, check the spam folder and ` +
        'the SMTP settings.',
    );
    return 0;
  }

  try {
    await mongoose.connect(config.mongodbUri, { serverSelectionTimeoutMS: 10_000 });
  } catch (error) {
    output.error(`Unable to connect to MongoDB: ${error.message}`);
    return 1;
  }
  try {
    return await runReminders({ config, mailer, dryRun: options.command === 'dry-run', output });
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      console.error('Sending reminders failed:', error);
      process.exitCode = 1;
    },
  );
}

module.exports = { USAGE, UsageError, main, parseCliArgs, runReminders };
