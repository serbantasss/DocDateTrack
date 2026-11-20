const assert = require('node:assert/strict');
const path = require('node:path');
const { after, before, beforeEach, describe, it, mock } = require('node:test');
const express = require('express');
const session = require('express-session');
const createError = require('http-errors');
const mongoose = require('mongoose');
const multer = require('multer');
const request = require('supertest');

const { csrfProtection, verifyCsrf } = require('../middleware/csrf');
const { errorHandler } = require('../middleware/errors');
const { flash } = require('../middleware/flash');
const { locals } = require('../middleware/locals');
const { createTestApp, createTestConfig, createUser, loginAgent } = require('./helpers/app');
const { clearTestDb, startTestDb, stopTestDb } = require('./helpers/db');

function createHarness(configOverrides = {}) {
  const harness = express();
  harness.set('config', createTestConfig(configOverrides));
  harness.set('views', path.join(__dirname, '..', 'views'));
  harness.set('view engine', 'pug');
  harness.use(express.urlencoded({ extended: false }));
  harness.use(
    session({
      secret: 'harness',
      resave: false,
      saveUninitialized: false,
      store: new session.MemoryStore(),
    }),
  );
  harness.use(flash());
  harness.use(locals);
  harness.use(csrfProtection);
  return harness;
}

before(startTestDb);
after(stopTestDb);
beforeEach(clearTestDb);

describe('public endpoints', () => {
  it('GET /healthz reports the database status without creating a session', async () => {
    const { app } = createTestApp();
    const response = await request(app).get('/healthz').expect(200);
    assert.deepEqual(response.body, { status: 'ok' });
    assert.equal(response.headers['cache-control'], 'no-store');
    assert.equal(response.headers['set-cookie'], undefined);
  });

  it('GET /csrf-token returns a per-session token', async () => {
    const { app } = createTestApp();
    const agent = request.agent(app);
    const first = await agent.get('/csrf-token').expect(200);
    assert.equal(first.headers['cache-control'], 'no-store');
    assert.match(first.body.token, /^[\w-]{43}$/);
    const cookie = first.headers['set-cookie'].join(';');
    assert.match(cookie, /^ddt\.sid=/);
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Lax/);
    assert.doesNotMatch(cookie, /Expires=/);

    const second = await agent.get('/csrf-token').expect(200);
    assert.equal(second.body.token, first.body.token);
    const other = await request(app).get('/csrf-token').expect(200);
    assert.notEqual(other.body.token, first.body.token);
  });

  it('sends a strict Content-Security-Policy and hardening headers', async () => {
    const { app } = createTestApp();
    const response = await request(app).get('/healthz');
    assert.equal(
      response.headers['content-security-policy'],
      "default-src 'self';script-src 'self';style-src 'self';img-src 'self' data:;" +
        "font-src 'self';object-src 'none';base-uri 'self';form-action 'self';frame-ancestors 'none'",
    );
    assert.equal(response.headers['x-frame-options'], 'DENY');
    assert.equal(response.headers['x-content-type-options'], 'nosniff');
    assert.equal(response.headers['referrer-policy'], 'same-origin');
    assert.equal(response.headers['x-powered-by'], undefined);
  });

  it('serves Bootstrap and Bootstrap Icons from node_modules', async () => {
    const { app } = createTestApp();
    const css = await request(app).get('/vendor/bootstrap/css/bootstrap.min.css').expect(200);
    assert.match(css.headers['content-type'], /text\/css/);
    await request(app).get('/vendor/bootstrap/js/bootstrap.bundle.min.js').expect(200);
    const icons = await request(app)
      .get('/vendor/bootstrap-icons/bootstrap-icons.min.css')
      .expect(200);
    const fontUrl = /url\("(fonts\/bootstrap-icons\.woff2)\?[^"]*"\)/.exec(icons.text)[1];
    await request(app).get(`/vendor/bootstrap-icons/${fontUrl}`).expect(200);
    await request(app)
      .get('/vendor/bootstrap/css/missing.css')
      .set('Accept', 'application/json')
      .expect(404);
  });
});

