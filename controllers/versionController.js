const fs = require('node:fs/promises');
const { body, validationResult } = require('express-validator');
const createError = require('http-errors');

const Document = require('../models/document');
const DocumentInstance = require('../models/documentInstance');
const { deleteDocuments, deleteVersions } = require('../services/cascade');
const { buildUrl, paginate, parsePage } = require('../services/pagination');
const {
  fieldError,
  findDocument,
  findOrCreateDocument,
  isIdString,
  listCategories,
  listOwners,
  loadOwnerAndCategory,
  mapValidationError,
  notesRule,
  textField,
} = require('../services/records');
const { daysUntil, toDateOnlyUtc } = require('../services/status');
const { removeStoredFile, storedFilePath } = require('../services/storage');
const {
  UPLOAD_ACCEPT,
  downloadDetails,
  formatMegabytes,
  uploadHelp,
  uploadedFile,
} = require('../services/uploads');

const PER_PAGE = 50;
const MIN_YEAR = 1900;
const MAX_YEAR = 2200;
const CONFLICT_MESSAGE = 'This version was changed by someone else; reload and try again.';
// Errors of a versioned save whose version was changed or deleted since it was loaded.
const STALE_SAVE_ERRORS = new Set(['VersionError', 'DocumentNotFoundError']);

/** A `YYYY-MM-DD` form value as a UTC-midnight Date, or null when invalid or out of range. */
function parseFormDate(value) {
  const date = toDateOnlyUtc(textField(value));
  if (!date) return null;
  const year = date.getUTCFullYear();
  return year >= MIN_YEAR && year <= MAX_YEAR ? date : null;
}

function dateRule(field, label, { required = false } = {}) {
  const chain = required
    ? body(field).exists({ values: 'falsy' }).withMessage(`Enter the ${label}.`).bail()
    : body(field).optional({ values: 'falsy' });
  return chain
    .isString()
    .withMessage(`Enter a valid ${label}.`)
    .bail()
    .trim()
    .custom((value) => toDateOnlyUtc(value) !== null)
    .withMessage(`Enter a valid ${label}.`)
    .bail()
    .custom((value) => parseFormDate(value) !== null)
    .withMessage(`The ${label} must be between ${MIN_YEAR} and ${MAX_YEAR}.`);
}

const versionRules = [
  dateRule('issued_at', 'issue date'),
  dateRule('expires_at', 'expiry date', { required: true })
    .bail()
    .custom((value, { req }) => {
      const issuedAt = parseFormDate(req.body?.issued_at);
      return !issuedAt || parseFormDate(value) >= issuedAt;
    })
    .withMessage('The expiry date cannot be before the issue date.'),
  notesRule(),
  uploadedFile('file'),
];

function versionValues(form = {}) {
  return {
    document: textField(form.document).trim(),
    owner: textField(form.owner).trim(),
    category: textField(form.category).trim(),
    issued_at: textField(form.issued_at).trim(),
    expires_at: textField(form.expires_at).trim(),
    notes: textField(form.notes),
    remove_file: form.remove_file === '1',
  };
}

function versionUrl(version) {
  return `/documents/${version.document}#version-${version._id}`;
}

/** Locals of the file field: accepted types, size limit and whether to ask for the file again. */
function uploadLocals(req) {
  const { maxBytes } = req.app.get('config').uploads;
  return {
    accept: UPLOAD_ACCEPT,
    help: uploadHelp(maxBytes),
    maxBytes,
    sizeError: `The file is larger than ${formatMegabytes(maxBytes)} MB.`,
    chooseAgain: Boolean(req.upload?.file),
  };
}

function versionNotFound() {
  return createError(404, 'This version does not exist or has been deleted.');
}

async function loadVersion(id) {
  const version = isIdString(id) ? await DocumentInstance.findById(id) : null;
  if (!version) throw versionNotFound();
  return version;
}

async function removeReplacedFile(uploadDir, storedName) {
  try {
    await removeStoredFile(uploadDir, storedName);
  } catch (error) {
    console.warn(`Unable to delete the replaced file ${storedName}: ${error.message}`);
  }
}

