const assert = require('node:assert/strict');
const { after, before, beforeEach, describe, it } = require('node:test');
const request = require('supertest');

const User = require('../models/user');
const {
  TEST_PASSWORD,
  createTestApp,
  createUser,
  getCsrfToken,
  loginAgent,
} = require('./helpers/app');
const { clearTestDb, startTestDb, stopTestDb } = require('./helpers/db');

const NEW_PASSWORD = 'a-brand-new-password';
const PASSWORD_CHANGE = {
  current_password: TEST_PASSWORD,
  new_password: NEW_PASSWORD,
  new_password_confirm: NEW_PASSWORD,
};

async function post(agent, url, fields = {}, { csrf = true } = {}) {
  const body = csrf ? { ...fields, _csrf: await getCsrfToken(agent) } : fields;
  return agent.post(url).type('form').send(body);
}

async function isSignedIn(agent) {
  const response = await agent.get('/account');
  if (response.status === 302 && response.headers.location === '/login') return false;
  assert.equal(response.status, 200);
  return true;
}

function sessionCookie(response) {
  return (response.headers['set-cookie'] ?? []).find((value) => value.startsWith('ddt.sid='));
}

async function storedCredentials(user) {
  const stored = await User.findById(user._id).select('+hash');
  return { hash: stored.hash, sessionVersion: stored.session_version };
}

let app;
let member;

before(startTestDb);
after(stopTestDb);
beforeEach(async () => {
  await clearTestDb();
  ({ app } = createTestApp());
  await createUser({ username: 'admin', role: 'admin' });
  member = await createUser({ username: 'member', display_name: 'Mia Member' });
});

