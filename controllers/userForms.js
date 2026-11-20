/**
 * Validation rules and helpers shared by the registration, account and user administration
 * forms. Every rule checks that the value is a string first, so arrays and objects sent as
 * form or JSON values never reach a query.
 */
const { body, validationResult } = require('express-validator');
const User = require('../models/user');

const USERNAME_TAKEN = 'This username is already taken.';
const EMAIL_TAKEN = 'An account with this email address already exists.';

/** The value when it is a string, else ''. */
function stringField(value) {
  return typeof value === 'string' ? value : '';
}

/** String values of `fields` from a request body, for re-rendering a form. */
function formValues(source, fields) {
  return Object.fromEntries(fields.map((field) => [field, stringField(source?.[field])]));
}

const usernameRule = () =>
  body('username')
    .isString()
    .withMessage('Enter a username.')
    .bail()
    .trim()
    .toLowerCase()
    .notEmpty()
    .withMessage('Enter a username.')
    .bail()
    .isLength({ min: 3, max: 50 })
    .withMessage('The username must be 3–50 characters long.')
    .bail()
    .matches(/^[a-z0-9._-]+$/)
    .withMessage('The username may only contain letters, digits, dots, dashes and underscores.');

const emailRule = () =>
  body('email')
    .isString()
    .withMessage('Enter an email address.')
    .bail()
    .trim()
    .toLowerCase()
    .notEmpty()
    .withMessage('Enter an email address.')
    .bail()
    .isLength({ max: 254 })
    .withMessage('The email address is too long.')
    .bail()
    .isEmail()
    .withMessage('Enter a valid email address.');

const displayNameRule = () =>
  body('display_name')
    .optional({ values: 'falsy' })
    .isString()
    .withMessage('Enter a valid display name.')
    .bail()
    .trim()
    .isLength({ max: 100 })
    .withMessage('The display name must be at most 100 characters long.');

const roleRule = () =>
  body('role')
    .isString()
    .withMessage('Choose a role.')
    .bail()
    .isIn(Object.keys(User.ROLES))
    .withMessage('Choose a role.');

/**
 * Rules for choosing a password: `field` must be 10–128 characters long and `confirmField` must
 * match it. With `optional`, both may be left blank (e.g. to keep the current password).
 */
function newPasswordRules({
  field = 'password',
  confirmField = 'password_confirm',
  label = 'password',
  optional = false,
} = {}) {
  const password = optional ? body(field).optional({ values: 'falsy' }) : body(field);
  return [
    password
      .isString()
      .withMessage(`Enter a ${label}.`)
      .bail()
      .notEmpty()
      .withMessage(`Enter a ${label}.`)
      .bail()
      .isLength({ min: 10, max: 128 })
      .withMessage(`The ${label} must be 10–128 characters long.`),
    body(confirmField)
      .custom((value, { req }) => stringField(value) === stringField(req.body?.[field]))
      .withMessage('The passwords do not match.'),
  ];
}

/** Validation errors of the request as a `.mapped()` object that more errors can be added to. */
function formErrors(req) {
  return validationResult(req).mapped();
}

/** Adds an error for `path` unless the field already has one. */
function addError(errors, path, msg) {
  errors[path] ??= { type: 'field', location: 'body', path, msg };
}

function hasErrors(errors) {
  return Object.keys(errors).length > 0;
}

/** `errors` sorted like the form's `fields`, so the error summary follows the form. */
function orderErrors(errors, fields) {
  const rank = (path) => (fields.includes(path) ? fields.indexOf(path) : fields.length);
  return Object.fromEntries(Object.entries(errors).sort(([a], [b]) => rank(a) - rank(b)));
}

/**
 * Adds "already taken" errors when another account (any account except `exceptId`) uses the
 * username or the email address. Fields that are undefined or already invalid are not checked.
 */
async function checkAvailability(errors, { username, email }, exceptId) {
  const others = exceptId ? { _id: { $ne: exceptId } } : {};
  if (typeof username === 'string' && !errors.username) {
    if (await User.exists({ ...others, username })) addError(errors, 'username', USERNAME_TAKEN);
  }
  if (typeof email === 'string' && !errors.email) {
    if (await User.exists({ ...others, email })) addError(errors, 'email', EMAIL_TAKEN);
  }
}

/**
 * Saves the user and returns true. Returns false after adding field errors when the username
 * or email address was taken in the meantime (duplicate key) or the model rejects a value;
 * other errors are thrown.
 */
async function saveUser(user, errors) {
  try {
    await user.save();
    return true;
  } catch (error) {
    if (error.code === 11000) {
      if (error.keyPattern?.email) addError(errors, 'email', EMAIL_TAKEN);
      else addError(errors, 'username', USERNAME_TAKEN);
      return false;
    }
    if (error.name === 'ValidationError') {
      for (const [path, fieldError] of Object.entries(error.errors)) {
        addError(errors, path, fieldError.message);
      }
      return false;
    }
    throw error;
  }
}

/**
 * Creates an account when the form is valid (`errors` is empty) and the username and email
 * address are available. Returns the new user, or null with the problems added to `errors`.
 */
async function createAccount({ username, email, display_name, role }, password, errors) {
  await checkAvailability(errors, { username, email });
  if (hasErrors(errors)) return null;
  const user = new User({ username, email, display_name: display_name || undefined, role });
  await user.setPassword(password);
  return (await saveUser(user, errors)) ? user : null;
}

module.exports = {
  stringField,
  formValues,
  usernameRule,
  emailRule,
  displayNameRule,
  roleRule,
  newPasswordRules,
  formErrors,
  addError,
  hasErrors,
  orderErrors,
  checkAvailability,
  saveUser,
  createAccount,
};
