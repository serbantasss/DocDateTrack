const { body, matchedData, validationResult } = require('express-validator');
const createError = require('http-errors');
const mongoose = require('mongoose');

const Owner = require('../models/owner');
const { deleteDocuments } = require('../services/cascade');
const { matchesAllWords } = require('../lib/text');
const { findDocumentsWithStatus, sortByUrgency, summarize } = require('../services/documents');

const FIELDS = ['first_name', 'last_name', 'email', 'phone', 'notes'];
const SEARCH_MAX_LENGTH = 100;
const BY_NAME = { last_name: 1, first_name: 1 };
const CASE_INSENSITIVE = { locale: 'en', strength: 2 };

const isString = (value) => typeof value === 'string';
// Control characters other than whitespace (invisible, never wanted in names or notes).
const CONTROL_CHARACTERS = /[^\P{Cc}\s]/gu;
const singleLine = (value) =>
  value.normalize('NFC').replace(CONTROL_CHARACTERS, '').replace(/\s+/g, ' ').trim();
const multiLine = (value) =>
  value.normalize('NFC').replace(/\r\n?/g, '\n').replace(CONTROL_CHARACTERS, '').trim();

function plural(count, noun) {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

/** `tel:` link of a free-text phone number, ignoring extensions and remarks; null without digits. */
function phoneHref(phone) {
  if (!phone) return null;
  const number = phone
    .split(/\p{L}/u)[0]
    .replace(/[^\d+]/g, '')
    .replace(/(?!^)\+/g, '');
  return /\d/.test(number) ? `tel:${number}` : null;
}

async function findOwner(id) {
  const owner = mongoose.isObjectIdOrHexString(id) ? await Owner.findById(id) : null;
  if (!owner) throw createError(404, 'This owner does not exist or has been deleted.');
  return owner;
}

// Owners are people or organisations ("Smith & Sons", "3M"), so names are free single-line text.
function nameRule(field, label) {
  return body(field)
    .custom(isString)
    .withMessage(`Enter a ${label}.`)
    .bail()
    .customSanitizer(singleLine)
    .notEmpty()
    .withMessage(`Enter a ${label}.`)
    .bail()
    .isLength({ max: 100 })
    .withMessage(`The ${label} must be at most 100 characters long.`);
}

const ownerRules = [
  nameRule('first_name', 'first name'),
  nameRule('last_name', 'last name'),
  body('email')
    .optional({ values: 'falsy' })
    .custom(isString)
    .withMessage('Enter a valid email address.')
    .bail()
    .trim()
    .isLength({ max: 254 })
    .withMessage('The email address must be at most 254 characters long.')
    .bail()
    .isEmail()
    .withMessage('Enter a valid email address, such as name@example.com.')
    .bail()
    .toLowerCase(),
  body('phone')
    .optional({ values: 'falsy' })
    .custom(isString)
    .withMessage('Enter the phone number as text.')
    .bail()
    .customSanitizer(singleLine)
    .isLength({ max: 40 })
    .withMessage('The phone number must be at most 40 characters long.'),
  body('notes')
    .optional({ values: 'falsy' })
    .custom(isString)
    .withMessage('Enter the notes as text.')
    .bail()
    .customSanitizer(multiLine)
    .isLength({ max: 2000 })
    .withMessage('The notes must be at most 2000 characters long.'),
];

/** The submitted fields after sanitization; anything that is not a string becomes ''. */
function readForm(req) {
  const data = matchedData(req, {
    locations: ['body'],
    includeOptionals: true,
    onlyValidData: false,
  });
  return Object.fromEntries(
    FIELDS.map((field) => [field, isString(data[field]) ? data[field] : '']),
  );
}

function formValues(owner) {
  return Object.fromEntries(FIELDS.map((field) => [field, owner?.[field] ?? '']));
}

function ownerData(values) {
  return {
    first_name: values.first_name,
    last_name: values.last_name,
    email: values.email || undefined,
    phone: values.phone || undefined,
    notes: values.notes || undefined,
  };
}

function modelErrors(error) {
  return Object.fromEntries(
    Object.entries(error.errors).map(([path, { message }]) => [
      path,
      { type: 'field', location: 'body', path, msg: message },
    ]),
  );
}

function searchText(value) {
  if (!isString(value)) return '';
  const text = singleLine(value);
  return text.length <= SEARCH_MAX_LENGTH ? text : '';
}

function summariesByOwner(rows) {
  const groups = Object.groupBy(rows, (row) => String(row.document.owner?._id));
  return Object.fromEntries(
    Object.entries(groups).map(([ownerId, ownerRows]) => [ownerId, summarize(ownerRows)]),
  );
}

async function list(req, res) {
  const { expiryWarningDays } = req.app.get('config');
  const q = searchText(req.query.q);
  const allOwners = await Owner.find().sort(BY_NAME).collation(CASE_INSENSITIVE);
  // Every word must appear in the name or the email address, ignoring case and accents.
  const owners = q
    ? allOwners.filter((owner) =>
        matchesAllWords(q, [owner.first_name, owner.last_name, owner.email]),
      )
    : allOwners;
  const hasOwners = allOwners.length > 0;
  const rows =
    owners.length > 0
      ? await findDocumentsWithStatus({
          match: { owner: { $in: owners.map((owner) => owner._id) } },
          warningDays: expiryWarningDays,
        })
      : [];
  res.render('owners/index', {
    title: 'Owners',
    owners,
    stats: summariesByOwner(rows),
    q,
    hasOwners,
    phoneHref,
  });
}

async function show(req, res) {
  const { expiryWarningDays } = req.app.get('config');
  const owner = await findOwner(req.params.id);
  const rows = sortByUrgency(
    await findDocumentsWithStatus({ match: { owner: owner._id }, warningDays: expiryWarningDays }),
  );
  res.render('owners/show', {
    title: owner.name,
    owner,
    rows,
    summary: summarize(rows),
    phoneHref,
  });
}

function newForm(req, res) {
  res.render('owners/form', { title: 'Add owner', owner: null, values: formValues(), errors: {} });
}

async function handleCreate(req, res) {
  const values = readForm(req);
  let errors = validationResult(req).mapped();
  if (Object.keys(errors).length === 0) {
    try {
      const owner = await Owner.create(ownerData(values));
      req.flash('success', `Added ${owner.name}.`);
      return res.redirect(owner.url);
    } catch (error) {
      if (error.name !== 'ValidationError') throw error;
      errors = modelErrors(error);
    }
  }
  res.status(422).render('owners/form', { title: 'Add owner', owner: null, values, errors });
}

async function editForm(req, res) {
  const owner = await findOwner(req.params.id);
  res.render('owners/form', {
    title: `Edit ${owner.name}`,
    owner,
    values: formValues(owner),
    errors: {},
  });
}

async function handleUpdate(req, res) {
  const owner = await findOwner(req.params.id);
  // The page header and links keep showing the saved name while the form has errors.
  const saved = { _id: owner._id, name: owner.name, url: owner.url };
  const values = readForm(req);
  let errors = validationResult(req).mapped();
  if (Object.keys(errors).length === 0) {
    owner.set(ownerData(values));
    try {
      await owner.save();
      req.flash('success', `Saved the changes to ${owner.name}.`);
      return res.redirect(owner.url);
    } catch (error) {
      if (error.name !== 'ValidationError') throw error;
      errors = modelErrors(error);
    }
  }
  res
    .status(422)
    .render('owners/form', { title: `Edit ${saved.name}`, owner: saved, values, errors });
}

async function destroy(req, res) {
  const owner = await findOwner(req.params.id);
  const options = { uploadDir: req.app.get('config').uploads.dir };
  const removed = await deleteDocuments({ owner: owner._id }, options);
  await Owner.deleteOne({ _id: owner._id });
  // Sweep again: a document added while the owner was being deleted must not outlive it.
  const late = await deleteDocuments({ owner: owner._id }, options);
  const documents = removed.documents + late.documents;
  const versions = removed.versions + late.versions;
  req.flash(
    'success',
    documents > 0
      ? `Deleted ${owner.name} together with ${plural(documents, 'document')} and ` +
          `${plural(versions, 'version')}.`
      : `Deleted ${owner.name}.`,
  );
  res.redirect('/owners');
}

module.exports = {
  list,
  show,
  newForm,
  create: [...ownerRules, handleCreate],
  editForm,
  update: [...ownerRules, handleUpdate],
  destroy,
};
