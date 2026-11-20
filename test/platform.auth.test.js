const assert = require('node:assert/strict');
const { after, before, beforeEach, describe, it } = require('node:test');
const session = require('express-session');
const request = require('supertest');

const User = require('../models/user');
const { safeReturnTo } = require('../middleware/auth');
const {
  TEST_PASSWORD,
  createTestApp,
  createUser,
  getCsrfToken,
  loginAgent,
} = require('./helpers/app');
const { clearTestDb, startTestDb, stopTestDb } = require('./helpers/db');

const VALID_REGISTRATION = {
  username: 'Jane.Doe',
  email: 'Jane@Example.test',
  display_name: 'Jane Doe',
  password: 'a-very-long-password',
  password_confirm: 'a-very-long-password',
};

async function isSignedIn(agent) {
  const response = await agent.get('/account');
  return !(response.status === 302 && response.headers.location === '/login');
}

async function postForm(agent, url, fields, expectedStatus, headers = {}) {
  const _csrf = await getCsrfToken(agent);
  const response = await agent
    .post(url)
    .set(headers)
    .type('form')
    .send({ ...fields, _csrf });
  if (expectedStatus !== undefined) assert.equal(response.status, expectedStatus, `POST ${url}`);
  return response;
}

function storedSessions(store) {
  return Object.values(store.sessions).map((json) => JSON.parse(json));
}

before(startTestDb);
after(stopTestDb);
beforeEach(clearTestDb);

describe('safeReturnTo', () => {
  it('only accepts same-site relative paths', () => {
    assert.equal(safeReturnTo('/documents?status=expired'), '/documents?status=expired');
    for (const value of [
      '//evil.example',
      '/\\evil.example',
      'https://evil.example',
      'documents',
      '/a\nb',
      null,
    ]) {
      assert.equal(safeReturnTo(value), null, String(value));
    }
  });
});

describe('registration', () => {
  it('creates the first account as an administrator and signs it in', async () => {
    const { app } = createTestApp();
    const agent = request.agent(app);
    await agent.get('/register').expect(200);
    const response = await postForm(agent, '/register', VALID_REGISTRATION, 302);
    assert.equal(response.headers.location, '/');

    const user = await User.findOne({ username: 'jane.doe' });
    assert.equal(user.role, 'admin');
    assert.equal(user.email, 'jane@example.test');
    assert.equal(user.display_name, 'Jane Doe');
    assert.ok(user.last_login_at instanceof Date);
    assert.equal(await isSignedIn(agent), true);
  });

  it('is closed after the first account unless ALLOW_REGISTRATION is set', async () => {
    await createUser({ username: 'admin', role: 'admin' });
    const { app } = createTestApp();
    const agent = request.agent(app);
    const page = await agent.get('/register').expect(302);
    assert.equal(page.headers.location, '/login');
    const response = await postForm(agent, '/register', VALID_REGISTRATION, 302);
    assert.equal(response.headers.location, '/login');
    assert.equal(await User.countDocuments(), 1);
  });

  it('creates members when registration is open', async () => {
    await createUser({ username: 'admin', role: 'admin' });
    const { app } = createTestApp({ ALLOW_REGISTRATION: 'true' });
    const agent = request.agent(app);
    await agent.get('/register').expect(200);
    await postForm(agent, '/register', VALID_REGISTRATION, 302);
    assert.equal((await User.findOne({ username: 'jane.doe' })).role, 'member');
  });

  it('rejects invalid input without creating an account', async () => {
    const { app } = createTestApp();
    const cases = [
      { username: 'ab' },
      { username: 'jane doe' },
      { email: 'not-an-email' },
      { display_name: 'x'.repeat(101) },
      { password: 'too-short', password_confirm: 'too-short' },
      { password_confirm: 'something-else' },
    ];
    for (const overrides of cases) {
      const agent = request.agent(app);
      await postForm(agent, '/register', { ...VALID_REGISTRATION, ...overrides }, 422);
    }
    assert.equal(await User.countDocuments(), 0);
  });

  it('rejects a username or email address that is already taken', async () => {
    await createUser({ username: 'jane.doe', email: 'other@example.test', role: 'admin' });
    await createUser({ username: 'someone', email: 'jane@example.test' });
    const { app } = createTestApp({ ALLOW_REGISTRATION: 'true' });
    await postForm(request.agent(app), '/register', VALID_REGISTRATION, 422);
    await postForm(
      request.agent(app),
      '/register',
      {
        ...VALID_REGISTRATION,
        username: 'fresh.name',
      },
      422,
    );
    assert.equal(await User.countDocuments(), 2);
  });
});

