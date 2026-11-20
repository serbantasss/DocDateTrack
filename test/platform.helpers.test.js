const assert = require('node:assert/strict');
const { afterEach, describe, it } = require('node:test');

const { createFormatter, fileSize, relativeDays } = require('../lib/format');
const {
  STATUS,
  STATUS_META,
  computeStatus,
  daysUntil,
  toDateOnlyUtc,
  todayUtc,
} = require('../services/status');

const ORIGINAL_TZ = process.env.TZ;

function useTimeZone(timeZone) {
  process.env.TZ = timeZone;
}

afterEach(() => {
  if (ORIGINAL_TZ === undefined) delete process.env.TZ;
  else process.env.TZ = ORIGINAL_TZ;
});

describe('toDateOnlyUtc', () => {
  it('parses YYYY-MM-DD strings as UTC midnight', () => {
    assert.equal(toDateOnlyUtc('2026-11-17').toISOString(), '2026-11-17T00:00:00.000Z');
    assert.equal(toDateOnlyUtc(' 2028-02-29 ').toISOString(), '2028-02-29T00:00:00.000Z');
  });

  it('keeps the UTC calendar date of Date values', () => {
    const date = new Date('2026-11-17T23:59:59.999Z');
    assert.equal(toDateOnlyUtc(date).toISOString(), '2026-11-17T00:00:00.000Z');
  });

  it('rejects invalid input', () => {
    for (const value of [
      null,
      undefined,
      '',
      '2026-02-30',
      '17/11/2026',
      20261117,
      new Date('x'),
    ]) {
      assert.equal(toDateOnlyUtc(value), null, `expected null for ${String(value)}`);
    }
  });
});

describe('todayUtc and daysUntil', () => {
  it('use the server-local calendar date around midnight (east of UTC)', () => {
    useTimeZone('Europe/Bucharest');
    // 00:30 on 18 November in Bucharest, still 17 November in UTC.
    const now = new Date('2026-11-17T22:30:00Z');
    assert.equal(todayUtc(now).toISOString(), '2026-11-18T00:00:00.000Z');
    assert.equal(daysUntil('2026-11-18', now), 0);
    assert.equal(daysUntil('2026-11-17', now), -1);
    assert.equal(computeStatus('2026-11-17', { now }), STATUS.EXPIRED);
    assert.equal(computeStatus('2026-11-18', { now }), STATUS.EXPIRING);
  });

  it('use the server-local calendar date around midnight (west of UTC)', () => {
    useTimeZone('America/New_York');
    // 22:00 on 17 November in New York, already 18 November in UTC.
    const now = new Date('2026-11-18T03:00:00Z');
    assert.equal(todayUtc(now).toISOString(), '2026-11-17T00:00:00.000Z');
    assert.equal(daysUntil('2026-11-17', now), 0);
    assert.equal(daysUntil('2026-11-18', now), 1);
  });

  it('count whole days across daylight-saving changes', () => {
    useTimeZone('Europe/Bucharest');
    const now = new Date('2026-10-24T10:00:00Z');
    assert.equal(daysUntil('2026-10-26', now), 2);
    assert.equal(daysUntil(new Date('2026-11-23T00:00:00Z'), now), 30);
  });

  it('return null without an expiry date', () => {
    assert.equal(daysUntil(null), null);
    assert.equal(daysUntil(undefined, new Date()), null);
  });
});

describe('computeStatus', () => {
  const now = new Date(2026, 10, 17, 12, 0);

  it('maps the days left to a status', () => {
    assert.equal(computeStatus(null, { now }), STATUS.MISSING);
    assert.equal(computeStatus('2026-11-16', { now }), STATUS.EXPIRED);
    assert.equal(computeStatus('2026-11-17', { now }), STATUS.EXPIRING);
    assert.equal(computeStatus('2026-12-17', { now, warningDays: 30 }), STATUS.EXPIRING);
    assert.equal(computeStatus('2026-12-18', { now, warningDays: 30 }), STATUS.VALID);
  });

  it('honours the warning window and defaults to 30 days', () => {
    assert.equal(computeStatus('2026-11-17', { now, warningDays: 0 }), STATUS.EXPIRING);
    assert.equal(computeStatus('2026-11-18', { now, warningDays: 0 }), STATUS.VALID);
    assert.equal(computeStatus('2026-12-17', { now }), STATUS.EXPIRING);
  });

  it('ranks statuses by urgency', () => {
    const ranked = Object.keys(STATUS_META).sort(
      (a, b) => STATUS_META[a].rank - STATUS_META[b].rank,
    );
    assert.deepEqual(ranked, ['expired', 'expiring', 'missing', 'valid']);
    assert.equal(STATUS_META.expiring.badgeClass, 'text-bg-warning');
  });
});

describe('createFormatter', () => {
  it('formats calendar dates in UTC whatever the server time zone', () => {
    useTimeZone('America/Los_Angeles');
    const fmt = createFormatter({ locale: 'en-GB' });
    assert.equal(fmt.date(new Date('2026-11-17T00:00:00Z')), '17 Nov 2026');
    assert.equal(fmt.date('2026-02-03'), '3 Feb 2026');
    assert.equal(createFormatter({ locale: 'en-US' }).date('2026-11-17'), 'Nov 17, 2026');
    assert.equal(fmt.date(null), '—');
    assert.equal(fmt.date('not a date'), '—');
  });

  it('formats date input values', () => {
    const fmt = createFormatter();
    assert.equal(fmt.dateInput(new Date('2026-11-17T00:00:00Z')), '2026-11-17');
    assert.equal(fmt.dateInput('2026-11-17'), '2026-11-17');
    assert.equal(fmt.dateInput(undefined), '');
    assert.equal(fmt.dateInput(new Date('invalid')), '');
  });

  it('formats timestamps in the configured time zone', () => {
    const fmt = createFormatter({ locale: 'en-GB', timeZone: 'Europe/Bucharest' });
    assert.match(fmt.dateTime(new Date('2026-11-17T22:30:00Z')), /^18 Nov 2026\D+00:30$/);
    assert.equal(fmt.dateTime(null), '—');
  });

  it('describes relative days', () => {
    const cases = [
      [0, 'today'],
      [1, 'tomorrow'],
      [-1, 'yesterday'],
      [5, 'in 5 days'],
      [-12, '12 days ago'],
      [59, 'in 59 days'],
      [90, 'in 3 months'],
      [-200, '7 months ago'],
      [365, 'in 1 year'],
      [800, 'in 2 years'],
      [null, '—'],
    ];
    for (const [days, expected] of cases) assert.equal(relativeDays(days), expected);
  });

  it('formats file sizes', () => {
    const cases = [
      [0, '0 B'],
      [1023, '1023 B'],
      [1536, '1.5 KB'],
      [1258291, '1.2 MB'],
      [25 * 1024 * 1024, '25 MB'],
      [undefined, '—'],
      [-5, '—'],
    ];
    for (const [bytes, expected] of cases) assert.equal(fileSize(bytes), expected);
  });
});
