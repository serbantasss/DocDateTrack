const path = require('node:path');
const pug = require('pug');

const { createFormatter } = require('../lib/format');
const ReminderLog = require('../models/reminderLog');
const User = require('../models/user');
const { findDocumentsWithStatus, sortByUrgency } = require('./documents');
const { NOT_CONFIGURED_MESSAGE } = require('./mailer');
const { STATUS, STATUS_META } = require('./status');

const TEMPLATE_DIR = path.join(__dirname, '..', 'views', 'emails');
const STAGES = Object.freeze([STATUS.EXPIRED, STATUS.EXPIRING]);
const STAGE_COLORS = Object.freeze({ expired: '#b02a37', expiring: '#8a6100' });
const LOCAL_HOSTNAMES = ['localhost', '127.0.0.1', '[::1]'];
const listFormat = new Intl.ListFormat('en', { style: 'long', type: 'conjunction' });
const templates = new Map();

const plural = (count, noun) => `${count} ${noun}${count === 1 ? '' : 's'}`;

function normalizeAddress(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function isDue(row) {
  return Boolean(row.currentVersion) && STAGES.includes(row.status);
}

/** Identifies one reminder: an address told about a version (and its expiry date) at a stage. */
function reminderKey({ recipient, version, stage, expiresAt }) {
  return [recipient, String(version), stage, new Date(expiresAt).getTime()].join('|');
}

function rowKey(recipient, row) {
  return reminderKey({
    recipient,
    version: row.currentVersion._id,
    stage: row.status,
    expiresAt: row.currentVersion.expires_at,
  });
}

/**
 * Decides who is told about what (pure). `rows` come from findDocumentsWithStatus(); only expired
 * and expiring documents with a current version count. Every administrator gets all of them and,
 * with `notifyOwners`, owners with an email address also get their own. Each address appears once
 * (an owner address that is also an administrator's gets the administrator's digest). Items whose
 * reminderKey() is in `sentKeys` are only counted in `outstanding`. Returns every address with
 * something due, most urgent items first; `items` is empty when nothing is new for it.
 */
function planReminders({ rows, admins = [], notifyOwners = false, sentKeys = new Set() }) {
  const due = sortByUrgency(rows.filter(isDue));
  if (due.length === 0) return [];

  const recipients = new Map();
  const recipientFor = (address) => {
    if (!recipients.has(address)) {
      recipients.set(address, { to: address, name: null, isAdmin: false, ownerNames: [] });
    }
    return recipients.get(address);
  };
  for (const admin of admins) {
    const address = normalizeAddress(admin.email);
    if (!address) continue;
    const recipient = recipientFor(address);
    recipient.isAdmin = true;
    recipient.name ??= admin.name ?? null;
  }
  if (notifyOwners) {
    for (const { document } of due) {
      const address = normalizeAddress(document.owner?.email);
      if (!address) continue;
      const { ownerNames } = recipientFor(address);
      if (!ownerNames.includes(document.owner.name)) ownerNames.push(document.owner.name);
    }
  }

  return [...recipients.values()].map((recipient) => {
    const scope = recipient.isAdmin
      ? due
      : due.filter((row) => normalizeAddress(row.document.owner?.email) === recipient.to);
    const items = [];
    let outstanding = 0;
    for (const row of scope) {
      const key = rowKey(recipient.to, row);
      if (sentKeys.has(key)) outstanding += 1;
      else items.push({ key, stage: row.status, row });
    }
    const ownerName = recipient.ownerNames.length === 1 ? recipient.ownerNames[0] : null;
    return { ...recipient, name: recipient.name ?? ownerName, items, outstanding };
  });
}

function renderTemplate(name, locals) {
  if (!templates.has(name)) {
    templates.set(name, pug.compileFile(path.join(TEMPLATE_DIR, `${name}.pug`)));
  }
  return templates.get(name)(locals);
}

/** "2 documents expired, 1 expiring soon" */
function describeCounts({ expired = 0, expiring = 0 }) {
  const parts = [];
  if (expired > 0) parts.push(`${plural(expired, 'document')} expired`);
  if (expiring > 0) {
    parts.push(`${parts.length > 0 ? expiring : plural(expiring, 'document')} expiring soon`);
  }
  return parts.join(', ');
}

function reminderFooter(recipient, config) {
  const reason = recipient.isAdmin
    ? `You receive this summary because you are an administrator of ${config.appName}.`
    : `You receive this email because this address is recorded for ` +
      `${listFormat.format(recipient.ownerNames)} in ${config.appName}. To stop these ` +
      'reminders, ask an administrator to remove it.';
  const days = config.expiryWarningDays;
  const warning =
    days === 0 ? 'on its expiry date' : `${plural(days, 'day')} or less before its expiry date`;
  return [
    reason,
    `You are reminded about a document once when it is about to expire (${warning}) and once ` +
      'more when it has expired.',
  ];
}

function reminderText(locals) {
  const lines = [locals.greeting, '', locals.intro];
  for (const group of locals.groups) {
    lines.push('', `${group.label.toUpperCase()} (${group.items.length})`);
    for (const item of group.items) {
      lines.push(
        `- ${item.title}`,
        `  Expiry date: ${item.expiresOn} (${item.relative})`,
        `  ${item.url}`,
      );
    }
  }
  if (locals.outstandingText) lines.push('', locals.outstandingText);
  lines.push('', `Open ${locals.appName}: ${locals.appUrl}/`, '', '-- ', ...locals.footer);
  return `${lines.join('\n')}\n`;
}

/** Builds the email for one planned recipient: `{ to, subject, text, html, groups }`. */
function composeReminderEmail(recipient, { config, formatter }) {
  const groups = STAGES.map((stage) => ({
    stage,
    label: STATUS_META[stage].label,
    color: STAGE_COLORS[stage],
    items: recipient.items
      .filter((item) => item.stage === stage)
      .map(({ row }) => ({
        title: row.document.title,
        url: `${config.appUrl}${row.document.url}`,
        expiresOn: formatter.date(row.currentVersion.expires_at),
        relative: formatter.relativeDays(row.daysUntil),
      })),
  })).filter((group) => group.items.length > 0);

  const headline = describeCounts(
    Object.fromEntries(groups.map((group) => [group.stage, group.items.length])),
  );
  const subject = `[${config.appName}] ${headline}`;
  const { outstanding } = recipient;
  const locals = {
    appName: config.appName,
    appUrl: config.appUrl,
    subject,
    preheader: headline,
    greeting: recipient.name ? `Hello ${recipient.name},` : 'Hello,',
    intro: recipient.isAdmin
      ? `These documents in ${config.appName} need attention:`
      : 'These documents need attention:',
    groups,
    outstandingText:
      outstanding > 0
        ? `${plural(outstanding, 'more document')} you were already reminded about still ` +
          `need${outstanding === 1 ? 's' : ''} attention.`
        : null,
    footer: reminderFooter(recipient, config),
  };
  return {
    to: { name: recipient.name ?? '', address: recipient.to },
    subject,
    text: reminderText(locals),
    html: renderTemplate('reminder', locals),
    groups,
  };
}

/** A short email that confirms the SMTP settings work. */
function composeTestEmail({ config, to, now = new Date() }) {
  const sentAt = createFormatter({ locale: config.dateLocale }).dateTime(now);
  const subject = `[${config.appName}] Test email`;
  const locals = {
    appName: config.appName,
    appUrl: config.appUrl,
    subject,
    preheader: 'Your email settings work.',
    sentAt,
    from: config.smtp.from,
  };
  const text = [
    'Hello,',
    '',
    `This is a test email from ${config.appName}. If you can read it, the email settings work ` +
      'and reminders can be delivered.',
    '',
    `Sent from ${config.smtp.from} on ${sentAt}.`,
    '',
    '-- ',
    `You receive this email because someone sent a test email to this address from the ` +
      `${config.appName} server at ${config.appUrl}.`,
  ];
  return { to, subject, text: `${text.join('\n')}\n`, html: renderTemplate('test', locals) };
}

async function sendTestEmail({ config, mailer, to, now = new Date() }) {
  await mailer.verify();
  return mailer.send(composeTestEmail({ config, to, now }));
}

async function loadSentKeys(rows) {
  if (rows.length === 0) return new Set();
  const logs = await ReminderLog.find(
    { version: { $in: rows.map((row) => row.currentVersion._id) } },
    { recipient: 1, version: 1, stage: 1, expires_at: 1 },
  ).lean();
  return new Set(
    logs.map((log) =>
      reminderKey({
        recipient: log.recipient,
        version: log.version,
        stage: log.stage,
        expiresAt: log.expires_at,
      }),
    ),
  );
}

function isDuplicateKeyError(error) {
  const writeErrors = error?.writeErrors ?? [error];
  return writeErrors.length > 0 && writeErrors.every((writeError) => writeError?.code === 11000);
}

async function recordSent(recipient, sentAt) {
  const entries = recipient.items.map(({ stage, row }) => ({
    recipient: recipient.to,
    document: row.document._id,
    version: row.currentVersion._id,
    stage,
    expires_at: row.currentVersion.expires_at,
    sent_at: sentAt,
  }));
  try {
    await ReminderLog.insertMany(entries, { ordered: false });
  } catch (error) {
    // Another run recorded the same reminder in the meantime.
    if (!isDuplicateKeyError(error)) throw error;
  }
}

/**
 * Emails every recipient the expired / expiring documents it has not been told about yet and
 * records what was sent. With `dryRun` nothing is sent or recorded (no SMTP settings needed).
 * Resolves with a summary: counts of due `documents`, `recipients` (addresses with something
 * due), `emails` and `items` (new reminders in them), `sent`, `failed`, `skipped` (recipients
 * with nothing new), plus `messages` (one per email: `to`, `subject`, `groups`, `outstanding`,
 * `status` planned|sent|failed, `error`).
 */
async function sendReminders({
  config,
  mailer,
  now = new Date(),
  dryRun = false,
  logger = console,
}) {
  if (!dryRun && !mailer?.isConfigured) throw new Error(NOT_CONFIGURED_MESSAGE);

  const rows = await findDocumentsWithStatus({ now, warningDays: config.expiryWarningDays });
  const due = rows.filter(isDue);
  const admins = due.length > 0 ? await User.find({ role: 'admin' }).sort({ username: 1 }) : [];
  const plan = planReminders({
    rows: due,
    admins,
    notifyOwners: config.reminders.notifyOwners,
    sentKeys: await loadSentKeys(due),
  });

  const formatter = createFormatter({ locale: config.dateLocale });
  const summary = {
    dryRun,
    documents: due.length,
    recipients: plan.length,
    emails: 0,
    items: 0,
    sent: 0,
    failed: 0,
    skipped: 0,
    messages: [],
  };
  for (const recipient of plan) {
    if (recipient.items.length === 0) {
      summary.skipped += 1;
      continue;
    }
    const email = composeReminderEmail(recipient, { config, formatter });
    const message = {
      to: recipient.to,
      name: recipient.name,
      isAdmin: recipient.isAdmin,
      ownerNames: recipient.ownerNames,
      subject: email.subject,
      groups: email.groups,
      outstanding: recipient.outstanding,
      status: 'planned',
      error: null,
    };
    summary.messages.push(message);
    summary.emails += 1;
    summary.items += recipient.items.length;
    if (dryRun) continue;

    try {
      await mailer.send(email);
    } catch (error) {
      message.status = 'failed';
      message.error = error.message;
      summary.failed += 1;
      logger.error(`Could not send the reminder email to ${recipient.to}: ${error.message}`);
      continue;
    }
    message.status = 'sent';
    summary.sent += 1;
    logger.info(`Sent a reminder email to ${recipient.to}: ${email.subject}`);
    try {
      await recordSent(recipient, new Date());
    } catch (error) {
      logger.error(
        `The reminder email to ${recipient.to} was sent but could not be recorded, so it may ` +
          `be sent again: ${error.message}`,
      );
    }
  }
  return summary;
}

/** One-line description of a sendReminders() summary. */
function formatSummary(summary) {
  if (summary.documents === 0) return 'No documents are expired or expiring soon; nothing to send.';
  const verb = summary.documents === 1 ? 'needs' : 'need';
  const attention = `${plural(summary.documents, 'document')} ${verb} attention`;
  if (summary.recipients === 0) return `${attention}, but there is nobody to email.`;
  if (summary.emails === 0) {
    return `${attention}; everyone has already been reminded, so there is nothing new to send.`;
  }
  const emails = `${plural(summary.emails, 'email')} (${plural(summary.items, 'new reminder')})`;
  const skipped =
    summary.skipped > 0 ? `; ${plural(summary.skipped, 'recipient')} with nothing new` : '';
  if (summary.dryRun) return `${attention}. Would send ${emails}${skipped}.`;
  const failed =
    summary.failed > 0 ? `; ${summary.failed} failed and will be retried by the next run` : '';
  return `${attention}. Sent ${summary.sent} of ${emails}${failed}${skipped}.`;
}

/** A warning when links in emails would point to this computer only, else null. */
function appUrlWarning(config) {
  if (!LOCAL_HOSTNAMES.includes(new URL(config.appUrl).hostname)) return null;
  return (
    `APP_URL is ${config.appUrl}, so links in reminder emails only work on this computer. ` +
    `Set APP_URL to the address people use to open ${config.appName}.`
  );
}

module.exports = {
  appUrlWarning,
  formatSummary,
  planReminders,
  reminderKey,
  sendReminders,
  sendTestEmail,
};
