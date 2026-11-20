const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { after, before, beforeEach, describe, it } = require('node:test');
const { setTimeout: delay } = require('node:timers/promises');

const Category = require('../models/category');
const Document = require('../models/document');
const DocumentInstance = require('../models/documentInstance');
const Owner = require('../models/owner');
const { deleteVersions } = require('../services/cascade');
const { todayUtc } = require('../services/status');
const { createTestApp, createUser, getCsrfToken, loginAgent } = require('./helpers/app');
const { clearTestDb, startTestDb, stopTestDb } = require('./helpers/db');

const DAY_MS = 24 * 60 * 60 * 1000;
const daysFromToday = (days) => new Date(todayUtc().getTime() + days * DAY_MS);
const day = (isoDate) => new Date(`${isoDate}T00:00:00Z`);

const PDF = Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n', 'latin1');
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('not really an image'),
]);
const STORED_NAME = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(pdf|png)$/;

async function setup() {
  await createUser({ username: 'member' });
  const { app, config } = createTestApp();
  const agent = await loginAgent(app, { username: 'member' });
  const owner = await Owner.create({ first_name: 'Ana', last_name: 'Pop' });
  const category = await Category.create({ name: 'Passport' });
  const document = await Document.create({ owner, category });
  return { agent, config, owner, category, document, token: await getCsrfToken(agent) };
}

/** A multipart form post as a browser sends it: same-origin, `_csrf` first, the file last. */
function postForm(agent, url, token, fields = {}, file = null) {
  let req = agent.post(url).set('Sec-Fetch-Site', 'same-origin').field('_csrf', token);
  for (const [name, value] of Object.entries(fields)) req = req.field(name, value);
  if (file) req = req.attach('file', file.content, { filename: file.name, contentType: file.type });
  return req;
}

/** Files in the upload directory once pending cleanups had a chance to finish. */
async function uploadedFiles(dir, expectedCount) {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    if (fs.readdirSync(dir).length === expectedCount) break;
    await delay(10);
  }
  return fs.readdirSync(dir).sort();
}

async function uploadVersion(context, file) {
  const { agent, document, token } = context;
  await postForm(
    agent,
    '/versions',
    token,
    { document: String(document._id), expires_at: '2030-06-30' },
    file,
  ).expect(302);
  return DocumentInstance.findOne({ document: document._id });
}

function binaryParser(res, callback) {
  const chunks = [];
  res.on('data', (chunk) => chunks.push(chunk));
  res.on('end', () => callback(null, Buffer.concat(chunks)));
}

before(startTestDb);
after(stopTestDb);
beforeEach(clearTestDb);

describe('upload form', () => {
  it('shows the document when one is given, or owner and category pickers', async () => {
    const { agent, owner, category, document } = await setup();

    const forDocument = await agent.get(`/versions/new?document=${document._id}`).expect(200);
    assert.match(forDocument.text, /<title>Upload version · DocDateTrack<\/title>/);
    assert.match(
      forDocument.text,
      new RegExp(`<input type="hidden" name="document" value="${document._id}">`),
    );
    assert.match(forDocument.text, /Passport — Ana Pop/);
    assert.doesNotMatch(forDocument.text, /name="owner"/);

    const form = forDocument.text.slice(
      forDocument.text.indexOf('<form method="post" action="/versions"'),
    );
    const fieldNames = [...form.slice(0, form.indexOf('</form>')).matchAll(/ name="([^"]+)"/g)];
    assert.deepEqual(
      fieldNames.map((match) => match[1]),
      ['_csrf', 'document', 'issued_at', 'expires_at', 'notes', 'file'],
    );
    assert.match(form, /enctype="multipart\/form-data"/);
    assert.match(form, /accept="\.pdf,\.jpg,\.jpeg,\.png,\.webp"/);
    assert.match(form, /PDF, JPEG, PNG or WebP, up to 10 MB\./);
    assert.match(forDocument.text, /<script src="\/js\/uploads\.js"><\/script>/);

    const pickers = await agent
      .get(`/versions/new?owner=${owner._id}&category=${category._id}&document=nope`)
      .expect(200);
    assert.match(pickers.text, new RegExp(`<option value="${owner._id}" selected>Ana Pop`));
    assert.match(pickers.text, new RegExp(`<option value="${category._id}" selected>Passport`));
    assert.doesNotMatch(pickers.text, /name="document"/);
  });
});

