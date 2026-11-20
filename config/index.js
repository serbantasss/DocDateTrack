const net = require('node:net');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');
const LOG_FORMATS = ['combined', 'common', 'dev', 'short', 'tiny', 'none'];
const TRUST_PROXY_PRESETS = ['loopback', 'linklocal', 'uniquelocal'];
const TRUE_VALUES = ['true', '1', 'yes'];
const FALSE_VALUES = ['false', '0', 'no'];

class ConfigError extends Error {
  constructor(problems) {
    super(`Invalid configuration:\n${problems.map((problem) => `  - ${problem}`).join('\n')}`);
    this.name = 'ConfigError';
    this.problems = problems;
  }
}

function deepFreeze(object) {
  for (const value of Object.values(object)) {
    if (value && typeof value === 'object') deepFreeze(value);
  }
  return Object.freeze(object);
}

function isValidProxyEntry(entry) {
  if (TRUST_PROXY_PRESETS.includes(entry)) return true;
  const [address, prefix, ...rest] = entry.split('/');
  const family = net.isIP(address);
  if (!family || rest.length > 0) return false;
  if (prefix === undefined) return true;
  if (family === 4 && net.isIPv4(prefix)) return true;
  return /^\d+$/.test(prefix) && Number(prefix) <= (family === 4 ? 32 : 128);
}

function isValidLocale(locale) {
  try {
    return Intl.DateTimeFormat.supportedLocalesOf([locale]).length > 0;
  } catch {
    return false;
  }
}

