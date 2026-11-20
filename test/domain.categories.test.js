const assert = require('node:assert/strict');
const { after, before, beforeEach, describe, it, mock } = require('node:test');
const mongoose = require('mongoose');
const request = require('supertest');

const Category = require('../models/category');
const Document = require('../models/document');
const DocumentInstance = require('../models/documentInstance');
const Owner = require('../models/owner');
const { todayUtc } = require('../services/status');
const { createTestApp, createUser, getCsrfToken, loginAgent } = require('./helpers/app');
const { clearTestDb, startTestDb, stopTestDb } = require('./helpers/db');

const DAY_MS = 24 * 60 * 60 * 1000;

let app;
let agent;

function fromToday(days) {
  return new Date(todayUtc().getTime() + days * DAY_MS);
}

/** Sends a form like the browser does: POST with `_method` for PUT/DELETE and the CSRF token. */
async function submit(method, url, fields = {}) {
  const _csrf = await getCsrfToken(agent);
  const target = method === 'POST' ? url : `${url}?_method=${method}`;
  return agent
    .post(target)
    .type('form')
    .send({ ...fields, _csrf });
}

/** The table row that links to `href`. */
function rowFor(html, href) {
  return html.split(/<tr[\s>]/).find((row) => row.includes(`href="${href}"`)) ?? '';
}

/** Documents of `category` for each owner name, e.g. `{ 'Ana Pop': [-5] }` (expiry offsets). */
async function createDocuments(category, versionsByOwner) {
  const documents = [];
  for (const [name, offsets] of Object.entries(versionsByOwner)) {
    const [first_name, last_name] = name.split(' ');
    const owner = await Owner.create({ first_name, last_name });
    const document = await Document.create({ owner: owner._id, category: category._id });
    for (const days of offsets) {
      await DocumentInstance.create({ document: document._id, expires_at: fromToday(days) });
    }
    documents.push(document);
  }
  return documents;
}

before(startTestDb);
after(stopTestDb);
beforeEach(async () => {
  await clearTestDb();
  await createUser({ username: 'member' });
  ({ app } = createTestApp());
  agent = await loginAgent(app, { username: 'member' });
});

describe('category pages', () => {
  it('require signing in', async () => {
    const category = await Category.create({ name: 'Passport' });
    const anonymous = request.agent(app);
    for (const url of ['/categories', '/categories/new', category.url, `${category.url}/edit`]) {
      const response = await anonymous.get(url).expect(302);
      assert.equal(response.headers.location, '/login', url);
    }
    const _csrf = await getCsrfToken(anonymous);
    await anonymous
      .post('/categories')
      .type('form')
      .send({ name: 'Visa', scope: 'personal', _csrf })
      .expect(401);
    await anonymous.post(`${category.url}?_method=DELETE`).type('form').send({ _csrf }).expect(401);
    assert.equal(await Category.countDocuments(), 1);
  });

  it('answer unknown and malformed ids with 404', async () => {
    const missing = new mongoose.Types.ObjectId();
    for (const url of [
      '/categories/123',
      `/categories/${missing}`,
      `/categories/${missing}/edit`,
      '/categories/x/edit',
    ]) {
      await agent.get(url).expect(404);
    }
    for (const method of ['PUT', 'DELETE']) {
      for (const id of ['123', String(missing)]) {
        const response = await submit(method, `/categories/${id}`, {
          name: 'Visa',
          scope: 'personal',
        });
        assert.equal(response.status, 404, `${method} ${id}`);
      }
    }
  });
});