describe('uploading versions', () => {
  it('stores the file under a random name with the detected type', async () => {
    const { agent, config, document, token } = await setup();

    const response = await postForm(
      agent,
      '/versions',
      token,
      { document: String(document._id), issued_at: '2024-02-29', expires_at: '2034-02-28' },
      // The browser claims a PDF; the content is a PNG. The name hides a right-to-left override.
      { content: PNG, name: 'C:\\Scans\\pass\u202eport.png', type: 'application/pdf' },
    ).expect(302);

    const version = await DocumentInstance.findOne({ document: document._id });
    assert.equal(response.headers.location, `/documents/${document._id}#version-${version._id}`);
    assert.deepEqual(version.issued_at, day('2024-02-29'));
    assert.deepEqual(version.expires_at, day('2034-02-28'));
    assert.match(version.file.stored_name, STORED_NAME);
    assert.ok(version.file.stored_name.endsWith('.png'));
    assert.equal(version.file.mime_type, 'image/png');
    assert.equal(version.file.original_name, 'passport.png');
    assert.equal(version.file.size, PNG.length);
    assert.deepEqual(fs.readdirSync(config.uploads.dir), [version.file.stored_name]);
    assert.deepEqual(fs.readFileSync(path.join(config.uploads.dir, version.file.stored_name)), PNG);

    const page = await agent.get(response.headers.location).expect(200);
    assert.match(page.text, /Version of “Passport — Ana Pop” saved\./);
  });

  it('creates the document for a new owner and category pair', async () => {
    const { agent, owner, token } = await setup();
    const permit = await Category.create({ name: 'Work permit', scope: 'employee' });
    const fields = {
      owner: String(owner._id),
      category: String(permit._id),
      expires_at: '2030-01-31',
      notes: 'Renewed\r\nat the town hall',
    };

    const first = await postForm(agent, '/versions', token, fields).expect(302);
    const document = await Document.findOne({ owner: owner._id, category: permit._id });
    assert.ok(document);
    assert.match(first.headers.location, new RegExp(`^/documents/${document._id}#version-`));
    const page = await agent.get(first.headers.location).expect(200);
    assert.match(page.text, /The document “Work permit — Ana Pop” was created for it\./);

    await postForm(agent, '/versions', token, { ...fields, expires_at: '2035-01-31' }).expect(302);
    assert.equal(await Document.countDocuments({ owner: owner._id }), 2);
    const versions = await DocumentInstance.find({ document: document._id }).sort('expires_at');
    assert.equal(versions.length, 2);
    assert.equal(versions[0].notes, 'Renewed\nat the town hall');
    assert.equal(versions[0].file, undefined);
  });

  it('rejects an expiry date before the issue date and keeps nothing', async () => {
    const { agent, config, document, token } = await setup();

    const response = await postForm(
      agent,
      '/versions',
      token,
      { document: String(document._id), issued_at: '2024-05-01', expires_at: '2024-04-30' },
      { content: PDF, name: 'scan.pdf', type: 'application/pdf' },
    ).expect(422);
    assert.match(response.text, /The expiry date cannot be before the issue date\./);
    assert.match(response.text, /name="issued_at" value="2024-05-01"/);
    assert.match(response.text, /Please choose it again\./);
    assert.equal(await DocumentInstance.countDocuments(), 0);
    assert.deepEqual(await uploadedFiles(config.uploads.dir, 0), []);
  });

  it('validates the dates, the notes and the chosen document', async () => {
    const { agent, owner, category, token } = await setup();
    const cases = [
      [{ owner: String(owner._id), category: String(category._id) }, /Enter the expiry date\./],
      [{ document: 'abc', expires_at: '2030-01-01' }, /This document no longer exists/],
      [{ owner: 'nope', expires_at: '2030-01-01' }, /Choose an owner\./],
      [{ owner: String(owner._id), expires_at: '2030-01-01' }, /Choose a category\./],
      [{ owner: String(owner._id), expires_at: '2023-02-29' }, /Enter a valid expiry date\./],
      [{ owner: String(owner._id), expires_at: '01/02/2030' }, /Enter a valid expiry date\./],
      [{ owner: String(owner._id), expires_at: '1899-12-31' }, /between 1900 and 2200/],
      [{ owner: String(owner._id), issued_at: '2201-01-01' }, /between 1900 and 2200/],
      [{ owner: String(owner._id), notes: 'x'.repeat(2001) }, /at most 2000 characters/],
    ];
    for (const [fields, message] of cases) {
      const response = await postForm(agent, '/versions', token, fields).expect(422);
      assert.match(response.text, message, JSON.stringify(fields));
    }
    assert.equal(await DocumentInstance.countDocuments(), 0);
  });
});

