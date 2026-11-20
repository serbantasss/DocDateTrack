const DEFAULT_PER_PAGE = 50;
const PAGE_NUMBER = /^\d{1,6}$/;

/** Page number from a query value; anything but a positive whole number means page 1. */
function parsePage(value) {
  if (typeof value !== 'string' || !PAGE_NUMBER.test(value)) return 1;
  return Math.max(1, Number(value));
}

/** `path` followed by a query string made of the non-empty values of `params`. */
function buildUrl(path, params = {}) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') search.append(key, String(value));
  }
  const query = search.toString();
  return query ? `${path}?${query}` : path;
}

/** Page numbers around the current page plus the first and last one; null marks a gap. */
function pageNumbers(current, totalPages, radius = 2) {
  const numbers = new Set([1, totalPages]);
  for (let number = current - radius; number <= current + radius; number += 1) {
    if (number >= 1 && number <= totalPages) numbers.add(number);
  }
  const sorted = [...numbers].sort((a, b) => a - b);
  const items = [];
  for (const number of sorted) {
    const previous = items.at(-1);
    if (previous && number - previous === 2) items.push(previous + 1);
    else if (previous && number - previous > 2) items.push(null);
    items.push(number);
  }
  return items;
}

/**
 * Pagination state for `total` items. `page` is clamped to the available pages and `url(page)`
 * builds the link of a page. The result is what the +pagination mixin expects.
 */
function paginate({ total, page = 1, perPage = DEFAULT_PER_PAGE, url }) {
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  const current = Math.min(Math.max(1, page), totalPages);
  const offset = (current - 1) * perPage;
  return {
    page: current,
    perPage,
    total,
    totalPages,
    offset,
    from: total === 0 ? 0 : offset + 1,
    to: Math.min(offset + perPage, total),
    previousUrl: current > 1 ? url(current - 1) : null,
    nextUrl: current < totalPages ? url(current + 1) : null,
    pages: pageNumbers(current, totalPages).map((number) =>
      number === null ? { gap: true } : { number, url: url(number), current: number === current },
    ),
  };
}

module.exports = { DEFAULT_PER_PAGE, buildUrl, paginate, parsePage };
