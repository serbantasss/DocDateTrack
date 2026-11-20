const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { after, before, beforeEach, describe, it, mock } = require('node:test');

const Category = require('../models/category');
const Document = require('../models/document');
const DocumentInstance = require('../models/documentInstance');
const Owner = require('../models/owner');
const { todayUtc } = require('../services/status');
const { createTestApp, createUser, getCsrfToken, loginAgent } = require('./helpers/app');
const { clearTestDb, startTestDb, stopTestDb } = require('./helpers/db');

const DAY_MS = 24 * 60 * 60 * 1000;
const daysFromToday = (days) => new Date(todayUtc().getTime() + days * DAY_MS);

async function signedIn() {
  await createUser({ username: 'member' });
  const { app, config } = createTestApp({ EXPIRY_WARNING_DAYS: '30' });
  return { agent: await loginAgent(app, { username: 'member' }), config };
}

/** Ids of the documents listed in a documents table, in display order. */
function listedIds(html) {
  return [...html.matchAll(/data-document-id="([a-f0-9]{24})"/g)].map((match) => match[1]);
}

function statusCount(html, status) {
  const match = new RegExp(
    `data-status-filter="${status}">.*?<span class="badge[^"]*">(\\d+)</span>`,
  ).exec(html);
  return match ? Number(match[1]) : null;
}

async function createFixtures() {
  const [ana, ben] = await Owner.create([
    { first_name: 'Ana', last_name: 'Pop' },
    { first_name: 'Ștefan', last_name: 'Ray' },
  ]);
  const [passport, insurance] = await Category.create([
    { name: 'Passport', scope: 'personal' },
    { name: 'Car insurance', scope: 'company' },
  ]);
  const [anaPassport, anaInsurance, benPassport, benInsurance] = await Document.create([
    { owner: ana, category: passport },
    { owner: ana, category: insurance },
    { owner: ben, category: passport },
    { owner: ben, category: insurance },
  ]);
  await DocumentInstance.create([
    { document: anaPassport, expires_at: daysFromToday(-20) },
    { document: anaInsurance, expires_at: daysFromToday(10) },
    { document: benPassport, expires_at: daysFromToday(400) },
  ]);
  return { ana, ben, passport, insurance, anaPassport, anaInsurance, benPassport, benInsurance };
}

before(startTestDb);
after(stopTestDb);
beforeEach(clearTestDb);