describe('editing versions', () => {
  it('shows the current values', async () => {
    const context = await setup();
    const version = await uploadVersion(context, {
      content: PDF,
      name: 'scan.pdf',
      type: 'application/pdf',
    });
    const page = await context.agent.get(`/versions/${version._id}/edit`).expect(200);
    assert.match(page.text, /name="expires_at" value="2030-06-30"/);
    assert.match(page.text, /name="remove_file"/);
    assert.match(page.text, new RegExp(`action="/versions/${version._id}\\?_method=PUT"`));
  });

  it('replaces the file and deletes the old one after saving', async () => {
    const context = await setup();
    const { agent, config, token } = context;
    const version = await uploadVersion(context, {
      content: PDF,
      name: 'old.pdf',
      type: 'application/pdf',
    });
    const oldName = version.file.stored_name;

    const response = await postForm(
      agent,
      `/versions/${version._id}?_method=PUT`,
      token,
      { issued_at: '2025-01-01', expires_at: '2035-01-01', notes: 'Renewed' },
      { content: PNG, name: 'new.png', type: 'image/png' },
    ).expect(302);
    assert.equal(
      response.headers.location,
      `/documents/${context.document._id}#version-${version._id}`,
    );

    const updated = await DocumentInstance.findById(version._id);
    assert.deepEqual(updated.issued_at, day('2025-01-01'));
    assert.deepEqual(updated.expires_at, day('2035-01-01'));
    assert.equal(updated.notes, 'Renewed');
    assert.equal(updated.file.original_name, 'new.png');
    assert.equal(updated.file.mime_type, 'image/png');
    assert.notEqual(updated.file.stored_name, oldName);
    assert.deepEqual(fs.readdirSync(config.uploads.dir), [updated.file.stored_name]);
  });

  it('removes the current file when asked', async () => {
    const context = await setup();
    const { agent, config, token } = context;
    const version = await uploadVersion(context, {
      content: PDF,
      name: 'scan.pdf',
      type: 'application/pdf',
    });

    await postForm(agent, `/versions/${version._id}?_method=PUT`, token, {
      expires_at: '2030-06-30',
      remove_file: '1',
    }).expect(302);
    assert.equal((await DocumentInstance.findById(version._id)).file, undefined);
    assert.deepEqual(fs.readdirSync(config.uploads.dir), []);
  });

  it('keeps the input and the old file when the form has errors', async () => {
    const context = await setup();
    const { agent, config, token } = context;
    const version = await uploadVersion(context, {
      content: PDF,
      name: 'scan.pdf',
      type: 'application/pdf',
    });

    const response = await postForm(
      agent,
      `/versions/${version._id}?_method=PUT`,
      token,
      { issued_at: '2031-01-01', expires_at: '2030-01-01', notes: 'Typo', remove_file: '1' },
      { content: PNG, name: 'new.png', type: 'image/png' },
    ).expect(422);
    assert.match(response.text, /name="issued_at" value="2031-01-01"/);
    assert.match(response.text, />Typo<\/textarea>/);
    assert.match(response.text, /name="remove_file" value="1" checked/);
    const unchanged = await DocumentInstance.findById(version._id);
    assert.deepEqual(unchanged.expires_at, day('2030-06-30'));
    assert.deepEqual(await uploadedFiles(config.uploads.dir, 1), [version.file.stored_name]);
  });

  it('answers 404 for unknown versions', async () => {
    const { agent, token } = await setup();
    await agent.get('/versions/507f1f77bcf86cd799439011/edit').expect(404);
    await agent.get('/versions/nope').expect(404);
    await postForm(agent, '/versions/nope?_method=PUT', token, { expires_at: '2030-01-01' }).expect(
      404,
    );
  });
});

