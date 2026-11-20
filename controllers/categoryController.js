const { body, matchedData, validationResult } = require('express-validator');
const createError = require('http-errors');
const mongoose = require('mongoose');

const Category = require('../models/category');
const Document = require('../models/document');
const { findDocumentsWithStatus, sortByUrgency, summarize } = require('../services/documents');

const FIELDS = ['name', 'scope', 'description'];
const DEFAULT_SCOPE = 'personal';
const CASE_INSENSITIVE = { locale: 'en', strength: 2 };

const isString = (value) => typeof value === 'string';
const isScope = (value) => isString(value) && Object.hasOwn(Category.SCOPES, value);
// Control characters other than whitespace (invisible, never wanted in names or descriptions).
const CONTROL_CHARACTERS = /[^\P{Cc}\s]/gu;
const singleLine = (value) =>
  value.normalize('NFC').replace(CONTROL_CHARACTERS, '').replace(/\s+/g, ' ').trim();
const multiLine = (value) =>
  value.normalize('NFC').replace(/\r\n?/g, '\n').replace(CONTROL_CHARACTERS, '').trim();

function plural(count, noun) {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

function fieldError(path, msg) {
  return { type: 'field', location: 'body', path, msg };
}

async function findCategory(id) {
  const category = mongoose.isObjectIdOrHexString(id) ? await Category.findById(id) : null;
  if (!category) throw createError(404, 'This category does not exist or has been deleted.');
  return category;
}

const categoryRules = [
  body('name')
    .custom(isString)
    .withMessage('Enter a name.')
    .bail()
    .customSanitizer(singleLine)
    .notEmpty()
    .withMessage('Enter a name.')
    .bail()
    .isLength({ max: 100 })
    .withMessage('The name must be at most 100 characters long.'),
  body('scope').custom(isScope).withMessage('Choose a scope.'),
  body('description')
    .optional({ values: 'falsy' })
    .custom(isString)
    .withMessage('Enter the description as text.')
    .bail()
    .customSanitizer(multiLine)
    .isLength({ max: 500 })
    .withMessage('The description must be at most 500 characters long.'),
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

function formValues(category) {
  return Object.fromEntries(FIELDS.map((field) => [field, category[field] ?? '']));
}

/**
 * Validates the submitted form and saves it into `category`. Returns the field errors (an
 * express-validator `.mapped()`-style object), which is empty when the category was saved.
 */
async function applyForm(req, category, values) {
  const errors = validationResult(req).mapped();
  if (!errors.name) {
    const duplicate = await Category.findOne({ name: values.name, _id: { $ne: category._id } })
      .collation(CASE_INSENSITIVE)
      .select('name');
    if (duplicate) {
      errors.name = fieldError('name', `A category called “${duplicate.name}” already exists.`);
    }
  }
  if (Object.keys(errors).length > 0) return errors;

  category.set({
    name: values.name,
    scope: values.scope,
    description: values.description || undefined,
  });
  try {
    await category.save();
    return {};
  } catch (error) {
    if (error.code === 11000) {
      return { name: fieldError('name', 'A category with this name already exists.') };
    }
    if (error.name !== 'ValidationError') throw error;
    return Object.fromEntries(
      Object.entries(error.errors).map(([path, { message }]) => [path, fieldError(path, message)]),
    );
  }
}

async function list(req, res) {
  const activeScope = isScope(req.query.scope) ? req.query.scope : '';
  const [categories, scopeTotals] = await Promise.all([
    Category.find(activeScope ? { scope: activeScope } : {})
      .sort({ name: 1 })
      .collation(CASE_INSENSITIVE),
    Category.aggregate([{ $group: { _id: '$scope', count: { $sum: 1 } } }]),
  ]);
  const documentTotals = await Document.aggregate([
    { $match: { category: { $in: categories.map((category) => category._id) } } },
    { $group: { _id: '$category', count: { $sum: 1 } } },
  ]);
  const scopeCounts = Object.fromEntries(scopeTotals.map(({ _id, count }) => [_id, count]));
  res.render('categories/index', {
    title: 'Categories',
    categories,
    activeScope,
    scopeCounts,
    totalCategories: scopeTotals.reduce((total, { count }) => total + count, 0),
    documentCounts: Object.fromEntries(
      documentTotals.map(({ _id, count }) => [String(_id), count]),
    ),
  });
}

async function show(req, res) {
  const { expiryWarningDays } = req.app.get('config');
  const category = await findCategory(req.params.id);
  const rows = sortByUrgency(
    await findDocumentsWithStatus({
      match: { category: category._id },
      warningDays: expiryWarningDays,
    }),
  );
  res.render('categories/show', {
    title: category.name,
    category,
    rows,
    summary: summarize(rows),
  });
}

function newForm(req, res) {
  const scope = isScope(req.query.scope) ? req.query.scope : DEFAULT_SCOPE;
  res.render('categories/form', {
    title: 'Add category',
    category: null,
    values: { name: '', scope, description: '' },
    errors: {},
  });
}

async function handleCreate(req, res) {
  const category = new Category();
  const values = readForm(req);
  const errors = await applyForm(req, category, values);
  if (Object.keys(errors).length === 0) {
    req.flash('success', `Added the category ${category.name}.`);
    return res.redirect(category.url);
  }
  res
    .status(422)
    .render('categories/form', { title: 'Add category', category: null, values, errors });
}

async function editForm(req, res) {
  const category = await findCategory(req.params.id);
  res.render('categories/form', {
    title: `Edit ${category.name}`,
    category,
    values: formValues(category),
    errors: {},
  });
}

async function handleUpdate(req, res) {
  const category = await findCategory(req.params.id);
  // The page header and links keep showing the saved name while the form has errors.
  const saved = { _id: category._id, name: category.name, url: category.url };
  const values = readForm(req);
  const errors = await applyForm(req, category, values);
  if (Object.keys(errors).length === 0) {
    req.flash('success', `Saved the changes to ${category.name}.`);
    return res.redirect(category.url);
  }
  res.status(422).render('categories/form', {
    title: `Edit ${saved.name}`,
    category: saved,
    values,
    errors,
  });
}

function refuseInUse(req, res, category, documents) {
  req.flash(
    'error',
    `${category.name} is used by ${plural(documents, 'document')}. Delete those documents first.`,
  );
  res.redirect(category.url);
}

async function destroy(req, res) {
  const category = await findCategory(req.params.id);
  const documents = await Document.countDocuments({ category: category._id });
  if (documents > 0) return refuseInUse(req, res, category, documents);

  const deleted = await Category.findOneAndDelete({ _id: category._id }).lean();
  // A document added between the check and the delete would point at a missing category: put the
  // category back exactly as it was stored and refuse.
  const addedMeanwhile = await Document.countDocuments({ category: category._id });
  if (addedMeanwhile > 0) {
    if (deleted) await Category.collection.insertOne(deleted);
    return refuseInUse(req, res, category, addedMeanwhile);
  }
  req.flash('success', `Deleted the category ${category.name}.`);
  res.redirect('/categories');
}

module.exports = {
  list,
  show,
  newForm,
  create: [...categoryRules, handleCreate],
  editForm,
  update: [...categoryRules, handleUpdate],
  destroy,
};
