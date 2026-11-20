const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_WARNING_DAYS = 30;
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

const STATUS = Object.freeze({
  EXPIRED: 'expired',
  EXPIRING: 'expiring',
  VALID: 'valid',
  MISSING: 'missing',
});

const STATUS_META = Object.freeze({
  expired: Object.freeze({
    label: 'Expired',
    badgeClass: 'text-bg-danger',
    icon: 'bi-x-octagon-fill',
    rank: 0,
  }),
  expiring: Object.freeze({
    label: 'Expiring soon',
    badgeClass: 'text-bg-warning',
    icon: 'bi-exclamation-triangle-fill',
    rank: 1,
  }),
  missing: Object.freeze({
    label: 'No versions',
    badgeClass: 'text-bg-secondary',
    icon: 'bi-question-circle',
    rank: 2,
  }),
  valid: Object.freeze({
    label: 'Valid',
    badgeClass: 'text-bg-success',
    icon: 'bi-check-circle-fill',
    rank: 3,
  }),
});

/** Returns the calendar date of a Date (its UTC date) or a `YYYY-MM-DD` string as UTC midnight. */
function toDateOnlyUtc(value) {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
  }
  if (typeof value !== 'string') return null;
  const match = DATE_ONLY.exec(value.trim());
  if (!match) return null;
  const [year, month, day] = match.slice(1).map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  const isRealDate =
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  return isRealDate ? date : null;
}

/** The server's local calendar date, as UTC midnight. */
function todayUtc(now = new Date()) {
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
}

/** Whole days from today until the expiry date: 0 = expires today, negative = already expired. */
function daysUntil(expiresAt, now = new Date()) {
  const expiry = toDateOnlyUtc(expiresAt);
  if (!expiry) return null;
  return Math.round((expiry.getTime() - todayUtc(now).getTime()) / DAY_MS);
}

function computeStatus(expiresAt, { now = new Date(), warningDays = DEFAULT_WARNING_DAYS } = {}) {
  const days = daysUntil(expiresAt, now);
  if (days === null) return STATUS.MISSING;
  if (days < 0) return STATUS.EXPIRED;
  if (days <= warningDays) return STATUS.EXPIRING;
  return STATUS.VALID;
}

module.exports = { STATUS, STATUS_META, toDateOnlyUtc, todayUtc, daysUntil, computeStatus };
