const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { after, before, beforeEach, describe, it } = require('node:test');

const Category = require('../models/category');
const Document = require('../models/document');
const DocumentInstance = require('../models/documentInstance');
const Owner = require('../models/owner');
const User = require('../models/user');
const { clearTestDb, startTestDb, stopTestDb } = require('./helpers/db');

async function validationErrors(doc) {
  const error = await doc.validate().then(
    () => null,
    (validationError) => validationError,
  );
  assert.ok(error, 'expected a validation error');
  return error.errors;
}

before(startTestDb);
after(stopTestDb);
beforeEach(clearTestDb);

describe('User', () => {
  it('normalizes and validates the account fields', async () => {
    const user = new User({ username: '  Jane.Doe ', email: ' Jane@Example.TEST ' });
    await user.validate();
    assert.equal(user.username, 'jane.doe');
    assert.equal(user.email, 'jane@example.test');
    assert.equal(user.role, 'member');
    assert.equal(user.name, 'jane.doe');
    assert.equal(user.is_admin, false);

    const errors = await validationErrors(
      new User({ username: 'no spaces', email: 'not-an-email', role: 'owner' }),
    );
    assert.deepEqual(Object.keys(errors).sort(), ['email', 'role', 'username']);
    assert.ok((await validationErrors(new User({ username: 'ab', email: 'a@b.test' }))).username);
  });

  it('exposes display name, admin flag and roles', () => {
    const admin = new User({ username: 'boss', email: 'boss@example.test', role: 'admin' });
    admin.display_name = 'Big Boss';
    assert.equal(admin.name, 'Big Boss');
    assert.equal(admin.is_admin, true);
    assert.deepEqual(Object.keys(User.ROLES), ['admin', 'member']);
  });

  it('registers, rejects duplicates and hides secrets from JSON', async () => {
    const user = await User.register(
      new User({ username: 'alex', email: 'alex@example.test' }),
      'a-long-password',
    );
    await assert.rejects(
      User.register(new User({ username: 'other', email: 'ALEX@example.test' }), 'pw-123456789'),
      { name: 'UserExistsError' },
    );
    await assert.rejects(User.create({ username: 'alex', email: 'new@example.test' }), {
      code: 11000,
    });

    const json = (await User.findById(user._id).select('+hash +salt')).toJSON();
    for (const field of ['hash', 'salt', 'attempts', 'last']) assert.equal(field in json, false);
    assert.equal(json.username, 'alex');
  });

  it('authenticates with the username or the email address', async () => {
    await User.register(new User({ username: 'sam', email: 'sam@example.test' }), 'secret-pass-1');
    const authenticate = User.authenticate();
    assert.equal((await authenticate('SAM', 'secret-pass-1')).user.username, 'sam');
    assert.equal((await authenticate('Sam@Example.test', 'secret-pass-1')).user.username, 'sam');
    const failed = await authenticate('sam', 'wrong-password');
    assert.equal(failed.user, false);
    assert.equal(failed.error.name, 'IncorrectPasswordError');
  });

  it('verifies hashes produced with the legacy pbkdf2 parameters', async () => {
    const salt = crypto.randomBytes(32).toString('hex');
    const hash = crypto.pbkdf2Sync('legacy-pass-1', salt, 25000, 512, 'sha256').toString('hex');
    await User.create({ username: 'legacy', email: 'legacy@example.test', hash, salt });
    assert.equal((await User.authenticate()('legacy', 'legacy-pass-1')).user.username, 'legacy');
  });
});

describe('Owner', () => {
  it('validates names and exposes name virtuals', async () => {
    const owner = new Owner({
      first_name: ' Maria ',
      last_name: 'Ionescu',
      email: 'M@Example.test',
    });
    await owner.validate();
    assert.equal(owner.name, 'Maria Ionescu');
    assert.equal(owner.sort_name, 'Ionescu, Maria');
    assert.equal(owner.email, 'm@example.test');
    assert.equal(owner.url, `/owners/${owner._id}`);

    const errors = await validationErrors(new Owner({ email: 'nope', phone: 'x'.repeat(41) }));
    assert.deepEqual(Object.keys(errors).sort(), ['email', 'first_name', 'last_name', 'phone']);
  });

  it('allows several owners without an email address', async () => {
    await Owner.create([
      { first_name: 'A', last_name: 'One' },
      { first_name: 'B', last_name: 'Two' },
    ]);
    assert.equal(await Owner.countDocuments(), 2);
  });
});