function formatMailbox(name, address) {
  const needsQuotes = /[()<>[\]:;@\\,."]/.test(name);
  return needsQuotes ? `"${name.replace(/["\\]/g, '\\$&')}" <${address}>` : `${name} <${address}>`;
}

/**
 * Reads and validates the configuration from environment variables (see .env.example).
 * Throws a ConfigError listing every problem; returns a deep-frozen object.
 */
function loadConfig(env = process.env, { requireSessionSecret = true } = {}) {
  const problems = [];

  const read = (name) => {
    const value = env[name];
    if (value === undefined || value === null) return undefined;
    const trimmed = String(value).trim();
    return trimmed === '' ? undefined : trimmed;
  };

  const readBoolean = (name, fallback) => {
    const raw = read(name);
    if (raw === undefined) return fallback;
    const value = raw.toLowerCase();
    if (TRUE_VALUES.includes(value)) return true;
    if (FALSE_VALUES.includes(value)) return false;
    problems.push(`${name} must be true or false (also accepted: 1/0, yes/no), got "${raw}".`);
    return fallback;
  };

  const readInteger = (name, fallback, { min, max }) => {
    const raw = read(name);
    if (raw === undefined) return fallback;
    const value = Number(raw);
    if (!/^-?\d+$/.test(raw) || value < min || value > max) {
      problems.push(`${name} must be a whole number between ${min} and ${max}, got "${raw}".`);
      return fallback;
    }
    return value;
  };

  const readPositiveNumber = (name, fallback, { max }) => {
    const raw = read(name);
    if (raw === undefined) return fallback;
    const value = Number(raw);
    if (!/^\d+(\.\d+)?$/.test(raw) || value <= 0 || value > max) {
      problems.push(`${name} must be a number greater than 0 and at most ${max}, got "${raw}".`);
      return fallback;
    }
    return value;
  };

  const nodeEnv = read('NODE_ENV') ?? 'development';
  const isProduction = nodeEnv === 'production';
  const isTest = nodeEnv === 'test';

  const port = readInteger('PORT', 8080, { min: 0, max: 65535 });

  const mongodbUri = read('MONGODB_URI') ?? null;
  if (!mongodbUri) {
    problems.push('MONGODB_URI is required (for example mongodb://127.0.0.1:27017/docdatetrack).');
  } else if (!/^mongodb(\+srv)?:\/\//.test(mongodbUri)) {
    problems.push('MONGODB_URI must start with mongodb:// or mongodb+srv://.');
  }

  const sessionSecret = read('SESSION_SECRET') ?? null;
  if (requireSessionSecret) {
    if (!sessionSecret) {
      problems.push('SESSION_SECRET is required. Generate one with: openssl rand -hex 32');
    } else if (isProduction && sessionSecret.length < 32) {
      problems.push('SESSION_SECRET must be at least 32 characters long in production.');
    }
  }

  let cookieSecure = 'auto';
  const rawCookieSecure = read('COOKIE_SECURE');
  if (rawCookieSecure !== undefined && rawCookieSecure.toLowerCase() !== 'auto') {
    const value = rawCookieSecure.toLowerCase();
    if (TRUE_VALUES.includes(value)) cookieSecure = true;
    else if (FALSE_VALUES.includes(value)) cookieSecure = false;
    else problems.push(`COOKIE_SECURE must be auto, true or false, got "${rawCookieSecure}".`);
  }

  let trustProxy = false;
  const rawTrustProxy = read('TRUST_PROXY');
  if (rawTrustProxy !== undefined) {
    const value = rawTrustProxy.toLowerCase();
    if (['true', 'yes'].includes(value)) {
      trustProxy = true;
    } else if (['false', 'no'].includes(value)) {
      trustProxy = false;
    } else if (/^\d+$/.test(value)) {
      trustProxy = Number(value) === 0 ? false : Number(value);
    } else {
      const entries = rawTrustProxy
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean);
      if (entries.length === 0 || !entries.every(isValidProxyEntry)) {
        problems.push(
          'TRUST_PROXY must be false, true, a hop count, or a comma-separated list of IP ' +
            `addresses/subnets (or loopback, linklocal, uniquelocal), got "${rawTrustProxy}".`,
        );
      } else {
        trustProxy = entries;
      }
    }
  }

  const appName = read('APP_NAME') ?? 'DocDateTrack';
  if (appName.length > 100) problems.push('APP_NAME must be at most 100 characters long.');

  let appUrl = `http://localhost:${port}`;
  const rawAppUrl = read('APP_URL');
  if (rawAppUrl !== undefined) {
    const url = URL.canParse(rawAppUrl) ? new URL(rawAppUrl) : null;
    if (!url || !['http:', 'https:'].includes(url.protocol) || url.search || url.hash) {
      problems.push(
        `APP_URL must be an absolute http(s) URL such as https://docs.example.com, got "${rawAppUrl}".`,
      );
    } else {
      appUrl = rawAppUrl.replace(/\/+$/, '');
    }
  }

  const dateLocale = read('DATE_LOCALE') ?? 'en-GB';
  if (!isValidLocale(dateLocale)) {
    problems.push(
      `DATE_LOCALE must be a supported locale such as en-GB or en-US, got "${dateLocale}".`,
    );
  }

  const smtpUrl = read('SMTP_URL') ?? null;
  if (smtpUrl && !/^smtps?:\/\//.test(smtpUrl)) {
    problems.push('SMTP_URL must start with smtp:// or smtps://.');
  }
  const smtpHost = read('SMTP_HOST') ?? null;

  const sslKeyPath = read('SSL_KEY_PATH');
  const sslCertPath = read('SSL_CERT_PATH');
  if (Boolean(sslKeyPath) !== Boolean(sslCertPath)) {
    problems.push('Set both SSL_KEY_PATH and SSL_CERT_PATH to enable HTTPS, or neither.');
  }
  const httpsEnabled = Boolean(sslKeyPath && sslCertPath);

  const defaultLogFormat = isTest ? 'none' : nodeEnv === 'development' ? 'dev' : 'combined';
  const logFormat = read('LOG_FORMAT') ?? defaultLogFormat;
  if (!LOG_FORMATS.includes(logFormat) && !logFormat.includes(':')) {
    problems.push(
      `LOG_FORMAT must be one of ${LOG_FORMATS.join(', ')} or a custom morgan format, got "${logFormat}".`,
    );
  }

  const config = {
    env: nodeEnv,
    isProduction,
    isTest,
    port,
    mongodbUri,
    session: {
      secret: sessionSecret,
      ttlHours: readPositiveNumber('SESSION_TTL_HOURS', 12, { max: 24 * 365 }),
      cookieSecure,
    },
    trustProxy,
    appName,
    appUrl,
    allowRegistration: readBoolean('ALLOW_REGISTRATION', false),
    uploads: {
      dir: path.resolve(ROOT_DIR, read('UPLOAD_DIR') ?? 'uploads'),
      maxBytes: Math.round(readPositiveNumber('MAX_UPLOAD_MB', 10, { max: 1024 }) * 1024 * 1024),
    },
    expiryWarningDays: readInteger('EXPIRY_WARNING_DAYS', 30, { min: 0, max: 3650 }),
    dateLocale,
    reminders: {
      enabled: readBoolean('REMINDERS_ENABLED', false),
      cron: read('REMINDER_CRON') ?? '0 8 * * *',
      notifyOwners: readBoolean('NOTIFY_OWNERS', false),
    },
    smtp: {
      url: smtpUrl,
      host: smtpHost,
      port: readInteger('SMTP_PORT', 587, { min: 1, max: 65535 }),
      secure: readBoolean('SMTP_SECURE', false),
      user: read('SMTP_USER') ?? null,
      pass: read('SMTP_PASS') ?? null,
      from: read('MAIL_FROM') ?? formatMailbox(appName, 'no-reply@localhost'),
      configured: Boolean(smtpUrl || smtpHost),
    },
    https: {
      enabled: httpsEnabled,
      keyPath: httpsEnabled ? path.resolve(ROOT_DIR, sslKeyPath) : null,
      certPath: httpsEnabled ? path.resolve(ROOT_DIR, sslCertPath) : null,
      port: readInteger('PORT_HTTPS', 8443, { min: 0, max: 65535 }),
    },
    logFormat,
  };

  if (problems.length > 0) throw new ConfigError(problems);
  return deepFreeze(config);
}

module.exports = { loadConfig, ConfigError, ROOT_DIR };
