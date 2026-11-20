const createError = require('http-errors');
const { rateLimit } = require('express-rate-limit');

const DEFAULT_AUTH_LIMIT = Object.freeze({ windowMs: 15 * 60 * 1000, limit: 10 });
const AUTH_SUCCEEDED = Symbol('authSucceeded');

/**
 * Marks the response as a successful sign-in, registration or password change, which the auth
 * limiter does not count. Call it once the credentials have been accepted.
 */
function markAuthSuccess(res) {
  res[AUTH_SUCCEEDED] = true;
}

/**
 * Limits failed sign-in, registration and password-change attempts per client IP. Every request
 * counts unless markAuthSuccess() was called, also for clients that are already signed in. Behind
 * a reverse proxy, set TRUST_PROXY so the client IP is detected correctly.
 */
function createAuthLimiter(options = {}) {
  const { windowMs, limit } = { ...DEFAULT_AUTH_LIMIT, ...options };
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    requestWasSuccessful: (req, res) => res[AUTH_SUCCEEDED] === true,
    handler: (req, res, next) => {
      next(createError(429, 'Too many attempts. Please wait a few minutes and try again.'));
    },
  });
}

/** Applies the per-app limiter created by createApp(); a no-op when rate limiting is disabled. */
function authLimiter(req, res, next) {
  const limiter = req.app.get('authLimiter');
  if (!limiter) return next();
  return limiter(req, res, next);
}

module.exports = { authLimiter, createAuthLimiter, markAuthSuccess };