describe('Category', () => {
  it('defaults the scope and validates it', async () => {
    const category = await Category.create({ name: 'Passport' });
    assert.equal(category.scope, 'personal');
    assert.equal(category.url, `/categories/${category._id}`);
    assert.deepEqual(Category.SCOPES, {
      personal: 'Personal',
      company: 'Company',
      employee: 'Employee',
    });
    assert.ok((await validationErrors(new Category({ name: 'X', scope: 'family' }))).scope);
  });

  it('requires unique names', async () => {
    await Category.create({ name: 'Insurance', scope: 'company' });
    await assert.rejects(Category.create({ name: 'Insurance' }), { code: 11000 });
  });
});

describe('Document', () => {
  it('is unique per owner and category', async () => {
    const owner = await Owner.create({ first_name: 'Ana', last_name: 'Pop' });
    const category = await Category.create({ name: 'Driving licence' });
    await Document.create({ owner, category });
    await assert.rejects(Document.create({ owner: owner._id, category: category._id }), {
      code: 11000,
    });
  });

  it('builds its title from the populated owner and category', async () => {
    const owner = await Owner.create({ first_name: 'Ana', last_name: 'Pop' });
    const category = await Category.create({ name: 'Passport' });
    const created = await Document.create({ owner, category });
    assert.equal(created.url, `/documents/${created._id}`);

    const unpopulated = await Document.findById(created._id);
    assert.equal(unpopulated.title, 'Document');
    const populated = await Document.findById(created._id).populate('owner').populate('category');
    assert.equal(populated.title, 'Passport — Ana Pop');
  });
});

describe('DocumentInstance', () => {
  const documentId = () => new Document()._id;

  it('requires an expiry date on or after the issue date', async () => {
    assert.ok(
      (await validationErrors(new DocumentInstance({ document: documentId() }))).expires_at,
    );

    const sameDay = new DocumentInstance({
      document: documentId(),
      issued_at: new Date('2026-01-01T00:00:00Z'),
      expires_at: new Date('2026-01-01T00:00:00Z'),
    });
    await sameDay.validate();

    const errors = await validationErrors(
      new DocumentInstance({
        document: documentId(),
        issued_at: new Date('2026-01-02T00:00:00Z'),
        expires_at: new Date('2026-01-01T00:00:00Z'),
      }),
    );
    assert.match(errors.expires_at.message, /cannot be before the issue date/);
  });

  it('stores an optional file whose stored name is never a path', async () => {
    const withoutFile = await DocumentInstance.create({
      document: documentId(),
      expires_at: new Date('2030-01-01T00:00:00Z'),
    });
    assert.equal(withoutFile.file, undefined);
    const raw = await DocumentInstance.collection.findOne({ _id: withoutFile._id });
    assert.equal('file' in raw, false);
    assert.equal(withoutFile.url, `/versions/${withoutFile._id}`);
    assert.equal(withoutFile.download_url, `/versions/${withoutFile._id}/download`);

    const file = { original_name: 'scan.pdf', mime_type: 'application/pdf', size: 10 };
    const errors = await validationErrors(
      new DocumentInstance({
        document: documentId(),
        expires_at: new Date('2030-01-01T00:00:00Z'),
        file: { ...file, stored_name: '../escape.pdf' },
      }),
    );
    assert.ok(errors['file.stored_name']);

    const withFile = new DocumentInstance({
      document: documentId(),
      expires_at: new Date('2030-01-01T00:00:00Z'),
      file: { ...file, stored_name: 'a1b2c3.pdf' },
    });
    await withFile.validate();
    assert.equal(withFile.file.stored_name, 'a1b2c3.pdf');
  });
});