describe('first-run setup', () => {
  it('sends every page to /register while no account exists', async () => {
    const { app } = createTestApp();
    for (const url of ['/', '/documents', '/users', '/login']) {
      const response = await request(app).get(url).expect(302);
      assert.equal(response.headers.location, '/register', url);
    }
    await request(app).get('/register').expect(200);
  });
});

describe('authentication guard', () => {
  it('redirects anonymous page views to /login and rejects other requests', async () => {
    await createUser({ username: 'member' });
    const { app } = createTestApp();
    const agent = request.agent(app);
    const page = await agent.get('/documents?owner=1').expect(302);
    assert.equal(page.headers.location, '/login');

    const token = (await agent.get('/csrf-token')).body.token;
    const post = await agent
      .post('/owners')
      .set('Accept', 'application/json')
      .type('form')
      .send({ _csrf: token })
      .expect(401);
    assert.equal(post.body.error.status, 401);
  });

  it('returns 403 to members on admin pages', async () => {
    await createUser({ username: 'admin', role: 'admin' });
    await createUser({ username: 'member' });
    const { app } = createTestApp();
    const member = await loginAgent(app, { username: 'member' });
    const denied = await member.get('/users').set('Accept', 'application/json').expect(403);
    assert.deepEqual(denied.body, {
      error: { status: 403, message: 'Only administrators can access this page.' },
    });
    await member.get('/users').expect(403);

    const admin = await loginAgent(app, { username: 'admin' });
    const allowed = await admin.get('/users');
    assert.notEqual(allowed.status, 403);
  });

  it('answers unknown pages with 404 for signed-in users', async () => {
    await createUser({ username: 'member' });
    const { app } = createTestApp();
    const agent = await loginAgent(app, { username: 'member' });
    const response = await agent.get('/no-such-page').set('Accept', 'application/json').expect(404);
    assert.equal(response.body.error.status, 404);
    await agent.get('/no-such-page').expect(404);
  });
});

