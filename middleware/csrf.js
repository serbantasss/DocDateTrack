const crypto = require('node:crypto');
const createError = require('http-errors');

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
// Methods used by upload forms (POST, and PUT through method override); never DELETE.
const DEFERRABLE_METHODS = new Set(['POST', 'PUT']);
const SAME_ORIGIN_FETCH_SITES = new Set(['same-origin', 'none']);

function getToken(req) {
  if (!req.session) throw new Error('CSRF protection requires express-session.');
  if (!req.session.csrfToken) req.session.csrfToken = crypto.randomBytes(32).toString('base64url');
  return req.session.csrfToken;
}

function tokensMatch(expected, provided) {
  if (typeof expected !== 'string' || typeof provided !== 'string' || provided === '') return false;
  const digest = (value) => crypto.createHash('sha256').update(value).digest();
  return crypto.timingSafeEqual(digest(expected), digest(provided));
}

function csrfError() {
  return createError(403, 'Invalid or missing CSRF token.', { code: 'EBADCSRFTOKEN' });
}

/**
 * Checks the token sent as the `_csrf` body field or the `x-csrf-token` header. Multipart routes
 * must call it right after multer: `[upload.single('file'), verifyCsrf, handler]`.
 */
function verifyCsrf(req, res, next) {
  const provided = req.body?._csrf ?? req.get('x-csrf-token');
  next(tokensMatch(req.session?.csrfToken, provided) ? undefined : csrfError());
}

/**
 * True when the browser reports that the request comes from this site's own pages: by
 * `Sec-Fetch-Site`, or — for browsers that do not send it — by an `Origin` (or `Referer`) whose
 * host is the request's host. Requests without any of these headers are not trusted.
 */
function isSameOriginRequest(req) {
  const fetchSite = req.get('sec-fetch-site');
  if (fetchSite) return SAME_ORIGIN_FETCH_SITES.has(fetchSite);
  const source = req.get('origin') ?? req.get('referer');
  if (!source) return false;
  try {
    return new URL(source).host === req.host;
  } catch {
    return false;
  }
}

/**
 * Per-session synchronizer token. The token is created lazily (the first time a view renders
 * `csrfToken` or `req.csrfToken()` is called), so requests that never render a page do not
 * create a session.
 */
function csrfProtection(req, res, next) {
  req.csrfToken = () => getToken(req);
  Object.defineProperty(res.locals, 'csrfToken', {
    configurable: true,
    enumerable: true,
    get: req.csrfToken,
  });

  if (SAFE_METHODS.has(req.method)) return next();

  if (
    req.is('multipart/form-data') &&
    DEFERRABLE_METHODS.has(req.method) &&
    isSameOriginRequest(req)
  ) {
    // The body is not parsed yet, so the upload route verifies the `_csrf` field after multer.
    // Only same-origin requests are deferred; any other multipart request must carry the token
    // in the x-csrf-token header, even on routes that never call verifyCsrf.
    return next();
  }

  verifyCsrf(req, res, next);
}

module.exports = { csrfProtection, verifyCsrf };
