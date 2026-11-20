const { validationResult } = require('express-validator');

const Category = require('../models/category');
const Document = require('../models/document');
const DocumentInstance = require('../models/documentInstance');
const { deleteDocuments } = require('../services/cascade');
const { matchesAllWords } = require('../lib/text');
const { findDocumentsWithStatus, sortByUrgency, summarize } = require('../services/documents');
const { buildUrl, paginate, parsePage } = require('../services/pagination');
const {
  documentNotFound,
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
} = require('../services/records');
const { STATUS_META, daysUntil } = require('../services/status');

const PER_PAGE = 50;
const MAX_SEARCH_LENGTH = 100;
const STATUSES = Object.keys(STATUS_META).sort((a, b) => STATUS_META[a].rank - STATUS_META[b].rank);

/** Valid filters from the query string; anything malformed is left out. */
function parseFilters(query) {
  const filters = {};
  const owner = textField(query.owner).trim();
  if (isIdString(owner)) filters.owner = owner;
  const category = textField(query.category).trim();
  if (isIdString(category)) filters.category = category;
  const scope = textField(query.scope).trim();
  if (Object.hasOwn(Category.SCOPES, scope)) filters.scope = scope;
  const status = textField(query.status).trim();
  if (Object.hasOwn(STATUS_META, status)) filters.status = status;
  const q = textField(query.q).trim();
  if (q && q.length <= MAX_SEARCH_LENGTH) filters.q = q;
  return filters;
}

async function buildMatch(filters) {
  const match = {};
  if (filters.owner) match.owner = filters.owner;
  if (filters.scope) {
    const scoped = await Category.find({ scope: filters.scope }).distinct('_id');
    const ids = filters.category ? scoped.filter((id) => id.equals(filters.category)) : scoped;
    match.category = { $in: ids };
  } else if (filters.category) {
    match.category = filters.category;
  }
  return match;
}

/** Keeps the rows whose category and owner names contain every word of `q`. */
function searchRows(rows, q) {
  return rows.filter(({ document }) =>
    matchesAllWords(q, [
      document.category?.name,
      document.owner?.first_name,
      document.owner?.last_name,
    ]),
  );
}

async function index(req, res) {
  const { expiryWarningDays: warningDays } = req.app.get('config');
  const filters = parseFilters(req.query);
  const [owners, categories, match] = await Promise.all([
    listOwners(),
    listCategories(),
    buildMatch(filters),
  ]);

  let rows = await findDocumentsWithStatus({ match, warningDays });
  if (filters.q) rows = searchRows(rows, filters.q);
  const counts = summarize(rows);
  if (filters.status) rows = rows.filter((row) => row.status === filters.status);
  rows = sortByUrgency(rows);

  const listUrl = (params) => buildUrl('/documents', { ...filters, ...params });
  const pagination = paginate({
    total: rows.length,
    page: parsePage(req.query.page),
    perPage: PER_PAGE,
    url: (page) => listUrl({ page: page > 1 ? page : undefined }),
  });
  const statusLinks = [
    { status: null, label: 'All', count: counts.total },
    ...STATUSES.map((status) => ({
      status,
      label: STATUS_META[status].label,
      count: counts[status],
    })),
  ].map((link) => ({
    ...link,
    url: listUrl({ status: link.status ?? undefined }),
    active: (filters.status ?? null) === link.status,
  }));
  const hasFilters = Object.keys(filters).length > 0;

  res.render('documents/index', {
    title: 'Documents',
    rows: rows.slice(pagination.offset, pagination.offset + PER_PAGE),
    pagination,
    statusLinks,
    statusOptions: STATUSES.map((status) => ({ value: status, label: STATUS_META[status].label })),
    owners,
    categories,
    values: filters,
    hasFilters,
    hasDocuments: counts.total > 0 || (hasFilters && Boolean(await Document.exists({}))),
  });
}

async function renderNewForm(res, { values, errors = {} }) {
  const [owners, categories] = await Promise.all([listOwners(), listCategories()]);
  res.render('documents/new', { title: 'Add document', owners, categories, values, errors });
}