describe('CSRF protection', () => {
  async function signedInAgent(username = 'member') {
    await createUser({ username });
    const { app } = createTestApp();
    return { app, agent: await loginAgent(app, { username }) };
  }

  async function isSignedIn(agent) {
    const response = await agent.get('/account');
    return !(response.status === 302 && response.headers.location === '/login');
  }

  it('rejects a POST without a token', async () => {
    const { agent } = await signedInAgent();
    const response = await agent.post('/logout').set('Accept', 'application/json').expect(403);
    assert.deepEqual(response.body, {
      error: { status: 403, message: 'Your session expired. Reload the page and try again.' },
    });
    await agent.post('/logout').expect(403);
    assert.equal(await isSignedIn(agent), true);
  });

  it('rejects an invalid token and non-form bodies', async () => {
    const { agent } = await signedInAgent();
    await agent.post('/logout').type('form').send({ _csrf: 'forged' }).expect(403);
    await agent.post('/logout').set('x-csrf-token', 'forged').expect(403);
    await agent.post('/logout').type('text/plain').send('_csrf=anything').expect(403);
    assert.equal(await isSignedIn(agent), true);
  });

  it('accepts the token from the form body or the x-csrf-token header', async () => {
    const { agent } = await signedInAgent();
    const { token } = (await agent.get('/csrf-token')).body;
    const response = await agent.post('/logout').type('form').send({ _csrf: token }).expect(302);
    assert.equal(response.headers.location, '/login');
    assert.equal(await isSignedIn(agent), false);

    const second = await signedInAgent('second.member');
    const headerToken = (await second.agent.get('/csrf-token')).body.token;
    await second.agent.post('/logout').set('x-csrf-token', headerToken).expect(302);
    assert.equal(await isSignedIn(second.agent), false);
  });

  it('applies to overridden methods, which are limited to PUT, PATCH and DELETE', async () => {
    const { agent } = await signedInAgent();
    await agent.post('/owners/123?_method=DELETE').expect(403);

    const { token } = (await agent.get('/csrf-token')).body;
    // POST /logout exists but DELETE /logout does not: a 404 proves the method was overridden.
    await agent.post('/logout?_method=DELETE').type('form').send({ _csrf: token }).expect(404);
    await agent.post('/logout?_method=GET').type('form').send({ _csrf: token }).expect(302);
    assert.equal(await isSignedIn(agent), false);
  });

  describe('multipart requests', () => {
    const upload = multer({ storage: multer.memoryStorage() });

    function multipartHarness() {
      const harness = createHarness();
      harness.get('/token', (req, res) => res.json({ token: req.csrfToken() }));
      harness.post('/upload', upload.single('file'), verifyCsrf, (req, res) =>
        res.json({ name: req.body.name, size: req.file?.size }),
      );
      harness.post('/unverified', (req, res) => res.json({ reached: true }));
      harness.delete('/unverified', (req, res) => res.json({ reached: true }));
      harness.use(errorHandler);
      return harness;
    }

    it('are verified by verifyCsrf after multer', async () => {
      const agent = request.agent(multipartHarness());
      const { token } = (await agent.get('/token').expect(200)).body;
      const ok = await agent
        .post('/upload')
        .set('Sec-Fetch-Site', 'same-origin')
        .field('_csrf', token)
        .field('name', 'scan')
        .attach('file', Buffer.from('%PDF-1.7'), 'scan.pdf')
        .expect(200);
      assert.deepEqual(ok.body, { name: 'scan', size: 8 });

      await agent.post('/upload').set('x-csrf-token', token).field('name', 'scan').expect(200);

      for (const fields of [{ name: 'scan' }, { name: 'scan', _csrf: 'forged' }]) {
        let req = agent
          .post('/upload')
          .set({ Accept: 'application/json', 'Sec-Fetch-Site': 'same-origin' });
        for (const [key, value] of Object.entries(fields)) req = req.field(key, value);
        const response = await req.expect(403);
        assert.equal(response.body.error.status, 403);
      }
    });

    it('are only deferred to the route when they provably come from the same origin', async () => {
      const agent = request.agent(multipartHarness());
      const { token } = (await agent.get('/token')).body;
      const sameOrigin = [
        { 'Sec-Fetch-Site': 'same-origin' },
        { Host: 'docs.example.test', Origin: 'http://docs.example.test' },
        { Host: 'docs.example.test:8080', Referer: 'http://docs.example.test:8080/versions/new' },
      ];
      for (const headers of sameOrigin) {
        await agent.post('/unverified').set(headers).field('name', 'x').expect(200);
      }

      const untrusted = [
        {},
        { 'Sec-Fetch-Site': 'cross-site' },
        { 'Sec-Fetch-Site': 'same-site', Origin: 'http://docs.example.test' },
        { Host: 'docs.example.test', Origin: 'http://evil.example.test' },
        { Host: 'docs.example.test', Origin: 'null' },
        { Host: 'docs.example.test', Referer: 'http://docs.example.test.evil.example/' },
      ];
      for (const headers of untrusted) {
        await agent.post('/unverified').set(headers).field('name', 'x').expect(403);
      }
      await agent.post('/unverified').set('x-csrf-token', token).field('name', 'x').expect(200);

      // DELETE is never deferred, even from the same origin.
      await agent
        .delete('/unverified')
        .set('Sec-Fetch-Site', 'same-origin')
        .field('name', 'x')
        .expect(403);
    });

    it('cannot sign a user out without a token', async () => {
      await createUser({ username: 'alex' });
      const { app } = createTestApp();
      const agent = await loginAgent(app, { username: 'alex' });
      await agent.post('/logout').field('name', 'x').expect(403);
      await agent.post('/logout').set('Sec-Fetch-Site', 'same-site').field('name', 'x').expect(403);
      assert.equal(await isSignedIn(agent), true);
    });
  });
});

