const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
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
let config;
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

/** Four documents of `owner`: expired, expiring soon, valid and without versions. */
async function createDocuments(owner) {
  const categories = await Category.create([
    { name: 'Passport', scope: 'personal' },
    { name: 'Driving licence', scope: 'personal' },
    { name: 'Work permit', scope: 'employee' },
    { name: 'Health insurance card', scope: 'personal' },
  ]);
  const documents = await Document.create(
    categories.map((category) => ({ owner: owner._id, category: category._id })),
  );
  await DocumentInstance.create([
    { document: documents[0]._id, expires_at: fromToday(-400) },
    { document: documents[0]._id, expires_at: fromToday(-10) },
    { document: documents[1]._id, expires_at: fromToday(5) },
    { document: documents[2]._id, expires_at: fromToday(400) },
  ]);
  return documents;
}

before(startTestDb);
after(stopTestDb);
beforeEach(async () => {
  await clearTestDb();
  await createUser({ username: 'member' });
  ({ app, config } = createTestApp());
  agent = await loginAgent(app, { username: 'member' });
});

describe('owner pages', () => {
  it('require signing in', async () => {
    const owner = await Owner.create({ first_name: 'Ana', last_name: 'Pop' });
    const anonymous = request.agent(app);
    for (const url of [
      '/owners',
      '/owners/new',
      `/owners/${owner._id}`,
      `/owners/${owner._id}/edit`,
    ]) {
      const response = await anonymous.get(url).expect(302);
      assert.equal(response.headers.location, '/login', url);
    }
    const _csrf = await getCsrfToken(anonymous);
    await anonymous
      .post('/owners')
      .type('form')
      .send({ first_name: 'Bea', last_name: 'Ray', _csrf })
      .expect(401);
    await anonymous
      .post(`/owners/${owner._id}?_method=DELETE`)
      .type('form')
      .send({ _csrf })
      .expect(401);
    assert.equal(await Owner.countDocuments(), 1);
  });

  it('answer unknown and malformed ids with 404', async () => {
    const missing = new mongoose.Types.ObjectId();
    for (const url of [
      '/owners/123',
      '/owners/not-an-owner',
      `/owners/${missing}`,
      `/owners/${missing}/edit`,
      '/owners/123/edit',
    ]) {
      await agent.get(url).expect(404);
    }
    for (const method of ['PUT', 'DELETE']) {
      for (const id of ['123', String(missing)]) {
        const response = await submit(method, `/owners/${id}`, { first_name: 'A', last_name: 'B' });
        assert.equal(response.status, 404, `${method} ${id}`);
      }
    }
  });
});