describe('documents list', () => {
  it('lists every document, most urgent first, with counts per status', async () => {
    const { agent } = await signedIn();
    const f = await createFixtures();

    const page = await agent.get('/documents').expect(200);
    assert.match(page.text, /<title>Documents · DocDateTrack<\/title>/);
    assert.deepEqual(listedIds(page.text), [
      String(f.anaPassport._id),
      String(f.anaInsurance._id),
      String(f.benInsurance._id),
      String(f.benPassport._id),
    ]);
    assert.equal(statusCount(page.text, 'all'), 4);
    assert.equal(statusCount(page.text, 'expired'), 1);
    assert.equal(statusCount(page.text, 'missing'), 1);
    assert.match(page.text, /<select[^>]*name="owner"[^>]*data-autosubmit/);
    assert.match(page.text, /<button class="btn btn-sm btn-primary" type="submit">/);
  });

  it('filters by status, owner, category, scope and search text', async () => {
    const { agent } = await signedIn();
    const f = await createFixtures();
    const ids = async (query) => listedIds((await agent.get('/documents').query(query)).text);

    assert.deepEqual(await ids({ status: 'expired' }), [String(f.anaPassport._id)]);
    assert.deepEqual(await ids({ owner: String(f.ben._id) }), [
      String(f.benInsurance._id),
      String(f.benPassport._id),
    ]);
    assert.deepEqual(await ids({ category: String(f.passport._id), status: 'valid' }), [
      String(f.benPassport._id),
    ]);
    assert.deepEqual(await ids({ scope: 'company' }), [
      String(f.anaInsurance._id),
      String(f.benInsurance._id),
    ]);
    assert.deepEqual(await ids({ scope: 'company', category: String(f.passport._id) }), []);
    // Case-insensitive, every word must match, diacritics are ignored.
    assert.deepEqual(await ids({ q: 'stefan PASSPORT' }), [String(f.benPassport._id)]);
    assert.deepEqual(await ids({ q: 'insurance' }), [
      String(f.anaInsurance._id),
      String(f.benInsurance._id),
    ]);

    // The status counts follow the other filters.
    const filtered = await agent.get('/documents').query({ owner: String(f.ana._id) });
    assert.equal(statusCount(filtered.text, 'all'), 2);
    assert.equal(statusCount(filtered.text, 'expiring'), 1);
    assert.match(filtered.text, new RegExp(`href="/documents\\?owner=${f.ana._id}&amp;status=`));
  });

  it('ignores invalid filter values', async () => {
    const { agent } = await signedIn();
    await createFixtures();
    for (const query of [
      'owner=nope&category=123&scope=global&status=lost',
      'owner[$ne]=1&status[]=expired',
      'status=expired&status=valid&q=a&q=b',
      `q=${'x'.repeat(101)}`,
      'page=-1',
      'page=abc',
      'page=99999999',
    ]) {
      const page = await agent.get(`/documents?${query}`).expect(200);
      assert.equal(listedIds(page.text).length, 4, query);
    }
  });

  it('shows 50 documents per page and keeps the filters in the page links', async () => {
    const { agent } = await signedIn();
    const category = await Category.create({ name: 'Permit' });
    const owners = await Owner.create(
      Array.from({ length: 55 }, (_, index) => ({
        first_name: `Person${String(index).padStart(2, '0')}`,
        last_name: 'Test',
      })),
    );
    await Document.create(owners.map((owner) => ({ owner, category })));

    const first = await agent.get('/documents?q=test').expect(200);
    assert.equal(listedIds(first.text).length, 50);
    assert.match(first.text, /Showing 1–50 of 55 documents/);
    assert.match(first.text, /href="\/documents\?q=test&amp;page=2" rel="next"/);

    const second = await agent.get('/documents?q=test&page=2').expect(200);
    assert.equal(listedIds(second.text).length, 5);
    assert.match(second.text, /Showing 51–55 of 55 documents/);
    assert.match(second.text, /href="\/documents\?q=test" rel="prev"/);

    const beyond = await agent.get('/documents?q=test&page=7').expect(200);
    assert.deepEqual(listedIds(beyond.text), listedIds(second.text));
  });

  it('tells "no documents yet" apart from "no matches"', async () => {
    const { agent } = await signedIn();
    const empty = await agent.get('/documents').expect(200);
    assert.match(empty.text, /No documents yet/);

    await createFixtures();
    const noMatch = await agent.get('/documents?q=nobody').expect(200);
    assert.match(noMatch.text, /No documents match these filters/);
    assert.equal(listedIds(noMatch.text).length, 0);
  });
});

