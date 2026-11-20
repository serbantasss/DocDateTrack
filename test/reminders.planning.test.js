const assert = require('node:assert/strict');
const { describe, it } = require('node:test');

const { planReminders, reminderKey } = require('../services/reminders');

let sequence = 0;

function makeRow(status, { owner = null, expiresAt = '2026-11-01', daysUntil = -16 } = {}) {
  sequence += 1;
  const id = `document${sequence}`;
  const hasVersion = status !== 'missing';
  return {
    document: { _id: id, title: `Document ${sequence}`, url: `/documents/${id}`, owner },
    currentVersion: hasVersion
      ? { _id: `version${sequence}`, expires_at: new Date(`${expiresAt}T00:00:00Z`) }
      : null,
    versionCount: hasVersion ? 1 : 0,
    status,
    daysUntil: hasVersion ? daysUntil : null,
  };
}

const owner = (name, email) => ({ name, email });
const titlesOf = (recipient) => recipient.items.map((item) => item.row.document.title);
const keyOf = (recipient, row) =>
  reminderKey({
    recipient,
    version: row.currentVersion._id,
    stage: row.status,
    expiresAt: row.currentVersion.expires_at,
  });

describe('planReminders', () => {
  const ana = owner('Ana Pop', 'ana@example.test');
  const ben = owner('Ben Ray', 'Ben@Example.test');
  const cleo = owner('Cleo Day', undefined);
  const admins = [
    { email: 'Root@Example.test', name: 'Root Admin' },
    { email: 'second@example.test', name: 'Second Admin' },
  ];

  it('gives every administrator all expired and expiring documents, most urgent first', () => {
    const expiring = makeRow('expiring', { owner: ben, expiresAt: '2026-11-27', daysUntil: 10 });
    const expired = makeRow('expired', { owner: ana });
    const valid = makeRow('valid', { owner: ana, expiresAt: '2030-01-01', daysUntil: 1141 });
    const missing = makeRow('missing', { owner: ana });

    const plan = planReminders({ rows: [expiring, valid, missing, expired], admins });

    assert.deepEqual(
      plan.map(({ to, name, isAdmin, outstanding }) => ({ to, name, isAdmin, outstanding })),
      [
        { to: 'root@example.test', name: 'Root Admin', isAdmin: true, outstanding: 0 },
        { to: 'second@example.test', name: 'Second Admin', isAdmin: true, outstanding: 0 },
      ],
    );
    for (const recipient of plan) {
      assert.deepEqual(titlesOf(recipient), [expired.document.title, expiring.document.title]);
      assert.deepEqual(
        recipient.items.map((item) => item.stage),
        ['expired', 'expiring'],
      );
    }
  });

  it('plans nothing when no document is expired or expiring', () => {
    const rows = [makeRow('valid', { owner: ana, daysUntil: 300 }), makeRow('missing')];
    assert.deepEqual(planReminders({ rows, admins, notifyOwners: true }), []);
  });

  it('adds owners with an email address, each with only their own documents', () => {
    const anaExpired = makeRow('expired', { owner: ana });
    const anaExpiring = makeRow('expiring', { owner: ana, daysUntil: 3 });
    const benExpired = makeRow('expired', { owner: ben, daysUntil: -2 });
    const cleoExpiring = makeRow('expiring', { owner: cleo, daysUntil: 20 });
    const anaValid = makeRow('valid', { owner: ana, daysUntil: 200 });
    const rows = [anaExpired, anaExpiring, benExpired, cleoExpiring, anaValid];

    const plan = planReminders({ rows, admins: admins.slice(0, 1), notifyOwners: true });

    assert.deepEqual(
      plan.map((recipient) => [recipient.to, recipient.isAdmin, titlesOf(recipient)]),
      [
        [
          'root@example.test',
          true,
          [anaExpired, benExpired, anaExpiring, cleoExpiring].map((row) => row.document.title),
        ],
        ['ana@example.test', false, [anaExpired, anaExpiring].map((row) => row.document.title)],
        ['ben@example.test', false, [benExpired.document.title]],
      ],
    );
    assert.deepEqual(plan[1].ownerNames, ['Ana Pop']);
    assert.equal(plan[1].name, 'Ana Pop');

    const withoutOwners = planReminders({ rows, admins: admins.slice(0, 1) });
    assert.deepEqual(
      withoutOwners.map((recipient) => recipient.to),
      ['root@example.test'],
    );
  });

  it('sends one email per address, without repeating documents', () => {
    const adminOwner = owner('Root Owner', ' ROOT@example.test ');
    const kid = owner('Kid Pop', 'ana@example.test');
    const rows = [
      makeRow('expired', { owner: adminOwner }),
      makeRow('expired', { owner: ana, daysUntil: -3 }),
      makeRow('expiring', { owner: kid, daysUntil: 5 }),
    ];

    const plan = planReminders({ rows, admins: admins.slice(0, 1), notifyOwners: true });

    assert.equal(plan.length, 2);
    const [root, family] = plan;
    assert.equal(root.to, 'root@example.test');
    assert.equal(root.isAdmin, true);
    assert.equal(root.name, 'Root Admin');
    assert.equal(root.items.length, 3);
    assert.equal(new Set(root.items.map((item) => item.key)).size, 3);

    assert.equal(family.to, 'ana@example.test');
    assert.deepEqual(family.ownerNames, ['Ana Pop', 'Kid Pop']);
    assert.equal(family.name, null);
    assert.deepEqual(titlesOf(family), [rows[1].document.title, rows[2].document.title]);
  });

  it('leaves out what a recipient was already told and counts it as outstanding', () => {
    const expired = makeRow('expired', { owner: ana });
    const expiring = makeRow('expiring', { owner: ana, daysUntil: 9 });
    const sentKeys = new Set([
      keyOf('root@example.test', expired),
      keyOf('ana@example.test', expired),
      keyOf('ana@example.test', expiring),
    ]);

    const plan = planReminders({
      rows: [expired, expiring],
      admins: admins.slice(0, 1),
      notifyOwners: true,
      sentKeys,
    });

    assert.deepEqual(
      plan.map((recipient) => [recipient.to, titlesOf(recipient), recipient.outstanding]),
      [
        ['root@example.test', [expiring.document.title], 1],
        ['ana@example.test', [], 2],
      ],
    );
  });

  it('tells a recipient again when the stage or the expiry date changes', () => {
    const row = makeRow('expired', { owner: ana, expiresAt: '2026-11-10' });
    const toldExpiring = reminderKey({
      recipient: 'root@example.test',
      version: row.currentVersion._id,
      stage: 'expiring',
      expiresAt: row.currentVersion.expires_at,
    });
    const toldOtherDate = reminderKey({
      recipient: 'root@example.test',
      version: row.currentVersion._id,
      stage: 'expired',
      expiresAt: new Date('2026-11-09T00:00:00Z'),
    });

    const [root] = planReminders({
      rows: [row],
      admins: admins.slice(0, 1),
      sentKeys: new Set([toldExpiring, toldOtherDate]),
    });

    assert.deepEqual(titlesOf(root), [row.document.title]);
    assert.equal(root.items[0].key, keyOf('root@example.test', row));
  });
});