describe('adding and editing categories', () => {
  it('shows a form that explains the scopes', async () => {
    const response = await agent.get('/categories/new').expect(200);
    assert.match(response.text, /<title>Add category · /);
    assert.match(response.text, /id="scope-personal"[^>]* checked/);
    assert.match(response.text, /Personal — an individual’s own documents/);
    assert.match(response.text, /Company — documents of the organisation itself/);
    assert.match(response.text, /Employee — documents an organisation keeps for its staff/);

    const preset = await agent.get('/categories/new?scope=company').expect(200);
    assert.match(preset.text, /id="scope-company"[^>]* checked/);
    const ignored = await agent.get('/categories/new?scope=global').expect(200);
    assert.match(ignored.text, /id="scope-personal"[^>]* checked/);
  });

  it('adds a category', async () => {
    const response = await submit('POST', '/categories', {
      name: '  Fire\u0000   safety certificate ',
      scope: 'company',
      description: 'Yearly inspection.\r\nKeep a copy on site.',
    });

    assert.equal(response.status, 302);
    const category = await Category.findOne().lean();
    assert.equal(response.headers.location, `/categories/${category._id}`);
    assert.equal(category.name, 'Fire safety certificate');
    assert.equal(category.scope, 'company');
    assert.equal(category.description, 'Yearly inspection.\nKeep a copy on site.');

    const page = await agent.get(response.headers.location).expect(200);
    assert.match(page.text, /Added the category Fire safety certificate\./);
    assert.match(page.text, /Yearly inspection\.<br>Keep a copy on site\./);
    assert.match(page.text, /<\/i>Company<\/span>/);
  });

  it('rejects names that already exist, ignoring case', async () => {
    await Category.create({ name: 'Passport', scope: 'personal' });

    const response = await submit('POST', '/categories', { name: ' PASSPORT ', scope: 'company' });

    assert.equal(response.status, 422);
    assert.match(response.text, /A category called “Passport” already exists\./);
    assert.match(response.text, /value="PASSPORT"/);
    assert.match(response.text, /id="scope-company"[^>]* checked/);
    assert.equal(await Category.countDocuments(), 1);
  });

  it('reports duplicates found by the unique index', async () => {
    await Category.create({ name: 'Passport', scope: 'personal' });
    const unchecked = { collation: () => ({ select: async () => null }) };
    const findOne = mock.method(Category, 'findOne', () => unchecked);
    try {
      const response = await submit('POST', '/categories', { name: 'Passport', scope: 'personal' });
      assert.equal(response.status, 422);
      assert.match(response.text, /A category with this name already exists\./);
    } finally {
      findOne.mock.restore();
    }
    assert.equal(await Category.countDocuments(), 1);
  });

  it('validates the name, the scope and the description', async () => {
    const cases = [
      [{ name: 'Visa' }, /Choose a scope\./],
      [{ name: 'Visa', scope: 'global' }, /Choose a scope\./],
      [{ name: 'Visa', scope: '__proto__' }, /Choose a scope\./],
      [{ name: '   ', scope: 'personal' }, /Enter a name\./],
      [{ name: 'V'.repeat(101), scope: 'personal' }, /at most 100 characters/],
      [{ name: 'Visa', scope: 'personal', description: 'd'.repeat(501) }, /at most 500 characters/],
    ];
    for (const [fields, message] of cases) {
      const response = await submit('POST', '/categories', fields);
      assert.equal(response.status, 422, JSON.stringify(fields));
      assert.match(response.text, message);
    }

    const _csrf = await getCsrfToken(agent);
    const repeated = await agent
      .post('/categories')
      .type('form')
      .send(`name=Visa&scope=personal&scope=company&_csrf=${encodeURIComponent(_csrf)}`);
    assert.equal(repeated.status, 422);
    const json = await agent
      .post('/categories')
      .set('x-csrf-token', _csrf)
      .send({ name: ['Visa'], scope: { $ne: null } });
    assert.equal(json.status, 422);
    assert.match(json.text, /Enter a name\./);
    assert.equal(await Category.countDocuments(), 0);
  });

  it('edits a category', async () => {
    const passport = await Category.create({
      name: 'Passport',
      scope: 'personal',
      description: 'Old',
    });
    await Category.create({ name: 'Visa', scope: 'personal' });

    const form = await agent.get(`${passport.url}/edit`).expect(200);
    assert.match(form.text, /<title>Edit Passport · /);
    assert.match(form.text, new RegExp(`action="${passport.url}\\?_method=PUT"`));
    assert.match(form.text, /id="scope-personal"[^>]* checked/);

    const renamed = await submit('PUT', passport.url, {
      name: 'passport',
      scope: 'employee',
      description: '',
    });
    assert.equal(renamed.status, 302);
    assert.equal(renamed.headers.location, passport.url);
    const saved = await Category.findById(passport._id).lean();
    assert.equal(saved.name, 'passport');
    assert.equal(saved.scope, 'employee');
    assert.equal('description' in saved, false);

    const duplicate = await submit('PUT', passport.url, { name: 'VISA', scope: 'personal' });
    assert.equal(duplicate.status, 422);
    assert.match(duplicate.text, /A category called “Visa” already exists\./);
    assert.match(duplicate.text, /<title>Edit passport · /);
    assert.equal((await Category.findById(passport._id)).name, 'passport');
  });
});