describe('sign-in', () => {
  beforeEach(async () => {
    await createUser({ username: 'alex', email: 'alex@example.test', role: 'admin' });
  });

  it('accepts the username or the email address', async () => {
    const { app } = createTestApp();
    await request(app).get('/login').expect(200);

    const byUsername = request.agent(app);
    const response = await postForm(
      byUsername,
      '/login',
      {
        username: ' ALEX ',
        password: TEST_PASSWORD,
      },
      302,
    );
    assert.equal(response.headers.location, '/');
    assert.equal(await isSignedIn(byUsername), true);
    assert.ok((await User.findOne({ username: 'alex' })).last_login_at instanceof Date);

    const byEmail = request.agent(app);
    await postForm(byEmail, '/login', { username: 'Alex@Example.test', password: TEST_PASSWORD });
    assert.equal(await isSignedIn(byEmail), true);
  });

  it('rejects a wrong password with a flash message', async () => {
    const store = new session.MemoryStore();
    const { app } = createTestApp({}, { sessionStore: store });
    const agent = request.agent(app);
    const response = await postForm(
      agent,
      '/login',
      {
        username: 'alex',
        password: 'wrong-password',
      },
      302,
    );
    assert.equal(response.headers.location, '/login');
    assert.equal(await isSignedIn(agent), false);
    const flashes = storedSessions(store).map((data) => data.flash);
    assert.ok(
      flashes.some((flash) => flash?.error?.includes('Invalid username/email or password.')),
    );

    await postForm(agent, '/login', {}, 302);
    const _csrf = await getCsrfToken(agent);
    const injection = await agent
      .post('/login')
      .send({ username: { $ne: null }, password: { $ne: null }, _csrf })
      .expect(302);
    assert.equal(injection.headers.location, '/login');
    assert.equal(await isSignedIn(agent), false);
  });

  it('uses a persistent cookie only when "remember me" is checked', async () => {
    const { app } = createTestApp();
    const remembered = await postForm(request.agent(app), '/login', {
      username: 'alex',
      password: TEST_PASSWORD,
      remember: '1',
    });
    const cookie = remembered.headers['set-cookie'].find((value) => value.startsWith('ddt.sid='));
    const expires = new Date(/Expires=([^;]+)/.exec(cookie)[1]);
    const days = (expires.getTime() - Date.now()) / (24 * 60 * 60 * 1000);
    assert.ok(days > 29 && days <= 30, `cookie expires in ${days} days`);

    const browserSession = await postForm(request.agent(app), '/login', {
      username: 'alex',
      password: TEST_PASSWORD,
    });
    const sessionCookie = browserSession.headers['set-cookie'].find((value) =>
      value.startsWith('ddt.sid='),
    );
    assert.doesNotMatch(sessionCookie, /Expires=/);
  });

  it('redirects back to the page that required signing in', async () => {
    const { app } = createTestApp();
    const agent = request.agent(app);
    await agent.get('/documents?status=expired').set('Accept', 'text/html').expect(302);
    const response = await postForm(agent, '/login', { username: 'alex', password: TEST_PASSWORD });
    assert.equal(response.headers.location, '/documents?status=expired');
  });

  it('only remembers page navigations as the destination after signing in', async () => {
    const { app } = createTestApp();
    const agent = request.agent(app);
    await agent
      .get('/owners')
      .set({ Accept: 'text/html', 'Sec-Fetch-Mode': 'navigate' })
      .expect(302);
    await agent
      .get('/missing-image.png')
      .set({ Accept: 'image/avif,image/webp,*/*', 'Sec-Fetch-Mode': 'no-cors' })
      .expect(302);
    await agent.get('/api-like').set('Accept', '*/*').expect(302);
    const response = await postForm(agent, '/login', { username: 'alex', password: TEST_PASSWORD });
    assert.equal(response.headers.location, '/owners');
  });

  it('never redirects off-site after signing in', async () => {
    const store = new session.MemoryStore();
    const { app } = createTestApp({}, { sessionStore: store });

    const viaUrl = request.agent(app);
    await viaUrl.get('//evil.example/path').set('Accept', 'text/html').expect(302);
    const first = await postForm(viaUrl, '/login', { username: 'alex', password: TEST_PASSWORD });
    assert.equal(first.headers.location, '/');

    const tampered = request.agent(app);
    await getCsrfToken(tampered);
    for (const [sid, json] of Object.entries(store.sessions)) {
      store.sessions[sid] = JSON.stringify({ ...JSON.parse(json), returnTo: '//evil.example' });
    }
    const second = await postForm(tampered, '/login', {
      username: 'alex',
      password: TEST_PASSWORD,
    });
    assert.equal(second.headers.location, '/');
  });

  it('signs out with POST /logout only', async () => {
    const { app } = createTestApp();
    const agent = await loginAgent(app, { username: 'alex' });
    await agent.get('/logout').expect(404);
    assert.equal(await isSignedIn(agent), true);
    const response = await postForm(agent, '/logout', {}, 302);
    assert.equal(response.headers.location, '/login');
    assert.equal(await isSignedIn(agent), false);
  });

  it('sends signed-in users away from the sign-in and registration pages', async () => {
    const { app } = createTestApp({ ALLOW_REGISTRATION: 'true' });
    const agent = await loginAgent(app, { username: 'alex' });
    assert.equal((await agent.get('/login').expect(302)).headers.location, '/');
    assert.equal((await agent.get('/register').expect(302)).headers.location, '/');
  });

  it('still accepts the correct password after many failed attempts by someone else', async () => {
    const { app } = createTestApp();
    const attacker = request.agent(app);
    for (let attempt = 0; attempt < 15; attempt += 1) {
      await postForm(attacker, '/login', { username: 'alex', password: 'wrong-password' }, 302);
    }
    assert.equal(await isSignedIn(await loginAgent(app, { username: 'alex' })), true);

    // Back-off counters stored by earlier versions do not lock the account either.
    await User.collection.updateOne(
      { username: 'alex' },
      { $set: { attempts: 15, last: new Date() } },
    );
    assert.equal(await isSignedIn(await loginAgent(app, { username: 'alex' })), true);
  });

  it('does not switch to another account while signed in', async () => {
    await createUser({ username: 'member' });
    const { app } = createTestApp();
    const agent = await loginAgent(app, { username: 'member' });
    const response = await postForm(
      agent,
      '/login',
      { username: 'alex', password: TEST_PASSWORD },
      302,
    );
    assert.equal(response.headers.location, '/');
    await agent.get('/users').expect(403);
  });
});

