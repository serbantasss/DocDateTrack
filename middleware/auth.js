const createError = require('http-errors');
const User = require('../models/user');

/** Returns `value` when it is a same-site relative path (`/x`, not `//x` or a URL), else null. */
function safeReturnTo(value) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) return null;
  // Browsers treat backslashes like slashes, so `/\evil.example` would leave the site.
  if (/[\\\p{Cc}]/u.test(value)) return null;
  return value;
}

/**
 * True for top-level page loads. Sub-resource requests (images, favicons, fetches) must not
 * become the post-sign-in destination, and `req.accepts('html')` would also match `*\/*`.
 */
function isPageNavigation(req) {
  const mode = req.get('sec-fetch-mode');
  if (mode) return mode === 'navigate';
  return /\btext\/html\b/.test(req.get('accept') ?? '');
}

/** While no account exists, sends every request to the first-run registration page. */
async function firstRunRedirect(req, res, next) {
  if (req.user || (await User.exists({}))) return next();
  res.redirect('/register');
}

function requireAuth(req, res, next) {
  if (req.isAuthenticated()) return next();
  if (req.method === 'GET' || req.method === 'HEAD') {
    const returnTo = safeReturnTo(req.originalUrl);
    if (req.method === 'GET' && returnTo && isPageNavigation(req)) req.session.returnTo = returnTo;
    return res.redirect('/login');
  }
  next(createError(401, 'Please sign in to continue.'));
}

function requireAdmin(req, res, next) {
  if (!req.isAuthenticated()) return requireAuth(req, res, next);
  if (req.user.role === 'admin') return next();
  next(createError(403, 'Only administrators can access this page.'));
}

module.exports = { requireAuth, requireAdmin, firstRunRedirect, safeReturnTo };
