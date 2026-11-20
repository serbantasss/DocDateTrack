const { body } = require('express-validator');
const createError = require('http-errors');
const mongoose = require('mongoose');

const Category = require('../models/category');
const Document = require('../models/document');
const Owner = require('../models/owner');

const NOTES_MAX_LENGTH = 2000;
const NAME_COLLATION = { locale: 'en' };

/** True for a string holding a MongoDB ObjectId (24 hexadecimal characters). */
function isIdString(value) {
  return typeof value === 'string' && mongoose.isObjectIdOrHexString(value);
}

/** A form or query value as a string: '' for missing values, arrays and objects. */
function textField(value) {
  return typeof value === 'string' ? value : '';
}

/** A field error in the express-validator `.mapped()` shape. */
function fieldError(path, msg) {
  return { type: 'field', location: 'body', path, msg };
}

/** Converts a Mongoose ValidationError into `.mapped()` errors keyed by top-level field. */
function mapValidationError(error) {
  const errors = {};
  for (const [path, detail] of Object.entries(error.errors)) {
    const field = path.split('.')[0];
    errors[field] ??= fieldError(field, detail.message);
  }
  return errors;
}

/** express-validator rule for the optional notes of documents and versions. */
function notesRule(field = 'notes') {
  return (
    body(field)
      .optional()
      .isString()
      .withMessage('Enter the notes as text.')
      .bail()
      // Browsers submit line breaks as CRLF; count them as one character, like the textarea.
      .customSanitizer((value) => value.replace(/\r\n?/g, '\n').trim())
      .custom((value) => value.length <= NOTES_MAX_LENGTH)
      .withMessage(`The notes must be at most ${NOTES_MAX_LENGTH} characters long.`)
  );
}

function listOwners() {
  return Owner.find().sort({ last_name: 1, first_name: 1 }).collation(NAME_COLLATION);
}

function listCategories() {
  return Category.find().sort({ name: 1 }).collation(NAME_COLLATION);
}

async function findOwner(id) {
  return isIdString(id) ? Owner.findById(id) : null;
}

async function findCategory(id) {
  return isIdString(id) ? Category.findById(id) : null;
}

/**
 * Loads the owner and the category chosen in a form (`values.owner`, `values.category`) and adds
 * field errors to `errors` for the ones that are missing or no longer exist.
 */
async function loadOwnerAndCategory(values, errors) {
  const [owner, category] = await Promise.all([
    findOwner(values.owner),
    findCategory(values.category),
  ]);
  if (!owner) {
    errors.owner = fieldError(
      'owner',
      isIdString(values.owner)
        ? 'This owner no longer exists. Choose another one.'
        : 'Choose an owner.',
    );
  }
  if (!category) {
    errors.category = fieldError(
      'category',
      isIdString(values.category)
        ? 'This category no longer exists. Choose another one.'
        : 'Choose a category.',
    );
  }
  return { owner, category };
}

/** The 404 error for unknown or malformed document ids. */
function documentNotFound() {
  return createError(404, 'This document does not exist or has been deleted.');
}

/** The document with its owner and category populated, or null (also for malformed ids). */
async function findDocument(id) {
  if (!isIdString(id)) return null;
  return Document.findById(id).populate('owner').populate('category');
}

/** Like findDocument(), but answers 404 when the document does not exist. */
async function loadDocument(id) {
  const document = await findDocument(id);
  if (!document) throw documentNotFound();
  return document;
}

/**
 * Returns the document of `owner` × `category` (populated), creating it when the pair is new.
 * A concurrent request creating the same pair is caught by the unique index.
 */
async function findOrCreateDocument(owner, category, { notes } = {}) {
  const pair = { owner: owner._id, category: category._id };
  let document = await Document.findOne(pair);
  let created = false;
  if (!document) {
    try {
      document = await Document.create({ ...pair, notes: notes || undefined });
      created = true;
    } catch (error) {
      if (error?.code !== 11000) throw error;
      document = await Document.findOne(pair);
      if (!document) throw error;
    }
  }
  document.owner = owner;
  document.category = category;
  return { document, created };
}

function plural(count, singular, pluralForm = `${singular}s`) {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

module.exports = {
  documentNotFound,
  fieldError,
  findDocument,
  findOrCreateDocument,
  isIdString,
  listCategories,
  listOwners,
  loadDocument,
  loadOwnerAndCategory,
  mapValidationError,
  notesRule,
  plural,
  textField,
};
