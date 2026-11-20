const FLASH_TYPES = ['success', 'error', 'info', 'warning'];

function readFlashMessages(req) {
  const messages = Object.fromEntries(FLASH_TYPES.map((type) => [type, []]));
  const stored = req.session?.flash;
  if (!stored) return messages;
  for (const type of FLASH_TYPES) {
    if (stored[type]?.length) messages[type] = req.flash(type);
  }
  return messages;
}

/** Template locals shared by every view. */
function locals(req, res, next) {
  const config = req.app.get('config');
  res.locals.currentUser = req.user || null;
  res.locals.isAdmin = req.user?.role === 'admin';
  res.locals.currentPath = req.path;
  res.locals.appName = config.appName;
  res.locals.allowRegistration = config.allowRegistration;
  res.locals.expiryWarningDays = config.expiryWarningDays;

  // Read lazily: Express evaluates the getter when a view renders, so flash messages survive
  // redirects and are consumed only by the page that displays them.
  let messages;
  Object.defineProperty(res.locals, 'messages', {
    configurable: true,
    enumerable: true,
    get() {
      messages ??= readFlashMessages(req);
      return messages;
    },
  });
  next();
}

module.exports = { locals };