describe('account page', () => {
  it('shows the profile, the role and the last sign-in', async () => {
    const agent = await loginAgent(app, { username: 'member' });
    const page = await agent.get('/account').expect(200);
    for (const text of ['value="member"', 'value="member@example.test"', 'value="Mia Member"']) {
      assert.ok(page.text.includes(text), text);
    }
    assert.match(page.text, />\s*Member\s*</);
    assert.match(page.text, /<time datetime="\d{4}-\d{2}-\d{2}T/);
    assert.ok(page.text.includes('action="/account/password"'));
  });

  it('requires signing in', async () => {
    const response = await request(app).get('/account').expect(302);
    assert.equal(response.headers.location, '/login');
  });
});

describe('profile', () => {
  it('updates the email address and display name but not the username', async () => {
    const agent = await loginAgent(app, { username: 'member' });
    const response = await post(agent, '/account', {
      username: 'renamed',
      email: ' Mia@Example.test ',
      display_name: ' Mia M. ',
    });
    assert.equal(response.status, 302);
    assert.equal(response.headers.location, '/account');

    const updated = await User.findById(member._id);
    assert.equal(updated.username, 'member');
    assert.equal(updated.email, 'mia@example.test');
    assert.equal(updated.display_name, 'Mia M.');
    assert.match((await agent.get('/account')).text, /Your profile has been updated\./);
  });

  it('keeps your own email address and clears the display name', async () => {
    const agent = await loginAgent(app, { username: 'member' });
    const response = await post(agent, '/account', {
      email: 'member@example.test',
      display_name: '',
    });
    assert.equal(response.status, 302);
    assert.equal((await User.findById(member._id)).display_name, undefined);
  });

  it('rejects invalid values and an email address used by another account', async () => {
    const agent = await loginAgent(app, { username: 'member' });
    const taken = await post(agent, '/account', { email: 'Admin@Example.test' });
    assert.equal(taken.status, 422);
    assert.match(taken.text, /An account with this email address already exists\./);

    for (const fields of [
      { email: 'not-an-email' },
      { email: '' },
      { display_name: 'x'.repeat(101) },
    ]) {
      const response = await post(agent, '/account', { email: 'mia@example.test', ...fields });
      assert.equal(response.status, 422, JSON.stringify(fields));
    }
    const _csrf = await getCsrfToken(agent);
    await agent
      .post('/account')
      .send({ email: { $gt: '' }, _csrf })
      .expect(422);

    const unchanged = await User.findById(member._id);
    assert.equal(unchanged.email, 'member@example.test');
    assert.equal(unchanged.display_name, 'Mia Member');
  });
});

describe('password change', () => {
  it('rejects a wrong current password', async () => {
    const agent = await loginAgent(app, { username: 'member' });
    const before = await storedCredentials(member);
    const response = await post(agent, '/account/password', {
      ...PASSWORD_CHANGE,
      current_password: 'not-my-password',
    });
    assert.equal(response.status, 422);
    assert.match(response.text, /Your current password is incorrect\./);
    assert.deepEqual(await storedCredentials(member), before);
    assert.equal(await isSignedIn(agent), true);
  });

  it('rejects a missing current password and invalid new passwords', async () => {
    const agent = await loginAgent(app, { username: 'member' });
    const before = await storedCredentials(member);
    const cases = [
      { current_password: '' },
      { new_password_confirm: 'something-else' },
      { new_password: 'too-short', new_password_confirm: 'too-short' },
      { new_password: TEST_PASSWORD, new_password_confirm: TEST_PASSWORD },
    ];
    for (const overrides of cases) {
      const response = await post(agent, '/account/password', { ...PASSWORD_CHANGE, ...overrides });
      assert.equal(response.status, 422, JSON.stringify(overrides));
    }
    for (const overrides of [
      { current_password: { $ne: null } },
      { new_password: [NEW_PASSWORD], new_password_confirm: [NEW_PASSWORD] },
    ]) {
      const _csrf = await getCsrfToken(agent);
      const response = await agent
        .post('/account/password')
        .send({ ...PASSWORD_CHANGE, ...overrides, _csrf });
      assert.equal(response.status, 422, JSON.stringify(overrides));
    }
    assert.deepEqual(await storedCredentials(member), before);
  });

  it('keeps this session, signs out the other sessions and activates the new password', async () => {
    const agent = await loginAgent(app, { username: 'member' });
    const otherDevice = await loginAgent(app, { username: 'member' });

    const response = await post(agent, '/account/password', PASSWORD_CHANGE);
    assert.equal(response.status, 302);
    assert.equal(response.headers.location, '/account');
    assert.equal((await User.findById(member._id)).session_version, 1);

    const page = await agent.get('/account').expect(200);
    assert.match(page.text, /Your password has been changed\./);
    assert.equal(await isSignedIn(otherDevice), false);

    await loginAgent(app, { username: 'member', password: NEW_PASSWORD });
    await assert.rejects(loginAgent(app, { username: 'member', password: TEST_PASSWORD }));
  });

  it('starts a new session that stays persistent with "keep me signed in"', async () => {
    const agent = request.agent(app);
    const login = await post(agent, '/login', {
      username: 'member',
      password: TEST_PASSWORD,
      remember: '1',
    });
    const before = sessionCookie(login);

    const response = await post(agent, '/account/password', PASSWORD_CHANGE);
    assert.equal(response.status, 302);
    const after = sessionCookie(response);
    assert.ok(after, 'a new session cookie is set');
    assert.notEqual(after.split(';')[0], before.split(';')[0]);
    const expires = new Date(/Expires=([^;]+)/.exec(after)[1]);
    const days = (expires.getTime() - Date.now()) / (24 * 60 * 60 * 1000);
    assert.ok(days > 29 && days <= 30, `cookie expires in ${days} days`);
    assert.equal(await isSignedIn(agent), true);
  });

  it('is rate limited without counting successful changes', async () => {
    const limited = createTestApp({}, { authRateLimit: { limit: 1, windowMs: 60_000 } }).app;
    const agent = await loginAgent(limited, { username: 'member' });
    assert.equal((await post(agent, '/account/password', PASSWORD_CHANGE)).status, 302);

    const guess = {
      current_password: 'not-my-password',
      new_password: 'yet-another-password',
      new_password_confirm: 'yet-another-password',
    };
    assert.equal((await post(agent, '/account/password', guess)).status, 422);
    assert.equal((await post(agent, '/account/password', guess)).status, 429);
    assert.equal((await User.findById(member._id)).session_version, 1);
  });
});

describe('CSRF protection for the account page', () => {
  it('is required to update the profile and change the password', async () => {
    const agent = await loginAgent(app, { username: 'member' });
    const before = await storedCredentials(member);
    const profile = await post(agent, '/account', { email: 'mia@example.test' }, { csrf: false });
    assert.equal(profile.status, 403);
    const password = await post(
      agent,
      '/account/password',
      { ...PASSWORD_CHANGE, _csrf: 'forged' },
      { csrf: false },
    );
    assert.equal(password.status, 403);

    assert.equal((await User.findById(member._id)).email, 'member@example.test');
    assert.deepEqual(await storedCredentials(member), before);
  });
});