describe('adding documents', () => {
  it('preselects the owner and the category from the query string', async () => {
    const { agent } = await signedIn();
    const f = await createFixtures();
    const page = await agent
      .get(`/documents/new?owner=${f.ben._id}&category=${f.insurance._id}`)
      .expect(200);
    assert.match(page.text, new RegExp(`<option value="${f.ben._id}" selected>`));
    assert.match(page.text, new RegExp(`<option value="${f.insurance._id}" selected>`));
  });

  it('asks for an owner and a category first when there are none', async () => {
    const { agent } = await signedIn();
    await Category.create({ name: 'Passport' });
    const page = await agent.get('/documents/new').expect(200);
    assert.match(page.text, /href="\/owners\/new">Add an owner/);
    assert.doesNotMatch(page.text, /href="\/categories\/new">Add a category/);
    assert.doesNotMatch(page.text, /<form method="post" action="\/documents"/);
  });

  it('creates the document and opens it', async () => {
    const { agent } = await signedIn();
    const owner = await Owner.create({ first_name: 'Ana', last_name: 'Pop' });
    const category = await Category.create({ name: 'Passport' });
    const _csrf = await getCsrfToken(agent);

    const response = await agent
      .post('/documents')
      .type('form')
      .send({ _csrf, owner: String(owner._id), category: String(category._id), notes: 'Drawer' })
      .expect(302);
    const document = await Document.findOne({ owner: owner._id, category: category._id });
    assert.equal(document.notes, 'Drawer');
    assert.equal(response.headers.location, `/documents/${document._id}`);

    const page = await agent.get(response.headers.location).expect(200);
    assert.match(page.text, /Document “Passport — Ana Pop” added\./);
  });

  it('opens the existing document when the pair already exists', async () => {
    const { agent } = await signedIn();
    const f = await createFixtures();
    const _csrf = await getCsrfToken(agent);

    const response = await agent
      .post('/documents')
      .type('form')
      .send({ _csrf, owner: String(f.ana._id), category: String(f.passport._id) })
      .expect(302);
    assert.equal(response.headers.location, `/documents/${f.anaPassport._id}`);
    assert.equal(await Document.countDocuments(), 4);
    const page = await agent.get(response.headers.location).expect(200);
    assert.match(page.text, /“Passport — Ana Pop” already exists/);
  });

  it('does not keep a document whose owner was deleted while it was being created', async () => {
    const { agent } = await signedIn();
    const [owner] = await Owner.create([
      { first_name: 'Ana', last_name: 'Pop' },
      { first_name: 'Ben', last_name: 'Ray' },
    ]);
    const category = await Category.create({ name: 'Passport' });
    const _csrf = await getCsrfToken(agent);
    const create = Document.create;
    mock.method(Document, 'create', async function (...args) {
      const created = await create.apply(this, args);
      await Owner.deleteOne({ _id: owner._id });
      return created;
    });
    let response;
    try {
      response = await agent
        .post('/documents')
        .type('form')
        .send({ _csrf, owner: String(owner._id), category: String(category._id) })
        .expect(422);
    } finally {
      mock.restoreAll();
    }

    assert.match(response.text, /This owner no longer exists/);
    assert.equal(await Document.countDocuments(), 0);
  });

  it('rejects missing, malformed and unknown owners and categories', async () => {
    const { agent } = await signedIn();
    const f = await createFixtures();
    const _csrf = await getCsrfToken(agent);

    const missing = await agent.post('/documents').type('form').send({ _csrf }).expect(422);
    assert.match(missing.text, /Choose an owner\./);
    assert.match(missing.text, /Choose a category\./);

    const unknown = await agent
      .post('/documents')
      .type('form')
      .send({ _csrf, owner: String(f.passport._id), category: 'nope', notes: 'Kept' })
      .expect(422);
    assert.match(unknown.text, /This owner no longer exists/);
    assert.match(unknown.text, /Choose a category\./);
    assert.match(unknown.text, />Kept<\/textarea>/);
    assert.equal(await Document.countDocuments(), 4);
  });
});

describe('document page', () => {
  it('shows the details, the current version and every version', async () => {
    const { agent } = await signedIn();
    const f = await createFixtures();
    const [older, current] = await DocumentInstance.create([
      { document: f.benPassport, expires_at: daysFromToday(-3000), notes: 'First\nissue' },
      {
        document: f.benPassport,
        issued_at: daysFromToday(-100),
        expires_at: daysFromToday(3000),
        file: {
          stored_name: 'scan.pdf',
          original_name: 'passport-scan.pdf',
          mime_type: 'application/pdf',
          size: 2048,
        },
      },
    ]);

    const page = await agent.get(`/documents/${f.benPassport._id}`).expect(200);
    assert.match(page.text, /<title>Passport — Ștefan Ray · DocDateTrack<\/title>/);
    assert.match(page.text, /data-document-status="valid"/);
    assert.match(page.text, new RegExp(`href="${f.ben.url}">Ștefan Ray</a>`));
    assert.match(page.text, new RegExp(`href="${f.passport.url}">Passport</a>`));
    assert.match(page.text, new RegExp(`data-current-version="${current._id}"`));
    assert.match(page.text, new RegExp(`href="/versions/${current._id}/download"`));
    assert.match(page.text, /passport-scan\.pdf/);
    assert.match(page.text, /2 KB/);
    assert.match(page.text, /First<br\/?>issue/);
    // Latest expiry first; the fixture version (expiring in 400 days) sits in the middle.
    const rows = [...page.text.matchAll(/<tr id="version-([a-f0-9]{24})"/g)].map((m) => m[1]);
    assert.equal(rows.length, 3);
    assert.equal(rows[0], String(current._id));
    assert.equal(rows[2], String(older._id));
    assert.match(page.text, /All 3 versions and their files are removed too/);
    assert.match(page.text, new RegExp(`href="/versions/new\\?document=${f.benPassport._id}"`));
  });

  it('offers the first upload when the document has no version', async () => {
    const { agent } = await signedIn();
    const f = await createFixtures();
    const page = await agent.get(`/documents/${f.benInsurance._id}`).expect(200);
    assert.match(page.text, /data-document-status="missing"/);
    assert.match(page.text, /Upload first version/);
  });

  it('answers 404 for malformed and unknown ids', async () => {
    const { agent } = await signedIn();
    for (const id of ['nope', '123', '507f1f77bcf86cd799439011']) {
      await agent.get(`/documents/${id}`).expect(404);
      await agent.get(`/documents/${id}/edit`).expect(404);
    }
  });
});