describe('categories list', () => {
  it('shows an empty state without categories', async () => {
    const response = await agent.get('/categories').expect(200);
    assert.match(response.text, /No categories yet/);
    assert.match(response.text, /href="\/categories\/new"/);
  });

  it('lists categories by name with their scope and number of documents', async () => {
    const [passport, licence, permit] = await Category.create([
      { name: 'passport', scope: 'personal', description: 'Travel document.' },
      { name: 'Business licence', scope: 'company' },
      { name: 'Work permit', scope: 'employee' },
    ]);
    await createDocuments(passport, { 'Ana Pop': [10], 'Bea Ray': [] });

    const response = await agent.get('/categories').expect(200);

    const positions = [licence, passport, permit].map((category) =>
      response.text.indexOf(`href="${category.url}"`),
    );
    assert.ok(positions[0] > 0 && positions[0] < positions[1] && positions[1] < positions[2]);
    const passportRow = rowFor(response.text, passport.url);
    assert.match(passportRow, /<\/i>Personal<\/span>/);
    assert.match(passportRow, /Travel document\./);
    assert.match(passportRow, /<td class="text-end">2<\/td>/);
    assert.match(rowFor(response.text, permit.url), /<td class="text-end">0<\/td>/);
  });

  it('filters by scope and ignores invalid filters', async () => {
    const [passport, licence, permit] = await Category.create([
      { name: 'Passport', scope: 'personal' },
      { name: 'Business licence', scope: 'company' },
      { name: 'Work permit', scope: 'employee' },
    ]);
    const listed = async (query) => {
      const response = await agent.get(`/categories${query}`).expect(200);
      return [passport, licence, permit]
        .filter((category) => response.text.includes(`href="${category.url}"`))
        .map((category) => category.name);
    };

    assert.deepEqual(await listed('?scope=company'), ['Business licence']);
    assert.deepEqual(await listed('?scope=employee'), ['Work permit']);
    for (const query of ['', '?scope=global', '?scope=company&scope=personal', '?scope[$ne]=x']) {
      assert.deepEqual(await listed(query), ['Passport', 'Business licence', 'Work permit'], query);
    }

    const pills = await agent.get('/categories?scope=company').expect(200);
    assert.match(
      pills.text,
      /class="[^"]*\bactive" href="\/categories\?scope=company" aria-current="page"/,
    );

    await Category.deleteOne({ _id: permit._id });
    const empty = await agent.get('/categories?scope=employee').expect(200);
    assert.match(empty.text, /No employee categories/);
    assert.match(empty.text, /href="\/categories\/new\?scope=employee"/);
  });
});

