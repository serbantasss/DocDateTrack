const assert = require('node:assert/strict');
const { after, before, beforeEach, describe, it } = require('node:test');
const mongoose = require('mongoose');
const request = require('supertest');

const { saveUser } = require('../controllers/userForms');
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
const NEW_USER = {
  username: 'New.User',
  email: 'New.User@Example.test',
  display_name: 'New User',
  role: 'member',
  password: NEW_PASSWORD,
  password_confirm: NEW_PASSWORD,
};

/** Submits a form like a browser: POST (with `_method` for PUT/DELETE) and the CSRF token. */
async function submit(agent, method, url, fields = {}, { csrf = true } = {}) {
  const target = method === 'POST' ? url : `${url}?_method=${method}`;
  const body = csrf ? { ...fields, _csrf: await getCsrfToken(agent) } : fields;
  return agent.post(target).type('form').send(body);
}

async function isSignedIn(agent) {
  const response = await agent.get('/account');
  if (response.status === 302 && response.headers.location === '/login') return false;
  assert.equal(response.status, 200);
  return true;
}

function editFields(user, overrides = {}) {
  return {
    email: user.email,
    display_name: user.display_name ?? '',
    role: user.role,
    ...overrides,
  };
}

async function storedHash(user) {
  return (await User.findById(user._id).select('+hash')).hash;
}

let app;

before(startTestDb);
after(stopTestDb);
beforeEach(async () => {
  await clearTestDb();
  ({ app } = createTestApp());
});

describe('user administration access', () => {
  it('is limited to administrators', async () => {
    await createUser({ username: 'admin', role: 'admin' });
    const member = await createUser({ username: 'member' });
    const agent = await loginAgent(app, { username: 'member' });

    for (const url of ['/users', '/users/new', `/users/${member.id}/edit`]) {
      await agent.get(url).expect(403);
    }
    assert.equal((await submit(agent, 'POST', '/users', NEW_USER)).status, 403);
    const update = await submit(
      agent,
      'PUT',
      `/users/${member.id}`,
      editFields(member, { role: 'admin' }),
    );
    assert.equal(update.status, 403);
    assert.equal((await submit(agent, 'DELETE', `/users/${member.id}`)).status, 403);
    assert.equal((await User.findById(member._id)).role, 'member');
    assert.equal(await User.countDocuments(), 2);
  });

  it('sends anonymous visitors to the sign-in page', async () => {
    await createUser({ username: 'admin', role: 'admin' });
    const agent = request.agent(app);
    const page = await agent.get('/users').expect(302);
    assert.equal(page.headers.location, '/login');
    const post = await submit(agent, 'POST', '/users', NEW_USER);
    assert.equal(post.status, 401);
    assert.equal(await User.countDocuments(), 1);
  });
});

describe('user list', () => {
  it('shows every account with its role and last sign-in, and marks your own', async () => {
    const admin = await createUser({ username: 'admin', role: 'admin', display_name: 'Ada Admin' });
    const member = await createUser({ username: 'member', display_name: 'Mia Member' });
    const agent = await loginAgent(app, { username: 'admin' });

    const page = await agent.get('/users').expect(200);
    for (const text of ['admin', 'Ada Admin', 'member@example.test', 'Mia Member', 'Never']) {
      assert.ok(page.text.includes(text), text);
    }
    assert.match(page.text, /Administrator/);
    assert.match(page.text, />\s*You\s*</);
    assert.ok(page.text.includes(`action="/users/${member.id}?_method=DELETE"`));
    assert.ok(!page.text.includes(`action="/users/${admin.id}?_method=DELETE"`));
    assert.ok(page.text.includes(`href="/users/${admin.id}/edit"`));
  });
});

