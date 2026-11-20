const passport = require('../config/passport');
const User = require('../models/user');
const { safeReturnTo } = require('../middleware/auth');
const { markAuthSuccess } = require('../middleware/rateLimit');
const {
  createAccount,
  displayNameRule,
  emailRule,
  formErrors,
  formValues,
  newPasswordRules,
  orderErrors,
  stringField,
  usernameRule,
} = require('./userForms');

const REMEMBER_ME_MS = 30 * 24 * 60 * 60 * 1000;
const LOGIN_FAILED = 'Invalid username/email or password.';

/** Resolves to the user when the posted credentials are valid, else to false. */
function authenticateLocal(req, res) {
  return new Promise((resolve, reject) => {
    passport.authenticate('local', (error, user) => {
      if (error) reject(error);
      else resolve(user);
    })(req, res, reject);
  });
}

/**
 * Starts a login session for `user` (passport regenerates the session id). Pass
 * `{ keepSessionInfo: true }` to carry over the data of the current session.
 */
function logIn(req, user, options = {}) {
  return new Promise((resolve, reject) => {
    req.logIn(user, options, (error) => (error ? reject(error) : resolve()));
  });
}

function logOut(req) {
  return new Promise((resolve, reject) => {
    req.logOut((error) => (error ? reject(error) : resolve()));
  });
}

async function startSession(req, res, user, { remember = false } = {}) {
  await logIn(req, user);
  markAuthSuccess(res);
  // Without maxAge the cookie lasts for the browser session (server-side expiry still applies).
  if (remember) req.session.cookie.maxAge = REMEMBER_ME_MS;
  await User.updateOne({ _id: user._id }, { $set: { last_login_at: new Date() } });
}

function registrationClosed(req, res) {
  req.flash('info', 'Registration is closed. Ask an administrator to create an account for you.');
  res.redirect('/login');
}

async function showLogin(req, res) {
  if (req.user) return res.redirect('/');
  if (!(await User.exists({}))) return res.redirect('/register');
  res.render('auth/login', {
    title: 'Sign in',
    values: { username: req.flash('username')[0] ?? '' },
  });
}

async function login(req, res) {
  // Signing in to another account requires signing out first. The rate limiter counts this
  // request, so signed-in clients cannot use the form to guess other passwords either.
  if (req.isAuthenticated()) return res.redirect('/');

  const form = req.body ?? {};
  const username = stringField(form.username).trim();
  const password = stringField(form.password);
  const returnTo = safeReturnTo(req.session.returnTo);

  const fail = (message) => {
    req.flash('error', message);
    if (username) req.flash('username', username);
    res.redirect('/login');
  };

  if (!username || !password) return fail('Enter your username or email and your password.');
  form.username = username;

  const user = await authenticateLocal(req, res);
  if (!user) return fail(LOGIN_FAILED);

  await startSession(req, res, user, { remember: form.remember === '1' });
  res.redirect(returnTo ?? '/');
}

async function logout(req, res) {
  if (req.isAuthenticated()) {
    await logOut(req);
    req.flash('success', 'You have been signed out.');
  }
  res.redirect('/login');
}

async function showRegister(req, res) {
  if (req.user) return res.redirect('/');
  const isFirstUser = !(await User.exists({}));
  if (!isFirstUser && !req.app.get('config').allowRegistration) return registrationClosed(req, res);
  res.render('auth/register', {
    title: 'Create account',
    values: { username: '', email: '', display_name: '' },
    errors: {},
    isFirstUser,
  });
}

const registrationRules = [usernameRule(), emailRule(), displayNameRule(), ...newPasswordRules()];
const REGISTRATION_FIELDS = ['username', 'email', 'display_name', 'password', 'password_confirm'];

async function handleRegister(req, res) {
  if (req.user) return res.redirect('/');
  const isFirstUser = !(await User.exists({}));
  if (!isFirstUser && !req.app.get('config').allowRegistration) return registrationClosed(req, res);

  const values = formValues(req.body, ['username', 'email', 'display_name']);
  const errors = formErrors(req);
  const role = isFirstUser ? 'admin' : 'member';
  const user = await createAccount({ ...values, role }, req.body?.password, errors);
  if (!user) {
    return res.status(422).render('auth/register', {
      title: 'Create account',
      values,
      errors: orderErrors(errors, REGISTRATION_FIELDS),
      isFirstUser,
    });
  }

  await startSession(req, res, user);
  req.flash(
    'success',
    isFirstUser
      ? `Welcome, ${user.name}! Your administrator account is ready.`
      : `Welcome, ${user.name}! Your account has been created.`,
  );
  res.redirect('/');
}

module.exports = {
  showLogin,
  login,
  logout,
  showRegister,
  register: [...registrationRules, handleRegister],
  logIn,
};
