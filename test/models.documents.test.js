const assert = require('node:assert/strict');
const { after, before, beforeEach, describe, it } = require('node:test');

const Category = require('../models/category');
const Document = require('../models/document');
const DocumentInstance = require('../models/documentInstance');
const Owner = require('../models/owner');
const { findDocumentsWithStatus, sortByUrgency, summarize } = require('../services/documents');
const { clearTestDb, startTestDb, stopTestDb } = require('./helpers/db');

const NOW = new Date(2026, 10, 17, 12, 0);
const day = (isoDate) => new Date(`${isoDate}T00:00:00Z`);

async function createFixtures() {
  const [ana, ben] = await Owner.create([
    { first_name: 'Ana', last_name: 'Pop' },
    { first_name: 'Ben', last_name: 'Ray' },
  ]);
  const [passport, insurance] = await Category.create([
    { name: 'Passport' },
    { name: 'Insurance', scope: 'company' },
  ]);
  const [anaPassport, anaInsurance, benPassport, benInsurance] = await Document.create([
    { owner: ana, category: passport },
    { owner: ana, category: insurance },
    { owner: ben, category: passport },
    { owner: ben, category: insurance },
  ]);
  const [, anaCurrent] = await DocumentInstance.create([
    { document: anaPassport, expires_at: day('2025-01-01') },
    { document: anaPassport, expires_at: day('2031-05-01') },
    { document: benPassport, expires_at: day('2026-11-27') },
    { document: benInsurance, expires_at: day('2026-11-10') },
  ]);
  return { ana, anaPassport, anaInsurance, benPassport, benInsurance, anaCurrent };
}

before(startTestDb);
after(stopTestDb);
beforeEach(clearTestDb);

describe('findDocumentsWithStatus', () => {
  it('returns every document with its current version and status', async () => {
    const fixtures = await createFixtures();
    const rows = await findDocumentsWithStatus({ now: NOW, warningDays: 30 });
    const byId = new Map(rows.map((row) => [String(row.document._id), row]));
    assert.equal(rows.length, 4);

    const anaPassport = byId.get(String(fixtures.anaPassport._id));
    assert.equal(anaPassport.status, 'valid');
    assert.equal(anaPassport.versionCount, 2);
    assert.equal(String(anaPassport.currentVersion._id), String(fixtures.anaCurrent._id));
    assert.ok(anaPassport.currentVersion instanceof DocumentInstance);
    assert.equal(anaPassport.document.title, 'Passport — Ana Pop');

    const anaInsurance = byId.get(String(fixtures.anaInsurance._id));
    assert.deepEqual(
      { ...anaInsurance, document: undefined },
      {
        document: undefined,
        currentVersion: null,
        versionCount: 0,
        status: 'missing',
        daysUntil: null,
      },
    );

    const benPassport = byId.get(String(fixtures.benPassport._id));
    assert.equal(benPassport.status, 'expiring');
    assert.equal(benPassport.daysUntil, 10);

    const benInsurance = byId.get(String(fixtures.benInsurance._id));
    assert.equal(benInsurance.status, 'expired');
    assert.equal(benInsurance.daysUntil, -7);
  });

  it('applies the match filter and the warning window', async () => {
    const fixtures = await createFixtures();
    const anaRows = await findDocumentsWithStatus({ match: { owner: fixtures.ana._id }, now: NOW });
    assert.equal(anaRows.length, 2);

    const rows = await findDocumentsWithStatus({ now: NOW, warningDays: 5 });
    const benPassport = rows.find((row) => row.document._id.equals(fixtures.benPassport._id));
    assert.equal(benPassport.status, 'valid');
  });

  it('returns an empty list when nothing matches', async () => {
    assert.deepEqual(await findDocumentsWithStatus({ now: NOW }), []);
  });
});

describe('sortByUrgency and summarize', () => {
  it('orders rows by status, then by days left', async () => {
    await createFixtures();
    const rows = await findDocumentsWithStatus({ now: NOW, warningDays: 30 });
    const sorted = sortByUrgency(rows);
    assert.deepEqual(
      sorted.map((row) => row.status),
      ['expired', 'expiring', 'missing', 'valid'],
    );
    assert.notEqual(sorted, rows);
    assert.deepEqual(summarize(rows), { expired: 1, expiring: 1, valid: 1, missing: 1, total: 4 });
  });

  it('puts the most overdue and the soonest expiring first', () => {
    const row = (status, daysUntil, title) => ({ status, daysUntil, document: { title } });
    const sorted = sortByUrgency([
      row('expiring', 20, 'B'),
      row('expired', -2, 'C'),
      row('expiring', 3, 'A'),
      row('expired', -40, 'D'),
      row('missing', null, 'E'),
    ]);
    assert.deepEqual(
      sorted.map((r) => r.document.title),
      ['D', 'C', 'A', 'B', 'E'],
    );
  });
});