describe('adding and editing owners', () => {
  it('shows an empty form', async () => {
    const response = await agent.get('/owners/new').expect(200);
    assert.match(response.text, /<title>Add owner · /);
    assert.match(response.text, /<form method="post" action="\/owners"/);
    for (const name of ['first_name', 'last_name', 'email', 'phone', 'notes']) {
      assert.match(response.text, new RegExp(`name="${name}"`));
    }
  });

  it('adds an owner with a Unicode name and contact details', async () => {
    const response = await submit('POST', '/owners', {
      first_name: '  Zoë-Ann ',
      last_name: "O'Neil",
      email: ' Zoe.ONeil@Example.TEST ',
      phone: '+44 (0)20 7946-0000',
      notes: 'First line\r\nSecond <b>line</b>\u0007',
    });

    assert.equal(response.status, 302);
    const owner = await Owner.findOne().lean();
    assert.equal(response.headers.location, `/owners/${owner._id}`);
    assert.equal(owner.first_name, 'Zoë-Ann');
    assert.equal(owner.last_name, "O'Neil");
    assert.equal(owner.email, 'zoe.oneil@example.test');
    assert.equal(owner.phone, '+44 (0)20 7946-0000');
    assert.equal(owner.notes, 'First line\nSecond <b>line</b>');

    const page = await agent.get(response.headers.location).expect(200);
    assert.match(page.text, /Added Zoë-Ann O'Neil\./);
    assert.match(page.text, /href="mailto:zoe\.oneil@example\.test"/);
    assert.match(page.text, /href="tel:\+4402079460000"/);
    assert.match(page.text, /First line<br>Second &lt;b&gt;line&lt;\/b&gt;/);
  });

  it('accepts names in any script and leaves contact details optional', async () => {
    const names = [
      ['José María', 'Núñez'],
      ['Ștefan', 'Năstase'],
      ['Łucja', 'Wróbel-Kowalska'],
      ['J. R.', 'd’Arcy'],
      ['Ελένη', 'Παπαδοπούλου'],
      ['美咲', '山田'],
    ];
    for (const [first_name, last_name] of names) {
      const response = await submit('POST', '/owners', { first_name, last_name, email: '  ' });
      assert.equal(response.status, 302, `${first_name} ${last_name}`);
    }
    const owners = await Owner.find().lean();
    assert.equal(owners.length, names.length);
    for (const owner of owners) {
      assert.equal('email' in owner || 'phone' in owner || 'notes' in owner, false);
    }
  });

  it('rejects invalid input with 422 and keeps what was entered', async () => {
    const response = await submit('POST', '/owners', {
      first_name: 'Ana',
      last_name: 'Pop',
      email: 'not-an-email',
      phone: '0'.repeat(41),
    });

    assert.equal(response.status, 422);
    assert.match(response.text, /Please fix the following 2 problems/);
    assert.match(response.text, /Enter a valid email address/);
    assert.match(response.text, /The phone number must be at most 40 characters long\./);
    assert.match(response.text, /name="first_name" value="Ana"/);
    assert.match(response.text, /value="not-an-email"/);
    assert.match(response.text, /class="form-control is-invalid"/);
    assert.equal(await Owner.countDocuments(), 0);
  });

  it('accepts organisation names and free-form phone numbers', async () => {
    const owners = [
      { first_name: 'Bakery', last_name: '24' },
      { first_name: 'Smith & Sons', last_name: '(Holdings)' },
      { first_name: 'ACME, Inc.', last_name: 'R&D' },
      { first_name: '3M', last_name: 'Clinic2', phone: '+44 20 7946 0000 ext. 12' },
      { first_name: '<b>Bold</b>', last_name: 'Ltd', phone: 'Ask at reception' },
    ];
    for (const fields of owners) {
      const response = await submit('POST', '/owners', fields);
      assert.equal(response.status, 302, JSON.stringify(fields));
    }
    const saved = await Owner.find().sort({ _id: 1 }).lean();
    assert.deepEqual(
      saved.map(({ first_name, last_name, phone }) => ({ first_name, last_name, phone })),
      owners.map(({ first_name, last_name, phone }) => ({ first_name, last_name, phone })),
    );

    const withExtension = await agent.get(`/owners/${saved[3]._id}`).expect(200);
    assert.match(withExtension.text, /href="tel:\+442079460000"/);
    assert.match(withExtension.text, /\+44 20 7946 0000 ext\. 12/);
    const withoutNumber = await agent.get(`/owners/${saved[4]._id}`).expect(200);
    assert.doesNotMatch(withoutNumber.text, /href="tel:/);
    assert.match(withoutNumber.text, /Ask at reception/);
    assert.match(withoutNumber.text, /<title>&lt;b&gt;Bold&lt;\/b&gt; Ltd · /);
  });

  it('turns line breaks into spaces and drops control characters', async () => {
    const response = await submit('POST', '/owners', {
      first_name: ' Example\r\nBakery\u0000 ',
      last_name: 'Ltd\u0007',
      phone: '+1 555\n0100',
    });

    assert.equal(response.status, 302);
    const owner = await Owner.findOne().lean();
    assert.equal(owner.first_name, 'Example Bakery');
    assert.equal(owner.last_name, 'Ltd');
    assert.equal(owner.phone, '+1 555 0100');
  });

  it('rejects missing and over-long values', async () => {
    const cases = [
      [{ first_name: '', last_name: 'Pop' }, /Enter a first name\./],
      [{ first_name: 'Ana', last_name: '   ' }, /Enter a last name\./],
      [{ first_name: '\u0000\u0007', last_name: 'Pop' }, /Enter a first name\./],
      [{ first_name: 'A'.repeat(101), last_name: 'Pop' }, /first name must be at most 100/],
      [{ first_name: 'Ana', last_name: 'P'.repeat(101) }, /last name must be at most 100/],
      [{ first_name: 'Ana', last_name: 'Pop', phone: '1'.repeat(41) }, /at most 40 characters/],
      [{ first_name: 'Ana', last_name: 'Pop', notes: 'n'.repeat(2001) }, /at most 2000/],
      [{ first_name: 'Ana', last_name: 'Pop', email: `${'e'.repeat(250)}@example.test` }, /254/],
    ];
    for (const [fields, message] of cases) {
      const response = await submit('POST', '/owners', fields);
      assert.equal(response.status, 422, JSON.stringify(fields));
      assert.match(response.text, message);
    }
    assert.equal(await Owner.countDocuments(), 0);
  });

  it('rejects values that are not strings', async () => {
    const _csrf = await getCsrfToken(agent);
    const repeated = await agent
      .post('/owners')
      .type('form')
      .send(`first_name=Ana&first_name=Bea&last_name=Pop&_csrf=${encodeURIComponent(_csrf)}`);
    assert.equal(repeated.status, 422);
    assert.match(repeated.text, /Enter a first name\./);

    const json = await agent
      .post('/owners')
      .set('x-csrf-token', _csrf)
      .send({ first_name: { $gt: '' }, last_name: 'Pop', email: ['ana@example.test'] });
    assert.equal(json.status, 422);
    assert.match(json.text, /Enter a valid email address\./);
    assert.equal(await Owner.countDocuments(), 0);
  });

  it('edits an owner and clears optional fields', async () => {
    const owner = await Owner.create({
      first_name: 'Ana',
      last_name: 'Pop',
      email: 'ana@example.test',
      phone: '+40 21 000 0000',
      notes: 'Old notes',
    });
    const form = await agent.get(`/owners/${owner._id}/edit`).expect(200);
    assert.match(form.text, /<title>Edit Ana Pop · /);
    assert.match(form.text, new RegExp(`action="/owners/${owner._id}\\?_method=PUT"`));
    assert.match(form.text, /value="ana@example\.test"/);
    assert.match(form.text, />Old notes<\/textarea>/);

    const response = await submit('PUT', `/owners/${owner._id}`, {
      first_name: 'Ana-Maria',
      last_name: 'Pop',
      email: '',
      phone: '',
      notes: '',
    });
    assert.equal(response.status, 302);
    assert.equal(response.headers.location, `/owners/${owner._id}`);
    const saved = await Owner.findById(owner._id).lean();
    assert.equal(saved.first_name, 'Ana-Maria');
    assert.equal('email' in saved || 'phone' in saved || 'notes' in saved, false);
    const page = await agent.get(`/owners/${owner._id}`).expect(200);
    assert.match(page.text, /Saved the changes to Ana-Maria Pop\./);

    const invalid = await submit('PUT', `/owners/${owner._id}`, {
      first_name: 'Ana 2',
      last_name: 'Pop',
      email: 'nope',
    });
    assert.equal(invalid.status, 422);
    assert.match(invalid.text, /<title>Edit Ana-Maria Pop · /);
    assert.match(invalid.text, /value="Ana 2"/);
    assert.equal((await Owner.findById(owner._id)).first_name, 'Ana-Maria');
  });

  it('keeps owners with names from older versions editable', async () => {
    const owner = await Owner.create({ first_name: 'Clinic2', last_name: 'Main St. 5' });

    const form = await agent.get(`/owners/${owner._id}/edit`).expect(200);
    assert.match(form.text, /value="Clinic2"/);
    const response = await submit('PUT', `/owners/${owner._id}`, {
      first_name: 'Clinic2',
      last_name: 'Main St. 5',
      phone: '+1 555 0100 ext. 7',
    });

    assert.equal(response.status, 302);
    const saved = await Owner.findById(owner._id).lean();
    assert.equal(saved.first_name, 'Clinic2');
    assert.equal(saved.phone, '+1 555 0100 ext. 7');
  });
});

describe('owners list', () => {
  it('shows an empty state without owners', async () => {
    const response = await agent.get('/owners').expect(200);
    assert.match(response.text, /No owners yet/);
    assert.match(response.text, /href="\/owners\/new"/);
  });

  it('sorts by last name, ignoring case, with document counts and status badges', async () => {
    const [ana, bea, zed] = await Owner.create([
      { first_name: 'Ana', last_name: 'Pop' },
      { first_name: 'Bea', last_name: 'Brown', email: 'bea@example.test', phone: '+1 555 0100' },
      { first_name: 'Zed', last_name: 'adams' },
    ]);
    await createDocuments(ana);

    const response = await agent.get('/owners').expect(200);

    const positions = [zed, bea, ana].map((owner) => response.text.indexOf(`href="${owner.url}"`));
    assert.ok(positions[0] > 0 && positions[0] < positions[1] && positions[1] < positions[2]);
    const anaRow = rowFor(response.text, ana.url);
    assert.match(anaRow, /<td class="text-end">4<\/td>/);
    assert.match(anaRow, /1 expired/);
    assert.match(anaRow, /1 expiring soon/);
    const beaRow = rowFor(response.text, bea.url);
    assert.match(beaRow, /<td class="text-end">0<\/td>/);
    assert.match(beaRow, /href="mailto:bea@example\.test"/);
    assert.match(beaRow, /href="tel:\+15550100"/);
    assert.doesNotMatch(beaRow, /expired|expiring/);
  });

  it('searches regardless of accents', async () => {
    const [accented, plain] = await Owner.create([
      { first_name: 'Ștefan', last_name: 'Ionescu' },
      { first_name: 'Stefan', last_name: 'Zoë' },
    ]);
    const found = async (query) => {
      const response = await agent.get(`/owners?q=${encodeURIComponent(query)}`).expect(200);
      return [accented, plain]
        .filter((owner) => response.text.includes(`href="${owner.url}"`))
        .map((owner) => owner.last_name);
    };

    assert.deepEqual(await found('stefan'), ['Ionescu', 'Zoë']);
    assert.deepEqual(await found('ȘTEFAN ionescu'), ['Ionescu']);
    assert.deepEqual(await found('zoe'), ['Zoë']);
  });

  it('searches by name and email address', async () => {
    const [anaPop, beaBrown, anaBrown] = await Owner.create([
      { first_name: 'Ana', last_name: 'Pop', email: 'ana@example.test' },
      { first_name: 'Bea', last_name: 'Brown', email: 'bea@work.example' },
      { first_name: 'Ana', last_name: 'Brown' },
    ]);
    const everyone = [anaPop, beaBrown, anaBrown].map((owner) => owner.name);
    const search = async (query) => {
      const response = await agent.get(`/owners?${query}`).expect(200);
      return [anaPop, beaBrown, anaBrown]
        .filter((owner) => response.text.includes(`href="${owner.url}"`))
        .map((owner) => owner.name);
    };

    assert.deepEqual(await search('q=ANA'), ['Ana Pop', 'Ana Brown']);
    assert.deepEqual(await search('q=brown+ana'), ['Ana Brown']);
    assert.deepEqual(await search('q=work.example'), ['Bea Brown']);
    assert.deepEqual(await search('q=.*'), []);
    assert.deepEqual(await search('q=a&q=b'), everyone);
    assert.deepEqual(await search(`q=${'a'.repeat(101)}`), everyone);

    const none = await agent.get('/owners?q=nobody').expect(200);
    assert.match(none.text, /No matching owners/);
    assert.match(none.text, /value="nobody"/);
  });
});

describe('owner details', () => {
  it('shows the contact details, notes and documents with their statuses', async () => {
    const owner = await Owner.create({
      first_name: 'Ana',
      last_name: 'Pop',
      email: 'ana@example.test',
      notes: 'Keeps the originals at home.',
    });
    const documents = await createDocuments(owner);

    const response = await agent.get(`/owners/${owner._id}`).expect(200);

    assert.match(response.text, /<title>Ana Pop · /);
    assert.match(response.text, /href="mailto:ana@example\.test"/);
    assert.match(response.text, /Keeps the originals at home\./);
    const expected = [
      ['Passport', 'Expired'],
      ['Driving licence', 'Expiring soon'],
      ['Work permit', 'Valid'],
      ['Health insurance card', 'No versions'],
    ];
    expected.forEach(([category, status], index) => {
      const row = rowFor(response.text, documents[index].url);
      assert.match(row, new RegExp(`>${category}</a>`));
      assert.match(row, new RegExp(`</i>${status}</span>`));
    });
    assert.match(response.text, new RegExp(`href="/documents/new\\?owner=${owner._id}"`));
    assert.match(response.text, new RegExp(`href="/versions/new\\?owner=${owner._id}"`));
    assert.match(response.text, new RegExp(`href="/owners/${owner._id}/edit"`));
    assert.match(response.text, new RegExp(`action="/owners/${owner._id}\\?_method=DELETE"`));
    assert.match(response.text, /All their documents, versions and uploaded files will be removed/);
  });

  it('suggests adding a document when there are none', async () => {
    const owner = await Owner.create({ first_name: 'Ana', last_name: 'Pop' });
    const response = await agent.get(`/owners/${owner._id}`).expect(200);
    assert.match(response.text, /No documents yet/);
    assert.match(response.text, /Not provided/);
  });
});

describe('deleting owners', () => {
  function storeFile(name) {
    fs.writeFileSync(path.join(config.uploads.dir, name), '%PDF-1.4\n');
    return { stored_name: name, original_name: name, mime_type: 'application/pdf', size: 9 };
  }

  it('removes the owner with their documents, versions and files', async () => {
    const [ana, bea] = await Owner.create([
      { first_name: 'Ana', last_name: 'Pop' },
      { first_name: 'Bea', last_name: 'Ray' },
    ]);
    const [passport, permit] = await Category.create([{ name: 'Passport' }, { name: 'Permit' }]);
    const [anaPassport, anaPermit, beaPassport] = await Document.create([
      { owner: ana._id, category: passport._id },
      { owner: ana._id, category: permit._id },
      { owner: bea._id, category: passport._id },
    ]);
    await DocumentInstance.create([
      { document: anaPassport._id, expires_at: fromToday(-100), file: storeFile('ana-1.pdf') },
      { document: anaPassport._id, expires_at: fromToday(900), file: storeFile('ana-2.pdf') },
      { document: anaPermit._id, expires_at: fromToday(10) },
      { document: beaPassport._id, expires_at: fromToday(500), file: storeFile('bea.pdf') },
    ]);

    const response = await submit('DELETE', ana.url);

    assert.equal(response.status, 302);
    assert.equal(response.headers.location, '/owners');
    const list = await agent.get('/owners').expect(200);
    assert.match(list.text, /Deleted Ana Pop together with 2 documents and 3 versions\./);
    assert.equal(await Owner.exists({ _id: ana._id }), null);
    assert.deepEqual(
      (await Document.find().lean()).map((document) => String(document._id)),
      [String(beaPassport._id)],
    );
    assert.equal(await DocumentInstance.countDocuments(), 1);
    assert.deepEqual(fs.readdirSync(config.uploads.dir), ['bea.pdf']);
    assert.equal(await Category.countDocuments(), 2);
  });

  it('removes an owner without documents', async () => {
    const owner = await Owner.create({ first_name: 'Cara', last_name: 'Lone' });
    const response = await submit('DELETE', owner.url);
    assert.equal(response.headers.location, '/owners');
    const list = await agent.get('/owners').expect(200);
    assert.match(list.text, /Deleted Cara Lone\./);
    assert.equal(await Owner.countDocuments(), 0);
  });

  it('also removes documents added while the owner is being deleted', async () => {
    const owner = await Owner.create({ first_name: 'Ana', last_name: 'Pop' });
    const [passport, permit] = await Category.create([{ name: 'Passport' }, { name: 'Permit' }]);
    await Document.create({ owner: owner._id, category: passport._id });
    const exec = mongoose.Query.prototype.exec;
    let fired = false;
    // Simulates an upload that creates a document right before the owner itself is deleted.
    mock.method(mongoose.Query.prototype, 'exec', async function (...args) {
      if (!fired && this.op === 'deleteOne' && this.model === Owner) {
        fired = true;
        const late = await Document.create({ owner: owner._id, category: permit._id });
        await DocumentInstance.create({
          document: late._id,
          expires_at: fromToday(30),
          file: storeFile('late.pdf'),
        });
      }
      return exec.apply(this, args);
    });
    let response;
    try {
      response = await submit('DELETE', owner.url);
    } finally {
      mock.restoreAll();
    }

    assert.equal(fired, true);
    assert.equal(response.headers.location, '/owners');
    const list = await agent.get('/owners').expect(200);
    assert.match(list.text, /Deleted Ana Pop together with 2 documents and 1 version\./);
    assert.equal(await Owner.countDocuments(), 0);
    assert.equal(await Document.countDocuments(), 0);
    assert.equal(await DocumentInstance.countDocuments(), 0);
    assert.deepEqual(fs.readdirSync(config.uploads.dir), []);
  });
});
