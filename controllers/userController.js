const createError = require('http-errors');
const mongoose = require('mongoose');
const User = require('../models/user');
const {
  addError,
  checkAvailability,
  createAccount,
  displayNameRule,
  emailRule,
  formErrors,
  formValues,
  hasErrors,
  newPasswordRules,
  orderErrors,
  roleRule,
  saveUser,
  stringField,
  usernameRule,
} = require('./userForms');

const FORM_FIELDS = ['username', 'email', 'display_name', 'role', 'password', 'password_confirm'];

let lastAdminChange = Promise.resolve();

/**
 * Runs `task` after the previous call has finished. Role changes and deletions decide on the
 * number of administrators, so they must not overlap: otherwise two administrators demoting or
 * deleting each other could both see "another administrator" and leave none. Tasks re-read the
 * users they check. A promise chain suffices because the app runs as a single process.
 */
function oneAtATime(task) {
  const result = lastAdminChange.then(() => task());
  lastAdminChange = result.catch(() => {});
  return result;
}

async function findUser(id) {
  const user = mongoose.isObjectIdOrHexString(id) ? await User.findById(id) : null;
  if (!user) throw createError(404, 'This user does not exist.');
  return user;
}

function isCurrentUser(req, user) {
  return user._id.equals(req.user._id);
}

/** The signed-in user may have been demoted or deleted while the request was waiting. */
async function assertStillAdmin(req) {
  if (!(await User.exists({ _id: req.user._id, role: 'admin' }))) {
    throw createError(403, 'Only administrators can access this page.');
  }
}

async function hasOtherAdmin(user) {
  return Boolean(await User.exists({ role: 'admin', _id: { $ne: user._id } }));
}

function lastAdminMessage(user) {
  return `${user.username} is the only administrator. Make another user an administrator first.`;
}

function renderForm(req, res, { user = null, values, errors = {}, status = 200 }) {
  res.status(status).render('users/form', {
    title: user ? `Edit ${user.username}` : 'Add user',
    user,
    isSelf: Boolean(user && isCurrentUser(req, user)),
    values,
    errors: orderErrors(errors, FORM_FIELDS),
    roles: User.ROLES,
  });
}

async function list(req, res) {
  const users = await User.find().sort({ username: 1 });
  res.render('users/index', { title: 'Users', users, roles: User.ROLES });
}

function showCreate(req, res) {
  renderForm(req, res, { values: { username: '', email: '', display_name: '', role: 'member' } });
}

const createRules = [
  usernameRule(),
  emailRule(),
  displayNameRule(),
  roleRule(),
  ...newPasswordRules(),
];

async function handleCreate(req, res) {
  const values = formValues(req.body, ['username', 'email', 'display_name', 'role']);
  const errors = formErrors(req);
  const user = await createAccount(values, req.body?.password, errors);
  if (!user) return renderForm(req, res, { values, errors, status: 422 });

  req.flash('success', `The user ${user.username} has been created and can now sign in.`);
  res.redirect('/users');
}

async function showEdit(req, res) {
  const user = await findUser(req.params.id);
  renderForm(req, res, {
    user,
    values: { email: user.email, display_name: user.display_name ?? '', role: user.role },
  });
}

const updateRules = [
  emailRule(),
  displayNameRule(),
  roleRule(),
  ...newPasswordRules({ label: 'new password', optional: true }),
];

/**
 * Applies the edit form to the user in `req.params.id`. Runs inside oneAtATime() and re-reads
 * both users there. Resolves with `{ user, saved, isSelf, demoted }`; problems go to `errors`.
 */
async function updateUser(req, { values, password, passwordEntered }, errors) {
  await assertStillAdmin(req);
  const user = await findUser(req.params.id);
  const isSelf = isCurrentUser(req, user);

  // Changing your own password requires the current one, which only the account page asks for.
  if (isSelf && passwordEntered) {
    delete errors.password;
    addError(errors, 'password', 'Change your own password on your account page.');
  }
  await checkAvailability(errors, { email: values.email }, user._id);
  const demoted = user.role === 'admin' && values.role !== 'admin';
  if (!errors.role && demoted && !(await hasOtherAdmin(user))) {
    addError(errors, 'role', lastAdminMessage(user));
  }
  if (hasErrors(errors)) return { user, saved: false };

  user.email = values.email;
  user.display_name = values.display_name || undefined;
  user.role = values.role;
  if (password) await user.setPassword(password);
  if (!(await saveUser(user, errors))) return { user, saved: false };

  // Safety net against changes made outside this process: keep at least one administrator.
  // The other changes stay saved; submitting the form again repeats them harmlessly.
  if (demoted && !(await User.exists({ role: 'admin' }))) {
    await User.updateOne({ _id: user._id }, { $set: { role: 'admin' } });
    addError(errors, 'role', lastAdminMessage(user));
    return { user, saved: false };
  }
  return { user, saved: true, isSelf, demoted };
}

async function handleUpdate(req, res) {
  const values = formValues(req.body, ['email', 'display_name', 'role']);
  const password = stringField(req.body?.password);
  const passwordEntered = Boolean(password || stringField(req.body?.password_confirm));
  const errors = formErrors(req);

  const { user, saved, isSelf, demoted } = await oneAtATime(() =>
    updateUser(req, { values, password, passwordEntered }, errors),
  );
  if (!saved) return renderForm(req, res, { user, values, errors, status: 422 });

  if (isSelf && demoted) {
    req.flash(
      'success',
      'Your changes have been saved. You are now a member and can no longer manage users.',
    );
    return res.redirect('/account');
  }
  req.flash(
    'success',
    password
      ? `The changes to ${user.username} have been saved. The new password is active and ` +
          'all their sessions have been signed out.'
      : `The changes to ${user.username} have been saved.`,
  );
  res.redirect('/users');
}

async function remove(req, res) {
  const [type, message] = await oneAtATime(async () => {
    await assertStillAdmin(req);
    const user = await findUser(req.params.id);
    if (isCurrentUser(req, user)) return ['error', 'You cannot delete your own account.'];
    if (user.role === 'admin' && !(await hasOtherAdmin(user))) {
      return ['error', `${user.username} is the only administrator and cannot be deleted.`];
    }
    await User.deleteOne({ _id: user._id });
    return ['success', `The user ${user.username} has been deleted.`];
  });
  req.flash(type, message);
  res.redirect('/users');
}

module.exports = {
  list,
  showCreate,
  create: [...createRules, handleCreate],
  showEdit,
  update: [...updateRules, handleUpdate],
  remove,
};
