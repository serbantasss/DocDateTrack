const { body } = require('express-validator');
const createError = require('http-errors');
const { AuthenticationError } = require('passport-local-mongoose').errors;
const { markAuthSuccess } = require('../middleware/rateLimit');
const User = require('../models/user');
const { logIn } = require('./authController');
const {
  addError,
  checkAvailability,
  displayNameRule,
  emailRule,
  formErrors,
  formValues,
  hasErrors,
  newPasswordRules,
  orderErrors,
  saveUser,
} = require('./userForms');

const FORM_FIELDS = [
  'email',
  'display_name',
  'current_password',
  'new_password',
  'new_password_confirm',
];

function profileValues(user) {
  return { email: user.email, display_name: user.display_name ?? '' };
}

/** `failedForm` ('profile' or 'password') tells the page which form `errors` belong to. */
function renderAccount(req, res, { values, errors = {}, failedForm = null, status = 200 } = {}) {
  res.status(status).render('account/index', {
    title: 'Account',
    account: req.user,
    values: values ?? profileValues(req.user),
    errors: orderErrors(errors, FORM_FIELDS),
    failedForm,
    roles: User.ROLES,
  });
}

/** A fresh copy of the signed-in user, so `req.user` stays unchanged when saving fails. */
function loadAccount(req) {
  return User.findById(req.user._id).orFail(() => createError(401, 'Please sign in to continue.'));
}

function show(req, res) {
  renderAccount(req, res);
}

async function handleProfile(req, res) {
  const values = formValues(req.body, ['email', 'display_name']);
  const errors = formErrors(req);
  await checkAvailability(errors, { email: values.email }, req.user._id);
  if (!hasErrors(errors)) {
    const account = await loadAccount(req);
    account.email = values.email;
    account.display_name = values.display_name || undefined;
    if (await saveUser(account, errors)) {
      req.flash('success', 'Your profile has been updated.');
      return res.redirect('/account');
    }
  }
  renderAccount(req, res, { values, errors, failedForm: 'profile', status: 422 });
}

const passwordRules = [
  body('current_password')
    .isString()
    .withMessage('Enter your current password.')
    .bail()
    .notEmpty()
    .withMessage('Enter your current password.'),
  ...newPasswordRules({
    field: 'new_password',
    confirmField: 'new_password_confirm',
    label: 'new password',
  }),
  body('new_password')
    .custom((value, { req }) => value !== req.body?.current_password)
    .withMessage('The new password must be different from the current one.'),
];

async function handlePassword(req, res) {
  const errors = formErrors(req);
  if (!hasErrors(errors)) {
    const account = await loadAccount(req).select('+hash +salt');
    try {
      // Saving the new password increments session_version, which signs out every session.
      await account.changePassword(req.body.current_password, req.body.new_password);
    } catch (error) {
      if (!(error instanceof AuthenticationError)) throw error;
      addError(errors, 'current_password', 'Your current password is incorrect.');
    }
    if (!hasErrors(errors)) {
      // Keep this browser signed in: a new session (new id, current version) with the old data.
      await logIn(req, account, { keepSessionInfo: true });
      markAuthSuccess(res);
      req.flash(
        'success',
        'Your password has been changed. Your other sessions have been signed out.',
      );
      return res.redirect('/account');
    }
  }
  renderAccount(req, res, { errors, failedForm: 'password', status: 422 });
}

module.exports = {
  show,
  updateProfile: [emailRule(), displayNameRule(), handleProfile],
  changePassword: [...passwordRules, handlePassword],
};