describe('login sessions', () => {
  it('store the user id and the session version', async () => {
    const user = await createUser({ username: 'alex', role: 'admin' });
    const store = new session.MemoryStore();
    const { app } = createTestApp({}, { sessionStore: store });
    await loginAgent(app, { username: 'alex' });
    const logins = storedSessions(store).filter((data) => data.passport?.user);
    assert.deepEqual(
      logins.map((data) => data.passport.user),
      [{ id: user.id, v: 0 }],
    );
  });

  it('end when the stored session version is outdated or missing', async () => {
    const user = await createUser({ username: 'alex', role: 'admin' });
    const store = new session.MemoryStore();
    const { app } = createTestApp({}, { sessionStore: store });
    for (const stored of [user.id, { id: user.id }, { id: user.id, v: 1 }, { id: 'x', v: 0 }]) {
      const agent = await loginAgent(app, { username: 'alex' });
      assert.equal(await isSignedIn(agent), true);
      for (const [sid, json] of Object.entries(store.sessions)) {
        const data = JSON.parse(json);
        if (data.passport?.user) {
          store.sessions[sid] = JSON.stringify({ ...data, passport: { user: stored } });
        }
      }
      assert.equal(await isSignedIn(agent), false, JSON.stringify(stored));
    }
  });
});

describe('rate limiting', () => {
  it('limits failed sign-in attempts per client', async () => {
    await createUser({ username: 'alex', role: 'admin' });
    const { app } = createTestApp({}, { authRateLimit: { limit: 2, windowMs: 60_000 } });
    const agent = request.agent(app);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await postForm(agent, '/login', { username: 'alex', password: 'wrong' }, 302);
    }
    const blocked = await postForm(
      agent,
      '/login',
      { username: 'alex', password: TEST_PASSWORD },
      429,
      { Accept: 'application/json' },
    );
    assert.equal(blocked.body.error.status, 429);
    assert.ok(blocked.headers['retry-after']);
  });

  it('does not count successful sign-ins', async () => {
    await createUser({ username: 'alex', role: 'admin' });
    const { app } = createTestApp({}, { authRateLimit: { limit: 1, windowMs: 60_000 } });
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const response = await postForm(request.agent(app), '/login', {
        username: 'alex',
        password: TEST_PASSWORD,
      });
      assert.equal(response.headers.location, '/');
    }
  });

  it('counts sign-in attempts from clients that are already signed in', async () => {
    await createUser({ username: 'alex', role: 'admin' });
    await createUser({ username: 'member' });
    const { app } = createTestApp({}, { authRateLimit: { limit: 2, windowMs: 60_000 } });
    const agent = await loginAgent(app, { username: 'member' });
    const guess = { username: 'alex', password: 'a-guessed-password' };
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await postForm(agent, '/login', guess, 302);
    }
    await postForm(agent, '/login', guess, 429, { Accept: 'application/json' });
  });
});