describe('flash messages', () => {
  it('follow the connect-flash API', () => {
    const req = { session: {} };
    flash()(req, {}, () => {});
    assert.equal(req.flash('info', 'One'), 1);
    assert.equal(req.flash('info', ['Two', 'Three']), 3);
    req.flash('error', 'Oops');
    assert.deepEqual(req.flash('info'), ['One', 'Two', 'Three']);
    assert.deepEqual(req.flash('info'), []);
    assert.deepEqual(req.flash(), { error: ['Oops'] });
    assert.deepEqual(req.session.flash, {});
    assert.throws(() => req.flash.call({}, 'info', 'x'), /requires sessions/);
  });

  it('are kept across redirects and read only when a view renders', async () => {
    const harness = createHarness();
    harness.get('/set', (req, res) => {
      req.flash('success', 'Saved.');
      req.flash('warning', 'Check the dates.');
      res.redirect('/show');
    });
    harness.get('/show', (req, res) => res.json(res.locals.messages));
    harness.get('/peek', (req, res) => res.json(Object.keys(res.locals)));

    const agent = request.agent(harness);
    await agent.get('/set').expect(302);
    const keys = (await agent.get('/peek')).body;
    assert.ok(keys.includes('messages') && keys.includes('csrfToken'));
    const shown = await agent.get('/show').expect(200);
    assert.deepEqual(shown.body, {
      success: ['Saved.'],
      error: [],
      info: [],
      warning: ['Check the dates.'],
    });
    const again = await agent.get('/show').expect(200);
    assert.deepEqual(again.body, { success: [], error: [], info: [], warning: [] });
  });
});

describe('error handler', () => {
  function errorHarness(error, configOverrides) {
    const harness = createHarness(configOverrides);
    harness.get('/boom', () => {
      throw error;
    });
    harness.use(errorHandler);
    return harness;
  }

  async function errorFor(error, configOverrides) {
    const response = await request(errorHarness(error, configOverrides))
      .get('/boom')
      .set('Accept', 'application/json');
    return { status: response.status, body: response.body };
  }

  it('maps known errors to status codes and safe messages', async () => {
    const castError = new mongoose.Error.CastError('ObjectId', 'nope', '_id');
    assert.equal((await errorFor(castError)).status, 404);

    const gone = new mongoose.Error.DocumentNotFoundError({ _id: 'x' }, 'Owner', 1, {});
    assert.equal((await errorFor(gone)).status, 404);
    const conflict = new mongoose.Error.VersionError({ _doc: { _id: 'x' } }, 1, ['file']);
    assert.equal((await errorFor(conflict)).status, 409);

    const csrfError = Object.assign(new Error('bad token'), { code: 'EBADCSRFTOKEN' });
    assert.equal((await errorFor(csrfError)).status, 403);

    const tooLarge = new multer.MulterError('LIMIT_FILE_SIZE', 'file');
    assert.deepEqual(await errorFor(tooLarge, { MAX_UPLOAD_MB: '2' }), {
      status: 413,
      body: { error: { status: 413, message: 'The file is too large. The maximum size is 2 MB.' } },
    });

    assert.deepEqual(await errorFor(createError(409, 'Already exists.')), {
      status: 409,
      body: { error: { status: 409, message: 'Already exists.' } },
    });
  });

  it('hides the details of unexpected errors', async () => {
    const logged = mock.method(console, 'error', () => {});
    try {
      assert.deepEqual(await errorFor(new Error('database password is hunter2')), {
        status: 500,
        body: { error: { status: 500, message: 'Something went wrong.' } },
      });
      assert.equal(logged.mock.callCount(), 1);
    } finally {
      logged.mock.restore();
    }
  });

  it('renders HTML for browsers', async () => {
    const response = await request(errorHarness(createError(404))).get('/boom');
    assert.equal(response.status, 404);
    assert.match(response.headers['content-type'], /text\/(html|plain)/);
  });
});

describe('health check', () => {
  it('returns 503 when MongoDB is not connected', async () => {
    const { app } = createTestApp();
    await mongoose.disconnect();
    try {
      const response = await request(app).get('/healthz').expect(503);
      assert.deepEqual(response.body, { status: 'unavailable' });
    } finally {
      await startTestDb();
    }
  });
});