describe('creating users', () => {
  beforeEach(() => createUser({ username: 'admin', role: 'admin' }));

  it('creates an account that can sign in', async () => {
    const agent = await loginAgent(app, { username: 'admin' });
    await agent.get('/users/new').expect(200);
    const response = await submit(agent, 'POST', '/users', NEW_USER);
    assert.equal(response.status, 302);
    assert.equal(response.headers.location, '/users');

    const user = await User.findOne({ username: 'new.user' });
    assert.equal(user.email, 'new.user@example.test');
    assert.equal(user.display_name, 'New User');
    assert.equal(user.role, 'member');
    assert.match((await agent.get('/users')).text, /new\.user has been created/);
    await loginAgent(app, { username: 'new.user', password: NEW_PASSWORD });
  });

  it('creates administrators', async () => {
    const agent = await loginAgent(app, { username: 'admin' });
    await submit(agent, 'POST', '/users', { ...NEW_USER, role: 'admin' });
    const newAdmin = await loginAgent(app, { username: 'new.user', password: NEW_PASSWORD });
    await newAdmin.get('/users').expect(200);
  });

  it('rejects a username or email address that is already taken', async () => {
    await createUser({ username: 'member', email: 'member@example.test' });
    const agent = await loginAgent(app, { username: 'admin' });

    const username = await submit(agent, 'POST', '/users', { ...NEW_USER, username: 'MEMBER' });
    assert.equal(username.status, 422);
    assert.match(username.text, /This username is already taken\./);
    const email = await submit(agent, 'POST', '/users', {
      ...NEW_USER,
      email: 'Member@Example.test',
    });
    assert.equal(email.status, 422);
    assert.match(email.text, /An account with this email address already exists\./);

    const both = await submit(agent, 'POST', '/users', {
      ...NEW_USER,
      username: 'member',
      password_confirm: 'something-else',
    });
    const takenAt = both.text.indexOf('This username is already taken.');
    const mismatchAt = both.text.indexOf('The passwords do not match.');
    assert.ok(takenAt !== -1 && takenAt < mismatchAt, 'errors are listed in form order');
    assert.equal(await User.countDocuments(), 2);
  });

  it('rejects invalid input', async () => {
    const agent = await loginAgent(app, { username: 'admin' });
    const cases = [
      { username: 'ab' },
      { username: 'new user' },
      { email: 'not-an-email' },
      { display_name: 'x'.repeat(101) },
      { role: 'owner' },
      { password: 'too-short', password_confirm: 'too-short' },
      { password_confirm: 'something-else' },
      { password: '', password_confirm: '' },
    ];
    for (const overrides of cases) {
      const response = await submit(agent, 'POST', '/users', { ...NEW_USER, ...overrides });
      assert.equal(response.status, 422, JSON.stringify(overrides));
    }
    const jsonCases = [
      { username: { $ne: null } },
      { email: { $gt: '' } },
      { role: ['admin', 'member'] },
      { password: [NEW_PASSWORD], password_confirm: [NEW_PASSWORD] },
    ];
    for (const overrides of jsonCases) {
      const _csrf = await getCsrfToken(agent);
      const response = await agent.post('/users').send({ ...NEW_USER, ...overrides, _csrf });
      assert.equal(response.status, 422, JSON.stringify(overrides));
    }
    assert.equal(await User.countDocuments(), 1);
  });

  it('reports a username or email address taken by a concurrent request', async () => {
    await createUser({ username: 'taken', email: 'taken@example.test' });

    const emailErrors = {};
    const sameEmail = new User({ username: 'fresh', email: 'taken@example.test' });
    assert.equal(await saveUser(sameEmail, emailErrors), false);
    assert.equal(emailErrors.email.msg, 'An account with this email address already exists.');

    const usernameErrors = {};
    const sameUsername = new User({ username: 'taken', email: 'fresh@example.test' });
    assert.equal(await saveUser(sameUsername, usernameErrors), false);
    assert.equal(usernameErrors.username.msg, 'This username is already taken.');
  });
});

