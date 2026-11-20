const { DateTime } = require('luxon');

const EMPTY = '—';
const DATE_INPUT = /^\d{4}-\d{2}-\d{2}$/;
const FILE_SIZE_UNITS = ['KB', 'MB', 'GB', 'TB'];

function toDateTime(value, zone) {
  let dateTime;
  if (value instanceof Date) dateTime = DateTime.fromJSDate(value, { zone });
  else if (typeof value === 'number') dateTime = DateTime.fromMillis(value, { zone });
  else if (typeof value === 'string' && value.trim() !== '') {
    dateTime = DateTime.fromISO(value.trim(), { zone });
  } else return null;
  return dateTime.isValid ? dateTime : null;
}

function plural(count, unit) {
  return `${count} ${unit}${count === 1 ? '' : 's'}`;
}

/** English relative wording for a day difference: today, tomorrow, in 5 days, 12 days ago… */
function relativeDays(days) {
  if (days === null || days === undefined || days === '' || !Number.isFinite(Number(days))) {
    return EMPTY;
  }
  const value = Math.round(Number(days));
  if (value === 0) return 'today';
  if (value === 1) return 'tomorrow';
  if (value === -1) return 'yesterday';
  const abs = Math.abs(value);
  let phrase;
  if (abs < 60) phrase = plural(abs, 'day');
  else if (abs < 365) phrase = plural(Math.round(abs / 30.4375), 'month');
  else phrase = plural(Math.round(abs / 365.25), 'year');
  return value > 0 ? `in ${phrase}` : `${phrase} ago`;
}

function fileSize(bytes) {
  const value = Number(bytes);
  if (
    bytes === null ||
    bytes === undefined ||
    bytes === '' ||
    !Number.isFinite(value) ||
    value < 0
  ) {
    return EMPTY;
  }
  if (value < 1024) return `${Math.round(value)} B`;
  let size = value / 1024;
  let unit = 0;
  while (size >= 1024 && unit < FILE_SIZE_UNITS.length - 1) {
    size /= 1024;
    unit += 1;
  }
  const rounded = size < 10 ? Math.round(size * 10) / 10 : Math.round(size);
  return `${rounded} ${FILE_SIZE_UNITS[unit]}`;
}

/**
 * View helpers registered as `app.locals.fmt`. Calendar dates (issued_at / expires_at) are
 * stored as UTC midnight and always formatted in UTC; timestamps use `timeZone` (default: the
 * server's time zone).
 */
function createFormatter({ locale = 'en-GB', timeZone = 'system' } = {}) {
  return Object.freeze({
    date(value) {
      const dateTime = toDateTime(value, 'utc');
      return dateTime ? dateTime.setLocale(locale).toLocaleString(DateTime.DATE_MED) : EMPTY;
    },
    dateInput(value) {
      if (typeof value === 'string' && DATE_INPUT.test(value.trim())) return value.trim();
      const dateTime = toDateTime(value, 'utc');
      return dateTime ? dateTime.toISODate() : '';
    },
    dateTime(value) {
      const dateTime = toDateTime(value, timeZone);
      return dateTime ? dateTime.setLocale(locale).toLocaleString(DateTime.DATETIME_MED) : EMPTY;
    },
    relativeDays,
    fileSize,
  });
}

module.exports = { createFormatter, relativeDays, fileSize };
