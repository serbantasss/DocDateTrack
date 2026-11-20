const path = require('node:path');
const compression = require('compression');
const { MongoStore } = require('connect-mongo');
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const methodOverride = require('method-override');
const mongoose = require('mongoose');
const morgan = require('morgan');

const passport = require('./config/passport');
const { createFormatter } = require('./lib/format');
const { firstRunRedirect, requireAdmin, requireAuth } = require('./middleware/auth');
const { csrfProtection } = require('./middleware/csrf');
const { errorHandler, notFound } = require('./middleware/errors');
const { flash } = require('./middleware/flash');
const { locals } = require('./middleware/locals');
const { createAuthLimiter } = require('./middleware/rateLimit');
const Category = require('./models/category');
const accountRouter = require('./routes/account');
const authRouter = require('./routes/auth');
const indexRouter = require('./routes/index');
const usersRouter = require('./routes/users');
const { STATUS_META } = require('./services/status');

const BOOTSTRAP_DIR = path.join(path.dirname(require.resolve('bootstrap/package.json')), 'dist');
const BOOTSTRAP_ICONS_DIR = path.join(
  path.dirname(require.resolve('bootstrap-icons/package.json')),
  'font',
);
const OVERRIDABLE_METHODS = new Set(['PUT', 'PATCH', 'DELETE']);
const BODY_LIMIT = '100kb';

function overriddenMethod(req) {
  const method = req.query._method;
  return typeof method === 'string' && OVERRIDABLE_METHODS.has(method.toUpperCase())
    ? method
    : undefined;
}

function createSessionStore(config) {
  const client = mongoose.connection.getClient();
  if (mongoose.connection.readyState !== 1 || !client) {
    throw new Error('createApp() needs an open mongoose connection or an explicit sessionStore.');
  }
  const store = MongoStore.create({
    client,
    dbName: mongoose.connection.name,
    ttl: Math.round(config.session.ttlHours * 60 * 60),
  });
  // The store creates its TTL index in the background. Report failures instead of crashing,
  // and stay quiet when the connection is being closed (e.g. a failed startup).
  store.collectionP.catch((error) => {
    if (mongoose.connection.readyState === 1) {
      console.error('Unable to prepare the session store:', error.message);
    }
  });
  return store;
}

function healthCheck(req, res) {
  const healthy = mongoose.connection.readyState === 1;
  res.set('Cache-Control', 'no-store');
  res.status(healthy ? 200 : 503).json({ status: healthy ? 'ok' : 'unavailable' });
}

function csrfTokenRoute(req, res) {
  res.set('Cache-Control', 'no-store');
  res.json({ token: req.csrfToken() });
}

/**
 * Builds the Express application.
 *
 * @param {object} options
 * @param {object} options.config Result of loadConfig().
 * @param {import('express-session').Store} [options.sessionStore] Defaults to a MongoDB store on
 *   the open mongoose connection.
 * @param {false|{windowMs?: number, limit?: number}} [options.authRateLimit] Options for the
 *   sign-in/registration rate limiter, or false to disable it.
 */
function createApp({ config, sessionStore, authRateLimit = {} } = {}) {
  if (!config) throw new Error('createApp() requires a config object from loadConfig().');

  const app = express();
  app.set('config', config);
  app.set('env', config.env);
  app.set(
    'trust proxy',
    Array.isArray(config.trustProxy) ? [...config.trustProxy] : config.trustProxy,
  );
  app.set('views', path.join(__dirname, 'views'));
  app.set('view engine', 'pug');
  app.set('view cache', config.isProduction);
  app.set('authLimiter', authRateLimit === false ? null : createAuthLimiter(authRateLimit));
  app.disable('x-powered-by');

  Object.assign(app.locals, {
    appName: config.appName,
    fmt: createFormatter({ locale: config.dateLocale }),
    statusMeta: STATUS_META,
    scopes: Category.SCOPES,
  });

  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'"],
          imgSrc: ["'self'", 'data:'],
          fontSrc: ["'self'"],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
          frameAncestors: ["'none'"],
        },
      },
      frameguard: { action: 'deny' },
      referrerPolicy: { policy: 'same-origin' },
      // HSTS belongs on the TLS-terminating proxy; plain-HTTP LAN installs must keep working.
      strictTransportSecurity: false,
    }),
  );
  app.use(compression());
  if (config.logFormat !== 'none') {
    app.use(
      morgan(config.logFormat, {
        skip: (req, res) => req.originalUrl === '/healthz' && res.statusCode === 200,
      }),
    );
  }

  const staticOptions = { index: false, maxAge: config.isProduction ? '1h' : 0 };
  app.use(express.static(path.join(__dirname, 'public'), staticOptions));
  app.use(
    '/vendor/bootstrap',
    express.static(BOOTSTRAP_DIR, { ...staticOptions, fallthrough: false }),
  );
  app.use(
    '/vendor/bootstrap-icons',
    express.static(BOOTSTRAP_ICONS_DIR, { ...staticOptions, fallthrough: false }),
  );

  app.use(express.urlencoded({ extended: false, limit: BODY_LIMIT }));
  app.use(express.json({ limit: BODY_LIMIT }));
  app.use(methodOverride(overriddenMethod, { methods: ['POST'] }));
  app.use(
    session({
      name: 'ddt.sid',
      secret: config.session.secret,
      store: sessionStore ?? createSessionStore(config),
      resave: false,
      saveUninitialized: false,
      cookie: { httpOnly: true, sameSite: 'lax', secure: config.session.cookieSecure },
    }),
  );
  app.use(passport.initialize());
  app.use(passport.session());
  app.use(flash());
  app.use(locals);
  app.use(csrfProtection);

  app.get('/healthz', healthCheck);
  app.get('/csrf-token', csrfTokenRoute);
  app.use(authRouter);

  app.use(firstRunRedirect, requireAuth);
  app.use('/account', accountRouter);
  app.use('/users', requireAdmin, usersRouter);
  app.use('/', indexRouter);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}

module.exports = { createApp };