describe('editing users', () => {
  let member;

  beforeEach(async () => {
    await createUser({ username: 'admin', role: 'admin' });
    member = await createUser({ username: 'member', display_name: 'Mia Member' });
  });

  it('updates the email address, display name and role', async () => {
    const agent = await loginAgent(app, { username: 'admin' });
    const form = await agent.get(`/users/${member.id}/edit`).expect(200);
    assert.ok(form.text.includes('value="member@example.test"'));

    const response = await submit(agent, 'PUT', `/users/${member.id}`, {
      username: 'renamed',
      email: ' Mia@Example.test ',
      display_name: 'Mia M.',
      role: 'admin',
    });
    assert.equal(response.status, 302);
    assert.equal(response.headers.location, '/users');

    const updated = await User.findById(member._id);
    assert.equal(updated.username, 'member');
    assert.equal(updated.email, 'mia@example.test');
    assert.equal(updated.display_name, 'Mia M.');
    assert.equal(updated.role, 'admin');
  });

  it('clears the display name and keeps the password when the fields are blank', async () => {
    const agent = await loginAgent(app, { username: 'admin' });
    const hash = await storedHash(member);
    const response = await submit(agent, 'PUT', `/users/${member.id}`, {
      ...editFields(member, { display_name: '' }),
      password: '',
      password_confirm: '',
    });
    assert.equal(response.status, 302);
    const updated = await User.findById(member._id);
    assert.equal(updated.display_name, undefined);
    assert.equal(updated.session_version, 0);
    assert.equal(await storedHash(member), hash);
  });

  it('rejects invalid values and an email address used by another account', async () => {
    await createUser({ username: 'other', email: 'other@example.test' });
    const agent = await loginAgent(app, { username: 'admin' });
    const cases = [
      { email: 'Other@Example.test' },
      { email: 'not-an-email' },
      { role: 'owner' },
      { password: 'too-short', password_confirm: 'too-short' },
      { password: NEW_PASSWORD, password_confirm: 'something-else' },
      { password_confirm: NEW_PASSWORD },
    ];
    for (const overrides of cases) {
      const response = await submit(
        agent,
        'PUT',
        `/users/${member.id}`,
        editFields(member, overrides),
      );
      assert.equal(response.status, 422, JSON.stringify(overrides));
    }
    const unchanged = await User.findById(member._id);
    assert.equal(unchanged.email, 'member@example.test');
    assert.equal(unchanged.role, 'member');
    assert.equal(unchanged.session_version, 0);
  });

  it('resets the password and signs the user out everywhere', async () => {
    const memberAgent = await loginAgent(app, { username: 'member' });
    const adminAgent = await loginAgent(app, { username: 'admin' });

    const response = await submit(adminAgent, 'PUT', `/users/${member.id}`, {
      ...editFields(member),
      password: NEW_PASSWORD,
      password_confirm: NEW_PASSWORD,
    });
    assert.equal(response.status, 302);
    assert.equal((await User.findById(member._id)).session_version, 1);
    assert.equal(await isSignedIn(memberAgent), false);
    assert.equal(await isSignedIn(adminAgent), true);

    const signedIn = await loginAgent(app, { username: 'member', password: NEW_PASSWORD });
    assert.equal(await isSignedIn(signedIn), true);
    await assert.rejects(loginAgent(app, { username: 'member', password: TEST_PASSWORD }));
  });

  it('applies role changes to signed-in users immediately', async () => {
    await User.updateOne({ _id: member._id }, { role: 'admin' });
    const memberAgent = await loginAgent(app, { username: 'member' });
    await memberAgent.get('/users').expect(200);

    const adminAgent = await loginAgent(app, { username: 'admin' });
    await submit(adminAgent, 'PUT', `/users/${member.id}`, editFields(member, { role: 'member' }));
    await memberAgent.get('/users').expect(403);
    assert.equal(await isSignedIn(memberAgent), true);
  });

  it('leaves your own password to the account page', async () => {
    const admin = await User.findOne({ username: 'admin' });
    const agent = await loginAgent(app, { username: 'admin' });
    const form = await agent.get(`/users/${admin.id}/edit`).expect(200);
    assert.ok(!form.text.includes('name="password"'));
    assert.ok(form.text.includes('href="/account"'));

    const hash = await storedHash(admin);
    const response = await submit(agent, 'PUT', `/users/${admin.id}`, {
      ...editFields(admin),
      password: NEW_PASSWORD,
      password_confirm: NEW_PASSWORD,
    });
    assert.equal(response.status, 422);
    assert.match(response.text, /Change your own password on your account page\./);
    assert.equal(await storedHash(admin), hash);
    assert.equal(await isSignedIn(agent), true);
  });

  it('answers unknown and malformed ids with 404', async () => {
    const agent = await loginAgent(app, { username: 'admin' });
    const unknownId = new mongoose.Types.ObjectId().toString();
    for (const id of [unknownId, '123', 'not-an-id']) {
      await agent.get(`/users/${id}/edit`).expect(404);
      assert.equal((await submit(agent, 'PUT', `/users/${id}`, editFields(member))).status, 404);
      assert.equal((await submit(agent, 'DELETE', `/users/${id}`)).status, 404);
    }
    await agent.get(`/users/${member.id}`).expect(404);
  });
});

describe('deleting users', () => {
  it('deletes the account and ends its sessions', async () => {
    await createUser({ username: 'admin', role: 'admin' });
    const member = await createUser({ username: 'member' });
    const memberAgent = await loginAgent(app, { username: 'member' });
    const adminAgent = await loginAgent(app, { username: 'admin' });

    const response = await submit(adminAgent, 'DELETE', `/users/${member.id}`);
    assert.equal(response.status, 302);
    assert.equal(response.headers.location, '/users');
    assert.equal(await User.exists({ _id: member._id }), null);
    assert.match((await adminAgent.get('/users')).text, /member has been deleted/);
    assert.equal(await isSignedIn(memberAgent), false);
  });
});