async function index(req, res) {
  const total = await DocumentInstance.countDocuments();
  const pagination = paginate({
    total,
    page: parsePage(req.query.page),
    perPage: PER_PAGE,
    url: (page) => buildUrl('/versions', { page: page > 1 ? page : undefined }),
  });
  const versions = await DocumentInstance.find()
    .sort({ createdAt: -1, _id: -1 })
    .skip(pagination.offset)
    .limit(PER_PAGE)
    .populate({ path: 'document', populate: [{ path: 'owner' }, { path: 'category' }] });
  const now = new Date();
  res.render('versions/index', {
    title: 'Versions',
    rows: versions.map((version) => ({ version, daysUntil: daysUntil(version.expires_at, now) })),
    pagination,
  });
}

async function show(req, res) {
  const version = await loadVersion(req.params.id);
  res.redirect(versionUrl(version));
}

async function renderNewForm(req, res, { targetDocument = null, values, errors = {} }) {
  const [owners, categories] = targetDocument
    ? [[], []]
    : await Promise.all([listOwners(), listCategories()]);
  res.render('versions/new', {
    title: 'Upload version',
    targetDocument,
    owners,
    categories,
    values,
    errors,
    upload: uploadLocals(req),
  });
}

async function newForm(req, res) {
  const targetDocument = await findDocument(textField(req.query.document).trim());
  const preselect = (value) => (isIdString(value) ? value : '');
  await renderNewForm(req, res, {
    targetDocument,
    values: {
      document: targetDocument ? String(targetDocument._id) : '',
      owner: preselect(req.query.owner),
      category: preselect(req.query.category),
    },
  });
}

/**
 * Returns the document a new version belongs to, creating it for a new owner × category pair.
 * Adds field errors (and returns null) when the owner or the category was deleted meanwhile.
 */
async function resolveDocument(req, { targetDocument, pair, values, errors }) {
  if (targetDocument) return { document: targetDocument, created: false };
  const { document, created } = await findOrCreateDocument(pair.owner, pair.category);
  if (created) {
    // The owner or the category may have been deleted while the document was being created.
    await loadOwnerAndCategory(values, errors);
    if (Object.keys(errors).length > 0) {
      const { uploads } = req.app.get('config');
      await deleteDocuments({ _id: document._id }, { uploadDir: uploads.dir });
      return null;
    }
  }
  return { document, created };
}

async function handleCreate(req, res) {
  const { uploads } = req.app.get('config');
  const values = versionValues(req.body);
  let errors = validationResult(req).mapped();
  let targetDocument = null;
  let pair = null;
  if (values.document) {
    targetDocument = await findDocument(values.document);
    if (!targetDocument) {
      errors.document = fieldError(
        'document',
        'This document no longer exists. Choose an owner and a category instead.',
      );
      values.document = '';
    }
  } else {
    pair = await loadOwnerAndCategory(values, errors);
  }

  const resolved =
    Object.keys(errors).length === 0
      ? await resolveDocument(req, { targetDocument, pair, values, errors })
      : null;
  if (resolved) {
    const { document, created } = resolved;
    try {
      const version = await req.upload.commit(async () => {
        const saved = new DocumentInstance({
          document: document._id,
          issued_at: parseFormDate(values.issued_at) ?? undefined,
          expires_at: parseFormDate(values.expires_at),
          notes: values.notes || undefined,
          file: req.upload.file ?? undefined,
        });
        await saved.save();
        // The document may have been deleted while the version was being saved: undo, and let
        // the failed commit discard the uploaded file.
        if (!(await Document.exists({ _id: document._id }))) {
          await deleteVersions({ _id: saved._id }, { uploadDir: uploads.dir });
          throw createError(404, 'The document was deleted while the version was being saved.');
        }
        return saved;
      });
      req.flash(
        'success',
        created
          ? `Version saved. The document “${document.title}” was created for it.`
          : `Version of “${document.title}” saved.`,
      );
      return res.redirect(`${document.url}#version-${version._id}`);
    } catch (error) {
      if (error.name !== 'ValidationError') throw error;
      errors = mapValidationError(error);
    }
  }
  await renderNewForm(req, res.status(422), { targetDocument, values, errors });
}

