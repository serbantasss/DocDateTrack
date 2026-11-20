const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const path = require('node:path');
const { after, before, beforeEach, describe, it } = require('node:test');
const { promisify } = require('node:util');
const mongoose = require('mongoose');

const User = require('../models/user');
const {
  CommandError,
  USAGE,
  UsageError,
  createAdmin,
  generatePassword,
  main,
  parseCliArgs,
  promoteUser,
  resetPassword,
  runCommand,
} = require('../tasks/manage-users');
const {
  TEST_PASSWORD,
  createTestApp,
  createTestConfig,
  createUser,
  loginAgent,
} = require('./helpers/app');
const { clearTestDb, getTestDbUri, startTestDb, stopTestDb } = require('./helpers/db');

const execFileAsync = promisify(execFile);
const SCRIPT = path.join(__dirname, '..', 'tasks', 'manage-users.js');
// main() returns before connecting to this database in every test that uses it.
const UNUSED_DB = { NODE_ENV: 'test', MONGODB_URI: 'mongodb://127.0.0.1:9/unused' };

function createOutput() {
  const lines = { log: [], error: [] };
  return {
    log: (...args) => lines.log.push(args.join(' ')),
    error: (...args) => lines.error.push(args.join(' ')),
    text: (level) => lines[level].join('\n'),
  };
}

async function canSignIn(username, password) {
  return Boolean((await User.authenticate()(username, password)).user);
}

before(startTestDb);
after(stopTestDb);
beforeEach(clearTestDb);

describe('users command line', () => {
  it('parses the commands and rejects wrong usage', () => {
    assert.deepEqual(parseCliArgs(['--help']), { command: 'help' });
    assert.deepEqual(parseCliArgs(['help']), { command: 'help' });
    assert.deepEqual(parseCliArgs(['list']), { command: 'list', params: [] });
    assert.deepEqual(parseCliArgs(['create-admin', 'ada', 'ada@example.test']), {
      command: 'create-admin',
      params: ['ada', 'ada@example.test'],
    });
    const wrong = [[], ['delete', 'ada'], ['list', 'extra'], ['promote'], ['list', '--force']];
    for (const args of wrong) assert.throws(() => parseCliArgs(args), UsageError, args.join(' '));
  });

  it('shows the help and reports usage and configuration errors', async () => {
    const help = createOutput();
    assert.equal(await main(['--help'], { env: UNUSED_DB, output: help }), 0);
    assert.equal(help.text('log'), USAGE);

    const usage = createOutput();
    assert.equal(await main(['reset-password'], { env: UNUSED_DB, output: usage }), 1);
    assert.match(usage.text('error'), /^Usage: npm run users -- reset-password <username\|email>/);

    const config = createOutput();
    assert.equal(await main(['list'], { env: { MONGODB_URI: 'localhost' }, output: config }), 1);
    assert.match(config.text('error'), /MONGODB_URI/);
  });

  it('runs as a script against the configured database', async () => {
    await createUser({ username: 'ada', email: 'ada@example.test', role: 'admin' });
    const uri = new URL(getTestDbUri());
    uri.pathname = `/${mongoose.connection.name}`;
    const env = { PATH: process.env.PATH, NODE_ENV: 'test', MONGODB_URI: uri.href };
    const run = (...args) => execFileAsync(process.execPath, [SCRIPT, ...args], { env });

    const list = await run('list');
    assert.equal(list.stderr, '');
    assert.match(
      list.stdout,
      /^USERNAME +EMAIL +ROLE +LAST SIGN-IN\nada +ada@example\.test +admin +never\n$/,
    );

    const reset = await run('reset-password', 'ADA');
    const password = /^New password for ada: ([\w-]{20})$/m.exec(reset.stdout)[1];
    assert.equal(await canSignIn('ada', password), true);

    await assert.rejects(run('promote', 'nobody'), (error) => {
      assert.equal(error.code, 1);
      assert.equal(error.stdout, '');
      assert.match(error.stderr, /No user has the username or email address "nobody"\./);
      return true;
    });
  });
});