describe('downloads', () => {
  it('sends the file as an attachment with its original name', async () => {
    const { agent, config, document, token } = await setup();
    await postForm(
      agent,
      '/versions',
      token,
      { document: String(document._id), expires_at: '2030-06-30' },
      { content: PDF, name: 'Pașaport Ana.pdf', type: 'application/octet-stream' },
    ).expect(302);
    const version = await DocumentInstance.findOne({ document: document._id });

    const response = await agent
      .get(`/versions/${version._id}/download`)
      .buffer(true)
      .parse(binaryParser)
      .expect(200);
    assert.equal(response.headers['content-type'], 'application/pdf');
    assert.match(response.headers['content-disposition'], /^attachment;/);
    assert.match(
      response.headers['content-disposition'],
      /filename\*=UTF-8''Pa%C8%99aport%20Ana\.pdf/,
    );
    assert.equal(response.headers['cache-control'], 'private, no-store');
    assert.equal(response.headers['x-content-type-options'], 'nosniff');
    assert.deepEqual(response.body, PDF);

    fs.unlinkSync(path.join(config.uploads.dir, version.file.stored_name));
    await agent.get(`/versions/${version._id}/download`).expect(404);
  });

  it('answers 404 without a file or for unknown versions', async () => {
    const { agent, document } = await setup();
    const version = await DocumentInstance.create({ document, expires_at: day('2030-01-01') });
    await agent.get(`/versions/${version._id}/download`).expect(404);
    await agent.get('/versions/507f1f77bcf86cd799439011/download').expect(404);
    await agent.get('/versions/nope/download').expect(404);
  });

  it('names files after their stored type and sends legacy types as octet-stream', async () => {
    const { agent, config, document } = await setup();
    const cases = [
      // Migrated rows: the name and the type come from the legacy data.
      ['legacy-page.html', 'text/html', 'legacy-page.html', 'application/octet-stream'],
      ['legacy-scan.txt', 'text/plain', 'legacy-scan.txt', 'application/octet-stream'],
      ['photo.svg', 'image/png', 'photo.svg.png', 'image/png'],
    ];
    for (const [name, mimeType, fileName, contentType] of cases) {
      fs.writeFileSync(path.join(config.uploads.dir, name), 'legacy');
      const version = await DocumentInstance.create({
        document,
        expires_at: day('2030-01-01'),
        file: { stored_name: name, original_name: name, mime_type: mimeType },
      });
      const response = await agent.get(`/versions/${version._id}/download`).expect(200);
      assert.equal(response.headers['content-type'], contentType, name);
      assert.equal(
        response.headers['content-disposition'].replaceAll('"', ''),
        `attachment; filename=${fileName}`,
      );
    }
  });
});

