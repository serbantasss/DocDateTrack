const assert = require('node:assert/strict');
const { after, before, beforeEach, describe, it } = require('node:test');
const request = require('supertest');

const Category = require('../models/category');
const Document = require('../models/document');
const DocumentInstance = require('../models/documentInstance');
const Owner = require('../models/owner');
const { todayUtc } = require('../services/status');
const { createTestApp, createUser, loginAgent } = require('./helpers/app');
const { clearTestDb, startTestDb, stopTestDb } = require('./helpers/db');

const DAY_MS = 24 * 60 * 60 * 1000;
const daysFromToday = (days) => new Date(todayUtc().getTime() + days * DAY_MS);

async function signedIn() {
  await createUser({ username: 'member' });
  const { app } = createTestApp({ EXPIRY_WARNING_DAYS: '30' });
  return loginAgent(app, { username: 'member' });
}

/** Ids of the documents in the "Needs attention" table, in display order. */
function attentionIds(html) {
  const start = html.indexOf('data-attention');
  if (start === -1) return [];
  const table = html.slice(start, html.indexOf('</table>', start));
  return [...table.matchAll(/data-document-id="([a-f0-9]{24})"/g)].map((match) => match[1]);
}

function summaryCount(html, status) {
  const match = new RegExp(`data-summary-count="${status}">(\\d+)<`).exec(html);
  return match ? Number(match[1]) : null;
}

function attentionTotal(html) {
  const match = /data-attention-total(?:="")?>(\d+)</.exec(html);
  return match ? Number(match[1]) : null;
}

function onboardingSteps(html) {
  return [...html.matchAll(/data-onboarding-step="(\d)" data-step-done="(true|false)"/g)].map(
    (match) => match[2] === 'true',
  );
}

before(startTestDb);
after(stopTestDb);
beforeEach(clearTestDb);

describe('dashboard', () => {
  it('requires signing in', async () => {
    await createUser({ username: 'member' });
    const { app } = createTestApp();
    for (const url of ['/', '/documents', '/documents/new', '/versions', '/versions/new']) {
      const response = await request(app).get(url).expect(302);
      assert.equal(response.headers.location, '/login', url);
    }
  });

  it('walks a new installation through the first steps', async () => {
    const agent = await signedIn();

    let page = await agent.get('/').expect(200);
    assert.match(page.text, /<title>Dashboard · DocDateTrack<\/title>/);
    assert.deepEqual(onboardingSteps(page.text), [false, false, false]);
    assert.match(page.text, /href="\/owners\/new"/);
    assert.match(page.text, /href="\/categories\/new"/);
    assert.match(page.text, /Complete the steps above first\./);

    const owner = await Owner.create({ first_name: 'Ana', last_name: 'Pop' });
    page = await agent.get('/').expect(200);
    assert.deepEqual(onboardingSteps(page.text), [true, false, false]);

    const category = await Category.create({ name: 'Passport' });
    page = await agent.get('/').expect(200);
    assert.deepEqual(onboardingSteps(page.text), [true, true, false]);
    assert.match(page.text, /href="\/versions\/new"[^>]*>.*Upload first version/);

    await Document.create({ owner, category });
    page = await agent.get('/').expect(200);
    assert.deepEqual(onboardingSteps(page.text), []);
    assert.doesNotMatch(page.text, /data-onboarding/);
  });

  it('counts the documents by status and lists the most urgent ones', async () => {
    const agent = await signedIn();
    const [ana, ben] = await Owner.create([
      { first_name: 'Ana', last_name: 'Pop' },
      { first_name: 'Ben', last_name: 'Ray' },
    ]);
    const [passport, insurance, permit] = await Category.create([
      { name: 'Passport' },
      { name: 'Insurance', scope: 'company' },
      { name: 'Permit' },
    ]);
    const [longExpired, recentlyExpired, expiring, valid, missing] = await Document.create([
      { owner: ana, category: passport },
      { owner: ana, category: insurance },
      { owner: ben, category: passport },
      { owner: ben, category: insurance },
      { owner: ben, category: permit },
    ]);
    await DocumentInstance.create([
      { document: longExpired, expires_at: daysFromToday(-400) },
      { document: recentlyExpired, expires_at: daysFromToday(-1000) },
      // The latest expiry date counts, so this document is only recently expired.
      { document: recentlyExpired, expires_at: daysFromToday(-5) },
      { document: expiring, expires_at: daysFromToday(12) },
      { document: valid, expires_at: daysFromToday(200) },
    ]);

    const page = await agent.get('/').expect(200);
    assert.equal(summaryCount(page.text, 'expired'), 2);
    assert.equal(summaryCount(page.text, 'expiring'), 1);
    assert.equal(summaryCount(page.text, 'valid'), 1);
    assert.equal(summaryCount(page.text, 'missing'), 1);
    assert.match(page.text, /href="\/documents\?status=expired"/);
    assert.match(page.text, /Within 30 days/);
    assert.deepEqual(attentionIds(page.text), [
      String(longExpired._id),
      String(recentlyExpired._id),
      String(expiring._id),
    ]);
    assert.equal(attentionTotal(page.text), 3);
    assert.ok(!attentionIds(page.text).includes(String(missing._id)));
    assert.doesNotMatch(page.text, /data-onboarding/);
  });

  it('shows at most ten documents that need attention', async () => {
    const agent = await signedIn();
    const category = await Category.create({ name: 'Permit' });
    const owners = await Owner.create(
      Array.from({ length: 12 }, (_, index) => ({
        first_name: `Owner${index}`,
        last_name: 'Test',
      })),
    );
    const documents = await Document.create(owners.map((owner) => ({ owner, category })));
    await DocumentInstance.create(
      documents.map((document, index) => ({ document, expires_at: daysFromToday(-1 - index) })),
    );

    const page = await agent.get('/').expect(200);
    const shown = attentionIds(page.text);
    assert.equal(shown.length, 10);
    // Longest overdue first.
    assert.equal(shown[0], String(documents[11]._id));
    assert.equal(attentionTotal(page.text), 12);
    assert.match(page.text, /View all expired \(12\)/);
  });

  it('says all is well when nothing needs attention', async () => {
    const agent = await signedIn();
    const owner = await Owner.create({ first_name: 'Ana', last_name: 'Pop' });
    const category = await Category.create({ name: 'Passport' });
    const document = await Document.create({ owner, category });
    await DocumentInstance.create({ document, expires_at: daysFromToday(365) });

    const page = await agent.get('/').expect(200);
    assert.match(page.text, /All up to date/);
    assert.deepEqual(attentionIds(page.text), []);
  });

  it('lists the five most recently added versions', async () => {
    const agent = await signedIn();
    const owner = await Owner.create({ first_name: 'Ana', last_name: 'Pop' });
    const category = await Category.create({ name: 'Passport' });
    const document = await Document.create({ owner, category });
    const versions = [];
    for (let index = 0; index < 6; index += 1) {
      versions.push(
        await DocumentInstance.create({
          document,
          expires_at: daysFromToday(100 + index),
          createdAt: new Date(Date.UTC(2026, 0, 1 + index)),
        }),
      );
    }

    const page = await agent.get('/').expect(200);
    const list = page.text.slice(page.text.indexOf('data-recent-versions'));
    const linked = [...list.matchAll(/#version-([a-f0-9]{24})"/g)].map((match) => match[1]);
    assert.deepEqual(
      linked,
      versions
        .slice(1)
        .reverse()
        .map((version) => String(version._id)),
    );
    assert.match(list, /Passport — Ana Pop/);
  });
});