describe('editing and deleting documents', () => {
  it('saves the notes', async () => {
    const { agent } = await signedIn();
    const f = await createFixtures();
    const edit = await agent.get(`/documents/${f.anaPassport._id}/edit`).expect(200);
    assert.match(edit.text, /Edit notes/);
    const _csrf = await getCsrfToken(agent);

    await agent
      .post(`/documents/${f.anaPassport._id}?_method=PUT`)
      .type('form')
      .send({ _csrf, notes: '  Kept in the safe\r\nTop shelf  ' })
      .expect(302)
      .expect('Location', `/documents/${f.anaPassport._id}`);
    assert.equal((await Document.findById(f.anaPassport._id)).notes, 'Kept in the safe\nTop shelf');

    const tooLong = await agent
      .post(`/documents/${f.anaPassport._id}?_method=PUT`)
      .type('form')
      .send({ _csrf, notes: 'x'.repeat(2001) })
      .expect(422);
    assert.match(tooLong.text, /at most 2000 characters/);

    await agent
      .post(`/documents/${f.anaPassport._id}?_method=PUT`)
      .type('form')
      .send({ _csrf, notes: '' })
      .expect(302);
    assert.equal((await Document.findById(f.anaPassport._id)).notes, undefined);
  });

  it('deletes the document together with its versions and their files', async () => {
    const { agent, config } = await signedIn();
    const f = await createFixtures();
    for (const name of ['a.pdf', 'b.pdf', 'other.pdf']) {
      fs.writeFileSync(path.join(config.uploads.dir, name), '%PDF-1.7');
    }
    const file = (name) => ({
      stored_name: name,
      original_name: name,
      mime_type: 'application/pdf',
    });
    await DocumentInstance.create([
      { document: f.anaPassport, expires_at: daysFromToday(100), file: file('a.pdf') },
      { document: f.anaPassport, expires_at: daysFromToday(200), file: file('b.pdf') },
      { document: f.benPassport, expires_at: daysFromToday(300), file: file('other.pdf') },
    ]);
    const _csrf = await getCsrfToken(agent);

    await agent
      .post(`/documents/${f.anaPassport._id}?_method=DELETE`)
      .type('form')
      .send({ _csrf })
      .expect(302)
      .expect('Location', '/documents');
    assert.equal(await Document.exists({ _id: f.anaPassport._id }), null);
    assert.equal(await DocumentInstance.countDocuments({ document: f.anaPassport._id }), 0);
    assert.equal(await DocumentInstance.countDocuments({ document: f.benPassport._id }), 2);
    assert.deepEqual(fs.readdirSync(config.uploads.dir), ['other.pdf']);

    const list = await agent.get('/documents').expect(200);
    assert.match(list.text, /“Passport — Ana Pop” was deleted together with 3 versions/);
    await agent
      .post(`/documents/${f.anaPassport._id}?_method=DELETE`)
      .type('form')
      .send({ _csrf })
      .expect(404);
  });
});
