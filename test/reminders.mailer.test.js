const assert = require('node:assert/strict');
const { describe, it } = require('node:test');

const { createMailer, smtpTransportOptions } = require('../services/mailer');
const { createTestConfig } = require('./helpers/app');

describe('createMailer', () => {
  it('explains what is missing when no SMTP server is configured', async () => {
    const mailer = createMailer(createTestConfig());
    assert.equal(mailer.isConfigured, false);
    await assert.rejects(
      mailer.send({ to: 'ops@example.test', subject: 'Hello', text: 'Hello' }),
      /^Error: Email is not configured\. Set SMTP_HOST .* or SMTP_URL\.$/,
    );
    await assert.rejects(mailer.verify(), /Email is not configured/);
  });

  it('is configured by SMTP_HOST or SMTP_URL without connecting yet', () => {
    assert.equal(
      createMailer(createTestConfig({ SMTP_HOST: 'smtp.example.test' })).isConfigured,
      true,
    );
    assert.equal(
      createMailer(createTestConfig({ SMTP_URL: 'smtp://smtp.example.test' })).isConfigured,
      true,
    );
  });

  it('sends from MAIL_FROM and marks the emails as automatic', async () => {
    const config = createTestConfig({ APP_NAME: 'Family Docs' });
    const mailer = createMailer(config, { transport: { jsonTransport: true } });
    assert.equal(mailer.isConfigured, true);
    assert.equal(await mailer.verify(), true);

    const info = await mailer.send({
      to: { name: 'Ana Pop', address: 'ana@example.test' },
      subject: 'Hello',
      text: 'Plain text',
      html: '<p>Rich text</p>',
    });
    const message = JSON.parse(info.message);
    assert.deepEqual(message.from, { address: 'no-reply@localhost', name: 'Family Docs' });
    assert.deepEqual(message.to, [{ address: 'ana@example.test', name: 'Ana Pop' }]);
    assert.equal(message.subject, 'Hello');
    assert.equal(message.text, 'Plain text');
    assert.equal(message.html, '<p>Rich text</p>');
    assert.equal(message.headers['Auto-Submitted'], 'auto-generated');
    await assert.rejects(mailer.send({ subject: 'Nobody' }), /needs a recipient/);
  });
});

describe('smtpTransportOptions', () => {
  const optionsFor = (env) => smtpTransportOptions(createTestConfig(env).smtp);

  it('uses the host, port, TLS mode and credentials', () => {
    const options = optionsFor({
      SMTP_HOST: 'smtp.example.test',
      SMTP_PORT: '2525',
      SMTP_USER: 'mailer',
      SMTP_PASS: 'example-password',
    });
    assert.deepEqual(
      { host: options.host, port: options.port, secure: options.secure, auth: options.auth },
      {
        host: 'smtp.example.test',
        port: 2525,
        secure: false,
        auth: { user: 'mailer', pass: 'example-password' },
      },
    );
    assert.ok(options.connectionTimeout > 0 && options.socketTimeout > 0);
    assert.equal(optionsFor({ SMTP_HOST: 'smtp.example.test' }).auth, undefined);
  });

  it('uses implicit TLS on port 465 or when SMTP_SECURE is set', () => {
    assert.equal(optionsFor({ SMTP_HOST: 'smtp.example.test', SMTP_PORT: '465' }).secure, true);
    assert.equal(optionsFor({ SMTP_HOST: 'smtp.example.test', SMTP_SECURE: 'true' }).secure, true);
  });

  it('prefers SMTP_URL', () => {
    const options = optionsFor({
      SMTP_URL: 'smtps://mailer:example-password@smtp.example.test',
      SMTP_HOST: 'ignored.example.test',
    });
    assert.equal(options.url, 'smtps://mailer:example-password@smtp.example.test');
    assert.equal(options.host, undefined);
  });
});
