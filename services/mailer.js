const nodemailer = require('nodemailer');

const NOT_CONFIGURED_MESSAGE =
  'Email is not configured. Set SMTP_HOST (with SMTP_PORT, SMTP_SECURE, SMTP_USER and SMTP_PASS ' +
  'as needed) or SMTP_URL.';

// Give up on unreachable servers sooner than nodemailer's defaults (up to 2 minutes).
const TIMEOUTS = Object.freeze({
  connectionTimeout: 20_000,
  greetingTimeout: 20_000,
  socketTimeout: 60_000,
});

function smtpTransportOptions(smtp) {
  if (smtp.url) return { url: smtp.url, ...TIMEOUTS };
  const options = {
    host: smtp.host,
    port: smtp.port,
    // Port 465 always uses implicit TLS; other ports upgrade with STARTTLS when offered.
    secure: smtp.secure || smtp.port === 465,
    ...TIMEOUTS,
  };
  if (smtp.user) options.auth = { user: smtp.user, pass: smtp.pass ?? '' };
  return options;
}

/**
 * Sends email through the SMTP server from `config.smtp`, or through `transport` when given
 * (nodemailer transport options such as `{ jsonTransport: true }`, or a transport object; used
 * by tests). The transport is created on first use; without SMTP settings `isConfigured` is
 * false and send()/verify() reject with an explanation.
 */
function createMailer(config, { transport } = {}) {
  const { smtp } = config;
  const isConfigured = Boolean(transport) || smtp.configured;
  let transporter = null;

  function getTransporter() {
    if (!isConfigured) throw new Error(NOT_CONFIGURED_MESSAGE);
    transporter ??= nodemailer.createTransport(transport ?? smtpTransportOptions(smtp), {
      from: smtp.from,
      // RFC 3834: tells auto-responders (out-of-office replies) not to answer.
      headers: { 'Auto-Submitted': 'auto-generated' },
    });
    return transporter;
  }

  return Object.freeze({
    isConfigured,
    from: smtp.from,

    /** `to` is an address or `{ name, address }`; resolves with nodemailer's result. */
    async send({ to, subject, text, html }) {
      if (!to) throw new Error('An email needs a recipient.');
      return getTransporter().sendMail({ to, subject, text, html });
    },

    /** Connects and authenticates to the SMTP server; resolves with true when that works. */
    async verify() {
      const mailTransport = getTransporter();
      if (typeof mailTransport.transporter.verify !== 'function') return true;
      return mailTransport.verify();
    },
  });
}

module.exports = { createMailer, smtpTransportOptions, NOT_CONFIGURED_MESSAGE };