async function renderEditForm(req, res, { version, values, errors = {}, formError = null }) {
  res.render('versions/edit', {
    title: 'Edit version',
    version,
    document: await findDocument(String(version.document)),
    values,
    errors,
    formError,
    upload: uploadLocals(req),
  });
}

async function edit(req, res) {
  const version = await loadVersion(req.params.id);
  await renderEditForm(req, res, {
    version,
    values: {
      issued_at: version.issued_at,
      expires_at: version.expires_at,
      notes: version.notes ?? '',
    },
  });
}

async function handleUpdate(req, res) {
  const { uploads } = req.app.get('config');
  let version = await loadVersion(req.params.id);
  const values = versionValues(req.body);
  let errors = validationResult(req).mapped();
  let formError = null;

  if (Object.keys(errors).length === 0) {
    const previousFile = version.file?.stored_name ?? null;
    version.issued_at = parseFormDate(values.issued_at) ?? undefined;
    version.expires_at = parseFormDate(values.expires_at);
    version.notes = values.notes || undefined;
    if (req.upload.file) version.file = req.upload.file;
    else if (values.remove_file) version.file = undefined;
    // Optimistic concurrency: the save fails when another request saved this version since it
    // was loaded, so two edits never both replace (and lose track of) the same file.
    version.increment();
    try {
      await req.upload.commit(() => version.save());
      const currentFile = version.file?.stored_name ?? null;
      // Only now that the version points at the new file (or none) may the old one go.
      if (previousFile && previousFile !== currentFile) {
        await removeReplacedFile(uploads.dir, previousFile);
      }
      req.flash('success', 'The version was updated.');
      return res.redirect(versionUrl(version));
    } catch (error) {
      const stale = STALE_SAVE_ERRORS.has(error.name);
      if (!stale && error.name !== 'ValidationError') throw error;
      // Answers 404 when the version was deleted in the meantime.
      version = await loadVersion(req.params.id);
      if (stale) formError = CONFLICT_MESSAGE;
      else errors = mapValidationError(error);
    }
  }
  await renderEditForm(req, res.status(formError ? 409 : 422), {
    version,
    values,
    errors,
    formError,
  });
}

async function isFile(filePath) {
  try {
    return (await fs.stat(filePath)).isFile();
  } catch {
    return false;
  }
}

async function download(req, res, next) {
  const { uploads } = req.app.get('config');
  const version = await loadVersion(req.params.id);
  const { file } = version;
  if (!file?.stored_name) throw createError(404, 'This version has no uploaded file.');
  const filePath = storedFilePath(uploads.dir, file.stored_name);
  if (!filePath || !(await isFile(filePath))) {
    throw createError(404, 'The file of this version is missing.');
  }
  const { fileName, contentType } = downloadDetails(file);
  // `root` keeps send's dot-file check on the stored name only, not on the upload directory.
  res.download(
    file.stored_name,
    fileName,
    {
      root: uploads.dir,
      dotfiles: 'deny',
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    },
    (error) => {
      if (error && !res.headersSent) next(error);
    },
  );
}

async function destroy(req, res) {
  const { uploads } = req.app.get('config');
  const version = await loadVersion(req.params.id);
  const { files } = await deleteVersions({ _id: version._id }, { uploadDir: uploads.dir });
  req.flash(
    'success',
    files > 0 ? 'The version and its file were deleted.' : 'The version was deleted.',
  );
  const documentExists = await Document.exists({ _id: version.document });
  res.redirect(documentExists ? `/documents/${version.document}` : '/versions');
}

module.exports = {
  index,
  show,
  newForm,
  create: [...versionRules, handleCreate],
  edit,
  update: [...versionRules, handleUpdate],
  download,
  destroy,
};