async function newForm(req, res) {
  const preselect = (value) => (isIdString(value) ? value : '');
  await renderNewForm(res, {
    values: { owner: preselect(req.query.owner), category: preselect(req.query.category) },
  });
}

async function handleCreate(req, res) {
  const form = req.body ?? {};
  const values = {
    owner: textField(form.owner).trim(),
    category: textField(form.category).trim(),
    notes: textField(form.notes),
  };
  const errors = validationResult(req).mapped();
  const { owner, category } = await loadOwnerAndCategory(values, errors);
  if (Object.keys(errors).length > 0) {
    return renderNewForm(res.status(422), { values, errors });
  }

  let result;
  try {
    result = await findOrCreateDocument(owner, category, { notes: values.notes });
  } catch (error) {
    if (error.name !== 'ValidationError') throw error;
    return renderNewForm(res.status(422), { values, errors: mapValidationError(error) });
  }
  const { document, created } = result;
  if (created) {
    // The owner or the category may have been deleted while the document was being created.
    await loadOwnerAndCategory(values, errors);
    if (Object.keys(errors).length > 0) {
      const { uploads } = req.app.get('config');
      await deleteDocuments({ _id: document._id }, { uploadDir: uploads.dir });
      return renderNewForm(res.status(422), { values, errors });
    }
    req.flash('success', `Document “${document.title}” added. Upload its first version next.`);
  } else {
    req.flash('info', `“${document.title}” already exists, so no new document was added.`);
  }
  res.redirect(document.url);
}

async function show(req, res) {
  const { expiryWarningDays: warningDays } = req.app.get('config');
  const { id } = req.params;
  if (!isIdString(id)) throw documentNotFound();
  const now = new Date();
  const [[row], versions] = await Promise.all([
    findDocumentsWithStatus({ match: { _id: id }, now, warningDays }),
    // Same order as the "current version" chosen by findDocumentsWithStatus().
    DocumentInstance.find({ document: id }).sort({ expires_at: -1, _id: -1 }),
  ]);
  if (!row) throw documentNotFound();
  res.render('documents/show', {
    title: row.document.title,
    document: row.document,
    status: row.status,
    daysUntil: row.daysUntil,
    versions: versions.map((version) => ({
      version,
      daysUntil: daysUntil(version.expires_at, now),
    })),
  });
}

async function edit(req, res) {
  const document = await loadDocument(req.params.id);
  res.render('documents/edit', {
    title: 'Edit notes',
    document,
    values: { notes: document.notes ?? '' },
    errors: {},
  });
}

async function handleUpdate(req, res) {
  const document = await loadDocument(req.params.id);
  const values = { notes: textField(req.body?.notes) };
  let errors = validationResult(req).mapped();
  if (Object.keys(errors).length === 0) {
    document.notes = values.notes || undefined;
    try {
      await document.save();
    } catch (error) {
      if (error.name !== 'ValidationError') throw error;
      errors = mapValidationError(error);
    }
  }
  if (Object.keys(errors).length > 0) {
    return res.status(422).render('documents/edit', {
      title: 'Edit notes',
      document,
      values,
      errors,
    });
  }
  req.flash('success', 'The notes were saved.');
  res.redirect(document.url);
}

async function destroy(req, res) {
  const { uploads } = req.app.get('config');
  const document = await loadDocument(req.params.id);
  const { versions, files } = await deleteDocuments(
    { _id: document._id },
    { uploadDir: uploads.dir },
  );
  const details =
    versions > 0
      ? ` together with ${plural(versions, 'version')} and ${plural(files, 'uploaded file')}`
      : '';
  req.flash('success', `“${document.title}” was deleted${details}.`);
  res.redirect('/documents');
}

module.exports = {
  index,
  newForm,
  create: [notesRule(), handleCreate],
  show,
  edit,
  update: [notesRule(), handleUpdate],
  destroy,
};