describe('concurrent changes', () => {
  it(
    'refuses an edit when someone else saved the version first',
    { timeout: 15_000 },
    async (t) => {
      const context = await setup();
      const { agent, config, token } = context;
      const version = await uploadVersion(context, {
        content: PDF,
        name: 'old.pdf',
        type: 'application/pdf',
      });
      const oldName = version.file.stored_name;

      // Hold both saves until both edits have loaded the version, then save the edit that keeps
      // the old file first: the edit replacing the file must lose instead of orphaning a file.
      const save = DocumentInstance.prototype.save;
      const calls = [];
      t.mock.method(DocumentInstance.prototype, 'save', function (...args) {
        return new Promise((resolve, reject) => {
          calls.push({ doc: this, args, resolve, reject });
          if (calls.length < 2) return;
          const keepsOldFile = (call) => call.doc.file?.stored_name === oldName;
          calls.sort((a, b) => Number(keepsOldFile(b)) - Number(keepsOldFile(a)));
          (async () => {
            for (const call of calls)
              await save.apply(call.doc, call.args).then(call.resolve, call.reject);
          })();
        });
      });

      const url = `/versions/${version._id}?_method=PUT`;
      const [datesOnly, newFile] = await Promise.all([
        postForm(agent, url, token, { expires_at: '2031-01-31' }),
        postForm(
          agent,
          url,
          token,
          { expires_at: '2032-02-29' },
          { content: PNG, name: 'new.png', type: 'image/png' },
        ),
      ]);
      assert.equal(datesOnly.status, 302);
      assert.equal(newFile.status, 409);
      assert.match(
        newFile.text,
        /This version was changed by someone else; reload and try again\./,
      );
      assert.match(newFile.text, /name="expires_at" value="2032-02-29"/);
      assert.match(newFile.text, /Please choose it again\./);

      const saved = await DocumentInstance.findById(version._id);
      assert.deepEqual(saved.expires_at, day('2031-01-31'));
      assert.equal(saved.file.stored_name, oldName);
      assert.deepEqual(await uploadedFiles(config.uploads.dir, 1), [oldName]);
    },
  );

  it('answers 404 when the version is deleted during an edit', async (t) => {
    const context = await setup();
    const { agent, config, token } = context;
    const version = await uploadVersion(context, {
      content: PDF,
      name: 'old.pdf',
      type: 'application/pdf',
    });
    const save = DocumentInstance.prototype.save;
    t.mock.method(DocumentInstance.prototype, 'save', async function (...args) {
      await deleteVersions({ _id: this._id }, { uploadDir: config.uploads.dir });
      return save.apply(this, args);
    });

    await postForm(
      agent,
      `/versions/${version._id}?_method=PUT`,
      token,
      { expires_at: '2031-01-31' },
      { content: PNG, name: 'new.png', type: 'image/png' },
    ).expect(404);
    assert.equal(await DocumentInstance.countDocuments(), 0);
    assert.deepEqual(await uploadedFiles(config.uploads.dir, 0), []);
  });

  it('drops a new document whose owner is deleted during the upload', async (t) => {
    const { agent, config, owner, token } = await setup();
    const permit = await Category.create({ name: 'Work permit' });
    const create = Document.create;
    t.mock.method(Document, 'create', async function (...args) {
      const created = await create.apply(this, args);
      await Owner.deleteOne({ _id: owner._id });
      return created;
    });

    const response = await postForm(
      agent,
      '/versions',
      token,
      { owner: String(owner._id), category: String(permit._id), expires_at: '2030-01-31' },
      { content: PDF, name: 'permit.pdf', type: 'application/pdf' },
    ).expect(422);
    assert.match(response.text, /This owner no longer exists/);
    assert.equal(await Document.countDocuments({ category: permit._id }), 0);
    assert.equal(await DocumentInstance.countDocuments(), 0);
    assert.deepEqual(await uploadedFiles(config.uploads.dir, 0), []);
  });

  it('drops a version whose document is deleted during the upload', async (t) => {
    const { agent, config, document, token } = await setup();
    const save = DocumentInstance.prototype.save;
    t.mock.method(DocumentInstance.prototype, 'save', async function (...args) {
      const saved = await save.apply(this, args);
      await Document.deleteOne({ _id: document._id });
      return saved;
    });

    await postForm(
      agent,
      '/versions',
      token,
      { document: String(document._id), expires_at: '2030-01-31' },
      { content: PDF, name: 'scan.pdf', type: 'application/pdf' },
    ).expect(404);
    assert.equal(await DocumentInstance.countDocuments(), 0);
    assert.deepEqual(await uploadedFiles(config.uploads.dir, 0), []);
  });
});

describe('versions list and deletion', () => {
  it('lists versions newest first, 50 per page', async () => {
    const { agent, document } = await setup();
    const versions = await DocumentInstance.create(
      Array.from({ length: 55 }, (_, index) => ({
        document,
        expires_at: daysFromToday(index),
        createdAt: new Date(Date.UTC(2026, 0, 1, 0, index)),
      })),
    );
    const listed = (html) =>
      [...html.matchAll(/data-version-id="([a-f0-9]{24})"/g)].map((match) => match[1]);

    const first = await agent.get('/versions').expect(200);
    assert.equal(listed(first.text).length, 50);
    assert.equal(listed(first.text)[0], String(versions[54]._id));
    assert.match(first.text, /Showing 1–50 of 55 versions/);
    const second = await agent.get('/versions?page=2').expect(200);
    assert.deepEqual(
      listed(second.text),
      versions
        .slice(0, 5)
        .reverse()
        .map((version) => String(version._id)),
    );

    await agent
      .get(`/versions/${versions[3]._id}`)
      .expect(302)
      .expect('Location', `/documents/${document._id}#version-${versions[3]._id}`);
  });

  it('deletes a version together with its file', async () => {
    const { agent, config, document, token } = await setup();
    await postForm(
      agent,
      '/versions',
      token,
      { document: String(document._id), expires_at: '2030-06-30' },
      { content: PDF, name: 'scan.pdf', type: 'application/pdf' },
    ).expect(302);
    const version = await DocumentInstance.findOne({ document: document._id });
    assert.equal(fs.readdirSync(config.uploads.dir).length, 1);

    await agent
      .post(`/versions/${version._id}?_method=DELETE`)
      .type('form')
      .send({ _csrf: token })
      .expect(302)
      .expect('Location', `/documents/${document._id}`);
    assert.equal(await DocumentInstance.countDocuments(), 0);
    assert.deepEqual(fs.readdirSync(config.uploads.dir), []);
    const page = await agent.get(`/documents/${document._id}`).expect(200);
    assert.match(page.text, /The version and its file were deleted\./);
  });
});