describe('category details', () => {
  it('shows the description, scope and documents with their statuses', async () => {
    const category = await Category.create({
      name: 'Passport',
      scope: 'personal',
      description: 'Travel document.',
    });
    const [ana, bea] = await createDocuments(category, { 'Ana Pop': [-3], 'Bea Ray': [] });

    const response = await agent.get(category.url).expect(200);

    assert.match(response.text, /<title>Passport · /);
    assert.match(response.text, /Travel document\./);
    assert.match(response.text, /<\/i>Personal<\/span>/);
    assert.match(rowFor(response.text, ana.url), />Ana Pop<\/a>/);
    assert.match(rowFor(response.text, ana.url), /<\/i>Expired<\/span>/);
    assert.match(rowFor(response.text, bea.url), />Bea Ray<\/a>/);
    assert.match(rowFor(response.text, bea.url), /<\/i>No versions<\/span>/);
    assert.match(response.text, new RegExp(`href="/documents/new\\?category=${category._id}"`));
    assert.match(response.text, new RegExp(`href="${category.url}/edit"`));
    assert.match(response.text, /<button [^>]*btn-outline-danger[^>]* disabled>/);
  });

  it('offers deleting a category without documents', async () => {
    const category = await Category.create({ name: 'Visa', scope: 'personal' });
    const response = await agent.get(category.url).expect(200);
    assert.match(response.text, /No documents yet/);
    assert.match(
      response.text,
      /data-confirm="Delete the category Visa\? This cannot be undone\."/,
    );
  });
});

describe('deleting categories', () => {
  it('is refused while documents use the category', async () => {
    const passport = await Category.create({ name: 'Passport', scope: 'personal' });
    const permit = await Category.create({ name: 'Work permit', scope: 'employee' });
    await createDocuments(passport, { 'Ana Pop': [10], 'Bea Ray': [] });
    await createDocuments(permit, { 'Cara Lee': [] });

    const response = await submit('DELETE', passport.url);
    assert.equal(response.status, 302);
    assert.equal(response.headers.location, passport.url);
    const page = await agent.get(passport.url).expect(200);
    assert.match(page.text, /Passport is used by 2 documents\. Delete those documents first\./);

    await submit('DELETE', permit.url);
    const single = await agent.get(permit.url).expect(200);
    assert.match(single.text, /Work permit is used by 1 document\. Delete those documents first\./);
    assert.equal(await Category.countDocuments(), 2);
    assert.equal(await Document.countDocuments(), 3);
  });

  it('deletes an unused category', async () => {
    const visa = await Category.create({ name: 'Visa', scope: 'personal' });
    const response = await submit('DELETE', visa.url);
    assert.equal(response.status, 302);
    assert.equal(response.headers.location, '/categories');
    const list = await agent.get('/categories').expect(200);
    assert.match(list.text, /Deleted the category Visa\./);
    assert.equal(await Category.countDocuments(), 0);
  });

  it('restores the category when a document is added while it is being deleted', async () => {
    const visa = await Category.create({ name: 'Visa', scope: 'employee', description: 'Work.' });
    const stored = await Category.collection.findOne({ _id: visa._id });
    const owner = await Owner.create({ first_name: 'Ana', last_name: 'Pop' });
    const exec = mongoose.Query.prototype.exec;
    let fired = false;
    // Simulates an upload that creates a document between the usage check and the delete.
    mock.method(mongoose.Query.prototype, 'exec', async function (...args) {
      if (!fired && this.op === 'findOneAndDelete' && this.model === Category) {
        fired = true;
        await Document.create({ owner: owner._id, category: visa._id });
      }
      return exec.apply(this, args);
    });
    let response;
    try {
      response = await submit('DELETE', visa.url);
    } finally {
      mock.restoreAll();
    }

    assert.equal(fired, true);
    assert.equal(response.headers.location, visa.url);
    const page = await agent.get(visa.url).expect(200);
    assert.match(page.text, /Visa is used by 1 document\. Delete those documents first\./);
    assert.deepEqual(await Category.collection.findOne({ _id: visa._id }), stored);
    assert.equal(await Document.countDocuments({ category: visa._id }), 1);
  });
});
