const assert = require('node:assert/strict');
const path = require('node:path');
const { describe, it } = require('node:test');

const { ConfigError, ROOT_DIR, loadConfig } = require('../config');

const BASE_ENV = {
  MONGODB_URI: 'mongodb://127.0.0.1:27099/docdatetrack_test',
  SESSION_SECRET: 'a-test-secret',
};

function load(overrides = {}, options) {
  return loadConfig({ ...BASE_ENV, ...overrides }, options);
}

function problemsOf(env, options) {
  try {
    loadConfig(env, options);
  } catch (error) {
    assert.ok(error instanceof ConfigError);
    return error.problems;
  }
  assert.fail('expected loadConfig() to throw');
}

describe('loadConfig', () => {
  it('applies the documented defaults', () => {
    const config = load();
    assert.equal(config.env, 'development');
    assert.equal(config.isProduction, false);
    assert.equal(config.isTest, false);
    assert.equal(config.port, 8080);
    assert.equal(config.mongodbUri, BASE_ENV.MONGODB_URI);
    assert.deepEqual(config.session, {
      secret: 'a-test-secret',
      ttlHours: 12,
      cookieSecure: 'auto',
    });
    assert.equal(config.trustProxy, false);
    assert.equal(config.appName, 'DocDateTrack');
    assert.equal(config.appUrl, 'http://localhost:8080');
    assert.equal(config.allowRegistration, false);
    assert.deepEqual(config.uploads, {
      dir: path.join(ROOT_DIR, 'uploads'),
      maxBytes: 10 * 1024 * 1024,
    });
    assert.equal(config.expiryWarningDays, 30);
    assert.equal(config.dateLocale, 'en-GB');
    assert.deepEqual(config.reminders, { enabled: false, cron: '0 8 * * *', notifyOwners: false });
    assert.deepEqual(config.smtp, {
      url: null,
      host: null,
      port: 587,
      secure: false,
      user: null,
      pass: null,
      from: 'DocDateTrack <no-reply@localhost>',
      configured: false,
    });
    assert.deepEqual(config.https, { enabled: false, keyPath: null, certPath: null, port: 8443 });
    assert.equal(config.logFormat, 'dev');
  });

  it('returns a deep-frozen object', () => {
    const config = load();
    assert.ok(Object.isFrozen(config));
    assert.ok(Object.isFrozen(config.session));
    assert.equal(Reflect.set(config.session, 'secret', 'changed'), false);
    assert.equal(config.session.secret, 'a-test-secret');
  });

  it('treats empty values as unset and trims values', () => {
    const config = load({ PORT: '', APP_NAME: '  Family Docs  ', SMTP_HOST: '   ' });
    assert.equal(config.port, 8080);
    assert.equal(config.appName, 'Family Docs');
    assert.equal(config.smtp.host, null);
  });

  it('parses booleans case-insensitively', () => {
    const config = load({
      ALLOW_REGISTRATION: 'YES',
      REMINDERS_ENABLED: '1',
      NOTIFY_OWNERS: 'True',
      SMTP_SECURE: 'no',
    });
    assert.equal(config.allowRegistration, true);
    assert.equal(config.reminders.enabled, true);
    assert.equal(config.reminders.notifyOwners, true);
    assert.equal(config.smtp.secure, false);
  });

  it('parses numbers and converts the upload limit to bytes', () => {
    const config = load({
      PORT: '3000',
      SESSION_TTL_HOURS: '0.5',
      MAX_UPLOAD_MB: '2.5',
      EXPIRY_WARNING_DAYS: '0',
      SMTP_PORT: '465',
      PORT_HTTPS: '3443',
    });
    assert.equal(config.port, 3000);
    assert.equal(config.appUrl, 'http://localhost:3000');
    assert.equal(config.session.ttlHours, 0.5);
    assert.equal(config.uploads.maxBytes, 2.5 * 1024 * 1024);
    assert.equal(config.expiryWarningDays, 0);
    assert.equal(config.smtp.port, 465);
    assert.equal(config.https.port, 3443);
  });

  it('reports every problem in a single error', () => {
    const problems = problemsOf({
      PORT: 'eighty',
      MAX_UPLOAD_MB: '-1',
      EXPIRY_WARNING_DAYS: '1.5',
      ALLOW_REGISTRATION: 'maybe',
      SESSION_TTL_HOURS: '0',
    });
    assert.equal(problems.length, 7);
    for (const name of [
      'MONGODB_URI',
      'SESSION_SECRET',
      'PORT',
      'MAX_UPLOAD_MB',
      'EXPIRY_WARNING_DAYS',
      'ALLOW_REGISTRATION',
      'SESSION_TTL_HOURS',
    ]) {
      assert.ok(
        problems.some((problem) => problem.startsWith(name)),
        `missing problem for ${name}`,
      );
    }
    assert.throws(() => loadConfig({}), /Invalid configuration:\n {2}- MONGODB_URI/);
  });

  it('validates the MongoDB URI scheme', () => {
    assert.match(problemsOf({ ...BASE_ENV, MONGODB_URI: 'http://db' })[0], /MONGODB_URI/);
    const srvUri = 'mongodb+srv://db.example.com/app';
    assert.equal(load({ MONGODB_URI: srvUri }).mongodbUri, srvUri);
  });

  it('only requires the session secret when asked to', () => {
    const config = loadConfig(
      { MONGODB_URI: BASE_ENV.MONGODB_URI },
      { requireSessionSecret: false },
    );
    assert.equal(config.session.secret, null);
  });

  it('requires a 32+ character session secret in production', () => {
    assert.match(problemsOf({ ...BASE_ENV, NODE_ENV: 'production' })[0], /at least 32/);
    const config = load({ NODE_ENV: 'production', SESSION_SECRET: 'x'.repeat(32) });
    assert.equal(config.isProduction, true);
    assert.equal(config.logFormat, 'combined');
  });

  it('chooses the log format from the environment', () => {
    assert.equal(load({ NODE_ENV: 'test' }).logFormat, 'none');
    assert.equal(load({ NODE_ENV: 'test' }).isTest, true);
    assert.equal(load({ LOG_FORMAT: 'tiny' }).logFormat, 'tiny');
    assert.equal(load({ LOG_FORMAT: ':method :url' }).logFormat, ':method :url');
    assert.match(problemsOf({ ...BASE_ENV, LOG_FORMAT: 'verbose' })[0], /LOG_FORMAT/);
  });

  it('parses COOKIE_SECURE', () => {
    assert.equal(load({ COOKIE_SECURE: 'AUTO' }).session.cookieSecure, 'auto');
    assert.equal(load({ COOKIE_SECURE: 'true' }).session.cookieSecure, true);
    assert.equal(load({ COOKIE_SECURE: '0' }).session.cookieSecure, false);
    assert.match(problemsOf({ ...BASE_ENV, COOKIE_SECURE: 'always' })[0], /COOKIE_SECURE/);
  });

  it('parses TRUST_PROXY', () => {
    assert.equal(load({ TRUST_PROXY: 'true' }).trustProxy, true);
    assert.equal(load({ TRUST_PROXY: 'false' }).trustProxy, false);
    assert.equal(load({ TRUST_PROXY: '0' }).trustProxy, false);
    assert.equal(load({ TRUST_PROXY: '1' }).trustProxy, 1);
    assert.equal(load({ TRUST_PROXY: '2' }).trustProxy, 2);
    assert.deepEqual(load({ TRUST_PROXY: 'loopback, 10.0.0.0/8,fd00::/8' }).trustProxy, [
      'loopback',
      '10.0.0.0/8',
      'fd00::/8',
    ]);
    assert.deepEqual(load({ TRUST_PROXY: '192.168.1.0/255.255.255.0' }).trustProxy, [
      '192.168.1.0/255.255.255.0',
    ]);
    assert.match(problemsOf({ ...BASE_ENV, TRUST_PROXY: 'my-proxy' })[0], /TRUST_PROXY/);
    assert.match(problemsOf({ ...BASE_ENV, TRUST_PROXY: '10.0.0.0/33' })[0], /TRUST_PROXY/);
  });

  it('normalizes and validates APP_URL', () => {
    assert.equal(load({ APP_URL: 'https://docs.example.com/' }).appUrl, 'https://docs.example.com');
    assert.match(problemsOf({ ...BASE_ENV, APP_URL: 'docs.example.com' })[0], /APP_URL/);
    assert.match(problemsOf({ ...BASE_ENV, APP_URL: 'ftp://docs.example.com' })[0], /APP_URL/);
  });

  it('resolves UPLOAD_DIR against the project directory', () => {
    assert.equal(load({ UPLOAD_DIR: 'data/files' }).uploads.dir, path.join(ROOT_DIR, 'data/files'));
    const absolute = path.join(path.parse(ROOT_DIR).root, 'srv', 'docdatetrack');
    assert.equal(load({ UPLOAD_DIR: absolute }).uploads.dir, absolute);
  });

  it('validates DATE_LOCALE', () => {
    assert.equal(load({ DATE_LOCALE: 'en-US' }).dateLocale, 'en-US');
    assert.match(problemsOf({ ...BASE_ENV, DATE_LOCALE: 'not a locale!' })[0], /DATE_LOCALE/);
  });

  it('derives the SMTP settings', () => {
    assert.equal(load({ SMTP_HOST: 'smtp.example.com' }).smtp.configured, true);
    assert.equal(load({ SMTP_URL: 'smtps://user:pass@smtp.example.com' }).smtp.configured, true);
    assert.match(problemsOf({ ...BASE_ENV, SMTP_URL: 'mail.example.com' })[0], /SMTP_URL/);
    assert.equal(load({ APP_NAME: 'Family Docs' }).smtp.from, 'Family Docs <no-reply@localhost>');
    assert.equal(load({ APP_NAME: 'Acme, Inc.' }).smtp.from, '"Acme, Inc." <no-reply@localhost>');
    assert.equal(
      load({ MAIL_FROM: 'Docs <docs@example.com>' }).smtp.from,
      'Docs <docs@example.com>',
    );
  });

  it('requires both TLS paths for HTTPS', () => {
    assert.match(problemsOf({ ...BASE_ENV, SSL_KEY_PATH: 'ssl/key.pem' })[0], /SSL_CERT_PATH/);
    const certPath = path.resolve('/etc/ssl/cert.pem');
    const config = load({ SSL_KEY_PATH: 'ssl/key.pem', SSL_CERT_PATH: certPath });
    assert.deepEqual(config.https, {
      enabled: true,
      keyPath: path.join(ROOT_DIR, 'ssl/key.pem'),
      certPath,
      port: 8443,
    });
  });
});
