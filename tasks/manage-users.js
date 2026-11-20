#!/usr/bin/env node
/**
 * Manages user accounts from the command line, e.g. to regain access when the only administrator
 * has forgotten the password. See USAGE below or run `npm run users -- --help`.
 */
const crypto = require('node:crypto');
const { parseArgs } = require('node:util');
const { validationResult } = require('express-validator');
const mongoose = require('mongoose');

const { ConfigError, loadConfig } = require('../config');
const { createAccount, emailRule, usernameRule } = require('../controllers/userForms');
const { createFormatter } = require('../lib/format');
const User = require('../models/user');

const USAGE = `Usage: npm run users -- <command> [arguments]

Manages the user accounts in the database configured by MONGODB_URI, for example to regain
access when the only administrator has forgotten the password.

Commands:
  list                             List the users with their role and last sign-in
  reset-password <username|email>  Set a new random password and sign the user out everywhere
  create-admin <username> <email>  Create an administrator with a random password
  promote <username|email>         Make an existing user an administrator

Options:
  -h, --help                       Show this help

New passwords are shown only once. Sign in with them and choose a new password on the
Account page.`;

class UsageError extends Error {}

/** A problem with the input or the data (unknown user, invalid or taken values): exit code 1. */
class CommandError extends Error {}

/** A strong random password: 20 URL-safe characters (120 bits). */
function generatePassword() {
  return crypto.randomBytes(15).toString('base64url');
}

/** The user with this username or email address (case-insensitive). */
async function findByLogin(login) {
  const user = await User.findByUsername(login.trim());
  if (!user) throw new CommandError(`No user has the username or email address "${login}".`);
  return user;
}

function listUsers() {
  return User.find().sort({ username: 1 });
}

/** Sets a random password. Saving it increments the session version: all sessions end. */
async function resetPassword(login) {
  const user = await findByLogin(login);
  const password = generatePassword();
  await user.setPassword(password);
  await user.save();
  return { user, password };
}

/** Creates an administrator with a random password; validated like the forms of the app. */
async function createAdmin(username, email) {
  const req = { body: { username, email } };
  for (const rule of [usernameRule(), emailRule()]) await rule.run(req);
  const errors = validationResult(req).mapped();
  const password = generatePassword();
  const user = await createAccount({ ...req.body, role: 'admin' }, password, errors);
  if (!user) {
    const problems = Object.values(errors).map((error) => error.msg);
    throw new CommandError(`Cannot create the administrator: ${problems.join(' ')}`);
  }
  return { user, password };
}

/** Makes the user an administrator; `changed` is false when they already are one. */
async function promoteUser(login) {
  const user = await findByLogin(login);
  if (user.role === 'admin') return { user, changed: false };
  user.role = 'admin';
  await user.save();
  return { user, changed: true };
}

function formatUsers(users, fmt) {
  const rows = [
    ['USERNAME', 'EMAIL', 'ROLE', 'LAST SIGN-IN'],
    ...users.map((user) => [
      user.username,
      user.email,
      user.role,
      user.last_login_at ? fmt.dateTime(user.last_login_at) : 'never',
    ]),
  ];
  const widths = rows[0].map((_, column) => Math.max(...rows.map((row) => row[column].length)));
  return rows
    .map((row) =>
      row
        .map((cell, column) => cell.padEnd(widths[column]))
        .join('  ')
        .trimEnd(),
    )
    .join('\n');
}

function accountPageHint(config) {
  return `Sign in with it and choose a new password on the Account page: ${config.appUrl}/account`;
}

const COMMANDS = {
  list: {
    params: [],
    async run(params, { config, output }) {
      const users = await listUsers();
      output.log(
        users.length > 0
          ? formatUsers(users, createFormatter({ locale: config.dateLocale }))
          : 'There are no users yet. Create an administrator with: ' +
              'npm run users -- create-admin <username> <email>',
      );
    },
  },
  'reset-password': {
    params: ['<username|email>'],
    async run([login], { config, output }) {
      const { user, password } = await resetPassword(login);
      output.log(`New password for ${user.username}: ${password}`);
      output.log(`All sessions of ${user.username} have been signed out.`);
      output.log(accountPageHint(config));
    },
  },
  'create-admin': {
    params: ['<username>', '<email>'],
    async run([username, email], { config, output }) {
      const { user, password } = await createAdmin(username, email);
      output.log(`Created the administrator ${user.username} (${user.email}).`);
      output.log(`Password: ${password}`);
      output.log(accountPageHint(config));
    },
  },
  promote: {
    params: ['<username|email>'],
    async run([login], { output }) {
      const { user, changed } = await promoteUser(login);
      output.log(
        changed
          ? `${user.username} is now an administrator.`
          : `${user.username} is already an administrator.`,
      );
    },
  },
};

/** Returns `{ command: 'help' }` or `{ command, params }`. */
function parseCliArgs(args) {
  let parsed;
  try {
    parsed = parseArgs({
      args,
      options: { help: { type: 'boolean', short: 'h' } },
      strict: true,
      allowPositionals: true,
    });
  } catch (error) {
    throw new UsageError(error.message);
  }
  const [command, ...params] = parsed.positionals;
  if (parsed.values.help || command === 'help') return { command: 'help' };
  if (!command) throw new UsageError('Missing command.');
  if (!Object.hasOwn(COMMANDS, command)) throw new UsageError(`Unknown command "${command}".`);
  const expected = COMMANDS[command].params;
  if (params.length !== expected.length) {
    throw new UsageError(`Usage: npm run users -- ${[command, ...expected].join(' ')}`);
  }
  return { command, params };
}

/**
 * Runs a parsed command on the open mongoose connection. Resolves with the exit code and
 * reports CommandErrors on `output`.
 */
async function runCommand({ command, params }, { config, output = console }) {
  try {
    await COMMANDS[command].run(params, { config, output });
    return 0;
  } catch (error) {
    if (!(error instanceof CommandError)) throw error;
    output.error(error.message);
    return 1;
  }
}

/**
 * Runs the command for `args` (process.argv without node and the script) and resolves with the
 * exit code.
 */
async function main(args, { env = process.env, output = console } = {}) {
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

  try {
    // Indexes and collections are the server's job.
    await mongoose.connect(config.mongodbUri, {
      autoCreate: false,
      autoIndex: false,
      serverSelectionTimeoutMS: 10_000,
    });
  } catch (error) {
    output.error(`Unable to connect to MongoDB: ${error.message}`);
    return 1;
  }
  try {
    return await runCommand(options, { config, output });
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
      console.error(`The command failed: ${error.message}`);
      process.exitCode = 1;
    },
  );
}

module.exports = {
  USAGE,
  UsageError,
  CommandError,
  generatePassword,
  listUsers,
  resetPassword,
  createAdmin,
  promoteUser,
  formatUsers,
  parseCliArgs,
  runCommand,
  main,
};