describe('users commands', () => {
  const config = createTestConfig();

  it('list the users, or explain how to create the first administrator', async () => {
    const empty = createOutput();
    assert.equal(await runCommand({ command: 'list', params: [] }, { config, output: empty }), 0);
    assert.match(empty.text('log'), /create-admin <username> <email>/);

    await createUser({ username: 'mia', email: 'mia@example.test' });
    await createUser({ username: 'ada', email: 'ada@example.test', role: 'admin' });
    await User.updateOne({ username: 'ada' }, { last_login_at: new Date() });
    const output = createOutput();
    assert.equal(await runCommand({ command: 'list', params: [] }, { config, output }), 0);
    const [header, first, second] = output.text('log').split('\n');
    assert.match(header, /^USERNAME +EMAIL +ROLE +LAST SIGN-IN$/);
    assert.match(first, /^ada +ada@example\.test +admin +\d/);
    assert.match(second, /^mia +mia@example\.test +member +never$/);
  });

  it('generate strong random passwords', () => {
    const passwords = new Set(Array.from({ length: 50 }, generatePassword));
    assert.equal(passwords.size, 50);
    for (const password of passwords) assert.match(password, /^[\w-]{20}$/);
  });

  it('reset a password, sign the user out everywhere and print the password once', async () => {
    await createUser({ username: 'ada', email: 'ada@example.test', role: 'admin' });
    const { app } = createTestApp();
    const agent = await loginAgent(app, { username: 'ada' });

    const output = createOutput();
    const command = { command: 'reset-password', params: [' Ada@Example.test '] };
    assert.equal(await runCommand(command, { config, output }), 0);
    const text = output.text('log');
    const password = /^New password for ada: (\S+)$/m.exec(text)[1];
    assert.equal(text.split(password).length, 2, 'the password is printed once');
    assert.ok(text.includes(`${config.appUrl}/account`));
    assert.equal(output.text('error'), '');

    assert.equal((await User.findOne({ username: 'ada' })).session_version, 1);
    assert.equal((await agent.get('/account')).headers.location, '/login');
    assert.equal(await canSignIn('ada', password), true);
    assert.equal(await canSignIn('ada', TEST_PASSWORD), false);
  });

  it('create administrators with the validation rules of the app', async () => {
    const { user, password } = await createAdmin(' Ada.Admin ', 'Ada@Example.test');
    assert.equal(user.username, 'ada.admin');
    assert.equal(user.email, 'ada@example.test');
    assert.equal(user.role, 'admin');
    assert.equal(await canSignIn('ada.admin', password), true);

    for (const [username, email, problem] of [
      ['ADA.admin', 'other@example.test', /This username is already taken\./],
      ['other', 'ADA@example.test', /An account with this email address already exists\./],
      ['ab', 'ab@example.test', /3–50 characters/],
      ['new admin', 'new@example.test', /may only contain/],
      ['new.admin', 'not-an-email', /Enter a valid email address\./],
    ]) {
      await assert.rejects(createAdmin(username, email), (error) => {
        assert.ok(error instanceof CommandError);
        assert.match(error.message, problem);
        return true;
      });
    }
    assert.equal(await User.countDocuments(), 1);

    const output = createOutput();
    const command = { command: 'create-admin', params: ['root', 'root@example.test'] };
    assert.equal(await runCommand(command, { config, output }), 0);
    const printed = /^Password: (\S+)$/m.exec(output.text('log'))[1];
    assert.equal(await canSignIn('root', printed), true);
  });

  it('promote existing users and report unknown ones', async () => {
    await createUser({ username: 'mia', email: 'mia@example.test' });
    const promoted = await promoteUser('MIA@example.test');
    assert.equal(promoted.changed, true);
    assert.equal((await User.findOne({ username: 'mia' })).role, 'admin');
    assert.equal((await promoteUser('mia')).changed, false);

    await assert.rejects(resetPassword('nobody'), CommandError);
    const output = createOutput();
    const command = { command: 'promote', params: ['nobody'] };
    assert.equal(await runCommand(command, { config, output }), 1);
    assert.match(output.text('error'), /No user has the username or email address "nobody"\./);
  });
});