describe('administrator safeguards', () => {
  let admin;

  beforeEach(async () => {
    admin = await createUser({ username: 'admin', role: 'admin' });
  });

  it('do not let you delete your own account', async () => {
    const agent = await loginAgent(app, { username: 'admin' });
    const response = await submit(agent, 'DELETE', `/users/${admin.id}`);
    assert.equal(response.status, 302);
    assert.ok(await User.exists({ _id: admin._id }));
    assert.match((await agent.get('/users')).text, /You cannot delete your own account\./);
  });

  it('keep the last administrator', async () => {
    await createUser({ username: 'member' });
    const agent = await loginAgent(app, { username: 'admin' });
    const response = await submit(
      agent,
      'PUT',
      `/users/${admin.id}`,
      editFields(admin, { role: 'member' }),
    );
    assert.equal(response.status, 422);
    assert.match(response.text, /admin is the only administrator/);
    assert.equal((await User.findById(admin._id)).role, 'admin');
  });

  it('allow demoting and deleting administrators while another one remains', async () => {
    const second = await createUser({ username: 'second', role: 'admin' });
    const third = await createUser({ username: 'third', role: 'admin' });
    const agent = await loginAgent(app, { username: 'admin' });

    const demoted = await submit(
      agent,
      'PUT',
      `/users/${second.id}`,
      editFields(second, { role: 'member' }),
    );
    assert.equal(demoted.status, 302);
    assert.equal((await User.findById(second._id)).role, 'member');

    assert.equal((await submit(agent, 'DELETE', `/users/${third.id}`)).status, 302);
    assert.equal(await User.exists({ _id: third._id }), null);

    await User.updateOne({ _id: second._id }, { role: 'admin' });
    const self = await submit(
      agent,
      'PUT',
      `/users/${admin.id}`,
      editFields(admin, { role: 'member' }),
    );
    assert.equal(self.status, 302);
    assert.equal(self.headers.location, '/account');
    assert.equal((await User.findById(admin._id)).role, 'member');
    await agent.get('/users').expect(403);
  });
});

describe('concurrent administrator changes', () => {
  /** Creates administrators and returns them signed in, each with a CSRF token. */
  async function signedInAdmins(...usernames) {
    const admins = [];
    for (const username of usernames) {
      const user = await createUser({ username, role: 'admin' });
      const agent = await loginAgent(app, { username });
      admins.push({ user, agent, token: await getCsrfToken(agent) });
    }
    return admins;
  }

  function send({ agent, token }, method, url, fields = {}) {
    return agent
      .post(`${url}?_method=${method}`)
      .type('form')
      .send({ ...fields, _csrf: token });
  }

  const statuses = (responses) => responses.map(({ status }) => status).sort((a, b) => a - b);

  it('let only one of two administrators demote themselves', async () => {
    // Without serialization the outcome depends on timing, so repeat the race a few times.
    for (let round = 0; round < 3; round += 1) {
      await clearTestDb();
      const admins = await signedInAdmins('ada', 'bob');
      const responses = await Promise.all(
        admins.map((admin) =>
          send(admin, 'PUT', `/users/${admin.user.id}`, editFields(admin.user, { role: 'member' })),
        ),
      );
      assert.deepEqual(statuses(responses), [302, 422]);
      assert.equal(await User.countDocuments({ role: 'admin' }), 1);
    }
  });

  it('let only one of two administrators delete the other', async () => {
    const [ada, bob] = await signedInAdmins('ada', 'bob');
    const responses = await Promise.all([
      send(ada, 'DELETE', `/users/${bob.user.id}`),
      send(bob, 'DELETE', `/users/${ada.user.id}`),
    ]);
    const [deleted, refused] = statuses(responses);
    assert.equal(deleted, 302);
    assert.ok([401, 403].includes(refused), `refused with status ${refused}`);
    assert.equal(await User.countDocuments(), 1);
    assert.equal(await User.countDocuments({ role: 'admin' }), 1);
  });

  it('keep an administrator when another process demotes the others meanwhile', async (t) => {
    await createUser({ username: 'bob', role: 'admin' });
    const [ada] = await signedInAdmins('ada');
    const save = User.prototype.save;
    t.mock.method(User.prototype, 'save', async function (...args) {
      await User.collection.updateMany({ _id: { $ne: this._id } }, { $set: { role: 'member' } });
      return save.apply(this, args);
    });

    const response = await send(
      ada,
      'PUT',
      `/users/${ada.user.id}`,
      editFields(ada.user, { role: 'member' }),
    );
    assert.equal(response.status, 422);
    assert.match(response.text, /ada is the only administrator/);
    assert.equal((await User.findById(ada.user._id)).role, 'admin');
  });
});

describe('CSRF protection for user administration', () => {
  it('is required to create, update and delete users', async () => {
    await createUser({ username: 'admin', role: 'admin' });
    const member = await createUser({ username: 'member' });
    const agent = await loginAgent(app, { username: 'admin' });

    assert.equal((await submit(agent, 'POST', '/users', NEW_USER, { csrf: false })).status, 403);
    const update = await submit(
      agent,
      'PUT',
      `/users/${member.id}`,
      { ...editFields(member, { role: 'admin' }), _csrf: 'forged' },
      { csrf: false },
    );
    assert.equal(update.status, 403);
    const removal = await submit(agent, 'DELETE', `/users/${member.id}`, {}, { csrf: false });
    assert.equal(removal.status, 403);

    assert.equal(await User.countDocuments(), 2);
    assert.equal((await User.findById(member._id)).role, 'member');
  });
});
