const session = require('express-session');
const request = require('supertest');

const { createApp } = require('../../app');
const { loadConfig } = require('../../config');
const User = require('../../models/user');
const { getTestDbUri } = require('./db');
const { makeTempDir } = require('./tmp');

const TEST_PASSWORD = 'correct-horse-battery-staple';
const TEST_SESSION_SECRET = 'test-session-secret-0123456789abcdef';

let userSequence = 0;

/**
 * Builds a config for tests. `overrides` are environment-style variables (strings), e.g.
 * `{ ALLOW_REGISTRATION: 'true' }`. UPLOAD_DIR defaults to a fresh temporary directory.
 */
function createTestConfig(overrides = {}) {
  return loadConfig({
    NODE_ENV: 'test',
    MONGODB_URI: getTestDbUri() ?? 'mongodb://127.0.0.1/docdatetrack_test',
    SESSION_SECRET: TEST_SESSION_SECRET,
    UPLOAD_DIR: makeTempDir('uploads-'),
    ...overrides,
  });
}

/**
 * Creates an app with a test config, in-memory sessions and rate limiting disabled.
 * `options` are passed to createApp() (e.g. `{ sessionStore, authRateLimit: { limit: 2 } }`).
 */
function createTestApp(overrides = {}, options = {}) {
  const config = createTestConfig(overrides);
  const app = createApp({
    config,
    sessionStore: new session.MemoryStore(),
    authRateLimit: false,
    ...options,
  });
  return { app, config };
}

async function createUser({
  username,
  email,
  password = TEST_PASSWORD,
  role = 'member',
  display_name,
} = {}) {
  userSequence += 1;
  const name = username ?? `user${userSequence}`;
  return User.register(
    new User({ username: name, email: email ?? `${name}@example.test`, role, display_name }),
    password,
  );
}

async function getCsrfToken(agent) {
  const response = await agent.get('/csrf-token').expect(200);
  return response.body.token;
}

/** Returns a supertest agent signed in as the given user (throws when the sign-in fails). */
async function loginAgent(app, { username, password = TEST_PASSWORD } = {}) {
  const agent = request.agent(app);
  // Fetch the token first: supertest attaches the agent's cookies when a request is created.
  const _csrf = await getCsrfToken(agent);
  const response = await agent.post('/login').type('form').send({ username, password, _csrf });
  if (response.status !== 302 || response.headers.location === '/login') {
    throw new Error(`Signing in as "${username}" failed (status ${response.status}).`);
  }
  return agent;
}

module.exports = {
  TEST_PASSWORD,
  createTestConfig,
  createTestApp,
  createUser,
  getCsrfToken,
  loginAgent,
};
