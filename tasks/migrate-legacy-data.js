#!/usr/bin/env node
/**
 * Upgrades a database created by DocDateTrack 0.x to the 1.0 data model. Idempotent: running it
 * again only touches records that still have legacy fields.
 *
 *   npm run db:migrate              apply the migration
 *   npm run db:migrate -- --dry-run show what would change without writing anything
 *   npm run db:migrate -- --help    show the usage
 */
const fs = require('node:fs/promises');
const path = require('node:path');
const mongoose = require('mongoose');

const { loadConfig } = require('../config');
const Category = require('../models/category');
const Document = require('../models/document');
const DocumentInstance = require('../models/documentInstance');
const Owner = require('../models/owner');
const User = require('../models/user');
const { toDateOnlyUtc } = require('../services/status');

const LEGACY_OWNER_FIELDS = ['username', 'hash', 'salt', 'attempts', 'last'];
const LEGACY_OWNER_INDEXES = ['username_1', 'email_1'];
const RELATION_TO_SCOPE = { DP: 'personal', DF: 'company', DPF: 'employee' };
const MIME_TYPES = {
  '.pdf': 'application/pdf',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
  '.heic': 'image/heic',
  '.txt': 'text/plain',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};
const BATCH_SIZE = 500;
const MODELS = [User, Owner, Category, Document, DocumentInstance];

function createSummary(dryRun) {
  return {
    dryRun,
    users: { created: [], skipped: [], conflicts: [], invalid: [] },
    owners: { cleaned: 0, droppedIndexes: [] },
    categories: { converted: 0, scopes: { personal: 0, company: 0, employee: 0 } },
    documents: { cleaned: 0, dangling: [] },
    versions: {
      converted: 0,
      filesLinked: 0,
      missingFiles: [],
      unsafeFiles: [],
      withoutExpiry: [],
      issueDatesDropped: 0,
      orphans: [],
    },
    warnings: [],
    errors: [],
  };
}

function unsetFields(fields) {
  return Object.fromEntries(fields.map((field) => [field, '']));
}

function buildUpdate(set, unset) {
  const update = {};
  if (Object.keys(set).length > 0) update.$set = set;
  if (Object.keys(unset).length > 0) update.$unset = unset;
  return update;
}

async function bulkUpdate(collection, operations) {
  for (let start = 0; start < operations.length; start += BATCH_SIZE) {
    await collection.bulkWrite(operations.slice(start, start + BATCH_SIZE), { ordered: false });
  }
}

function toDate(value) {
  if (value instanceof Date) return value;
  if (typeof value === 'string' || typeof value === 'number') return new Date(value);
  return null;
}

function isBareFileName(name) {
  return !/[/\\\0]/.test(name) && name !== '.' && name !== '..' && path.basename(name) === name;
}

function cleanUsername(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '.')
    .replace(/^\.+|\.+$/g, '')
    .slice(0, 50);
}

/** Legacy usernames were free text; map them onto the new pattern (fall back to the email). */
function normalizeUsername(username, email) {
  const fromUsername = cleanUsername(username);
  if (fromUsername.length >= 3) return fromUsername;
  const fromEmail = cleanUsername(email.split('@')[0]);
  return fromEmail.length >= 3 ? fromEmail : fromUsername;
}

function firstValidationMessage(error) {
  const [first] = Object.values(error.errors ?? {});
  return first?.message ?? error.message;
}

async function fileSize(uploadDir, name) {
  try {
    const stats = await fs.stat(path.join(uploadDir, name));
    return stats.isFile() ? stats.size : null;
  } catch {
    return null;
  }
}

async function collectionIndexes(collection) {
  try {
    return await collection.indexes();
  } catch (error) {
    if (error.codeName === 'NamespaceNotFound' || error.code === 26) return [];
    throw error;
  }
}

async function migrateAccounts({ dryRun, summary }) {
  // The legacy unique indexes are not sparse: once credentials are unset, every owner without a
  // username (or email) would collide on `null`. Drop them before touching any owner.
  const indexNames = (await collectionIndexes(Owner.collection)).map((index) => index.name);
  for (const name of LEGACY_OWNER_INDEXES.filter((legacy) => indexNames.includes(legacy))) {
    if (!dryRun) await Owner.collection.dropIndex(name);
    summary.owners.droppedIndexes.push(name);
  }

  const legacyOwners = await Owner.collection
    .find({ $or: LEGACY_OWNER_FIELDS.map((field) => ({ [field]: { $exists: true } })) })
    .sort({ _id: 1 })
    .toArray();
  let adminExists = Boolean(await User.exists({ role: 'admin' }));
  const plannedUsernames = new Set();
  const plannedEmails = new Set();
  const cleanedOwnerIds = [];

  for (const owner of legacyOwners) {
    const label = String(owner.username ?? owner._id);
    if (!owner.username || !owner.hash || !owner.salt) {
      summary.users.skipped.push({ username: label, reason: 'no username or password stored' });
      cleanedOwnerIds.push(owner._id);
      continue;
    }

    const email = typeof owner.email === 'string' ? owner.email.trim().toLowerCase() : '';
    const username = normalizeUsername(owner.username, email);
    const existing = await User.findOne({
      $or: [{ username }, ...(email ? [{ email }] : [])],
    }).lean();
    if (existing || plannedUsernames.has(username) || (email && plannedEmails.has(email))) {
      if ((existing && existing.email === email) || plannedEmails.has(email)) {
        summary.users.skipped.push({ username: label, reason: 'an account already exists' });
        cleanedOwnerIds.push(owner._id);
      } else {
        summary.users.conflicts.push({
          username: label,
          reason: `the username "${username}" belongs to another account; rename one and re-run`,
        });
      }
      continue;
    }

    const role = adminExists ? 'member' : 'admin';
    const displayName = [owner.first_name, owner.last_name].filter(Boolean).join(' ').slice(0, 100);
    const user = new User({
      username,
      email,
      display_name: displayName || undefined,
      role,
      hash: owner.hash,
      salt: owner.salt,
    });
    try {
      await user.validate();
    } catch (error) {
      summary.users.invalid.push({ username: label, reason: firstValidationMessage(error) });
      continue;
    }
    if (!dryRun) await user.save();

    adminExists = true;
    plannedUsernames.add(username);
    plannedEmails.add(email);
    cleanedOwnerIds.push(owner._id);
    summary.users.created.push({
      username,
      role,
      ...(username === owner.username ? {} : { renamedFrom: owner.username }),
    });
  }

  if (!dryRun && cleanedOwnerIds.length > 0) {
    await Owner.collection.updateMany(
      { _id: { $in: cleanedOwnerIds } },
      { $unset: unsetFields(LEGACY_OWNER_FIELDS) },
    );
  }
  summary.owners.cleaned = cleanedOwnerIds.length;
}

async function migrateCategories({ dryRun, summary }) {
  const legacyCategories = await Category.collection
    .find({ $or: [{ relation: { $exists: true } }, { scope: { $exists: false } }] })
    .toArray();
  const operations = legacyCategories.map((category) => {
    const set = {};
    if (!category.scope) {
      if (category.relation !== undefined && !RELATION_TO_SCOPE[category.relation]) {
        summary.warnings.push(
          `Category "${category.name}" had an unknown relation "${category.relation}"; scope set to personal.`,
        );
      }
      set.scope = RELATION_TO_SCOPE[category.relation] ?? 'personal';
      summary.categories.scopes[set.scope] += 1;
    }
    const unset = 'relation' in category ? { relation: '' } : {};
    return { updateOne: { filter: { _id: category._id }, update: buildUpdate(set, unset) } };
  });
  summary.categories.converted = operations.length;
  if (!dryRun) await bulkUpdate(Category.collection, operations);

  const duplicates = await Category.collection
    .aggregate([
      { $group: { _id: '$name', count: { $sum: 1 } } },
      { $match: { count: { $gt: 1 } } },
    ])
    .toArray();
  for (const duplicate of duplicates) {
    summary.warnings.push(
      `${duplicate.count} categories are named "${duplicate._id}"; category names must be unique.`,
    );
  }
}

async function migrateDocuments({ dryRun, summary }) {
  const legacyFilter = { status: { $exists: true } };
  summary.documents.cleaned = await Document.collection.countDocuments(legacyFilter);
  if (!dryRun && summary.documents.cleaned > 0) {
    await Document.collection.updateMany(legacyFilter, { $unset: { status: '' } });
  }

  const dangling = await Document.collection
    .aggregate([
      {
        $lookup: { from: Owner.collection.name, localField: 'owner', foreignField: '_id', as: 'o' },
      },
      {
        $lookup: {
          from: Category.collection.name,
          localField: 'category',
          foreignField: '_id',
          as: 'c',
        },
      },
      { $match: { $or: [{ o: { $size: 0 } }, { c: { $size: 0 } }] } },
      { $project: { _id: 1 } },
    ])
    .toArray();
  summary.documents.dangling = dangling.map((document) => String(document._id));

  const duplicates = await Document.collection
    .aggregate([
      { $group: { _id: { owner: '$owner', category: '$category' }, count: { $sum: 1 } } },
      { $match: { count: { $gt: 1 } } },
    ])
    .toArray();
  for (const duplicate of duplicates) {
    summary.warnings.push(
      `${duplicate.count} documents share owner ${duplicate._id.owner} and category ` +
        `${duplicate._id.category}; merge them so each pair is unique.`,
    );
  }
}

async function migrateVersion(version, { uploadDir, summary }) {
  const id = String(version._id);
  const set = {};
  const unset = {};

  if ('expire_date_raw' in version) {
    unset.expire_date_raw = '';
    if (!version.expires_at) {
      const expiresAt = toDateOnlyUtc(toDate(version.expire_date_raw));
      if (expiresAt) set.expires_at = expiresAt;
    }
  }
  if ('update_date_raw' in version) {
    unset.update_date_raw = '';
    if (!version.issued_at) {
      const issuedAt = toDateOnlyUtc(toDate(version.update_date_raw));
      if (issuedAt) set.issued_at = issuedAt;
    }
  }
  const expiresAt = set.expires_at ?? version.expires_at;
  if (!expiresAt) summary.versions.withoutExpiry.push(id);
  // Legacy versions defaulted the update date to the upload time, which can be after expiry.
  if (set.issued_at && expiresAt && set.issued_at > expiresAt) {
    delete set.issued_at;
    summary.versions.issueDatesDropped += 1;
  }

  if ('document_file' in version) {
    unset.document_file = '';
    const name = version.document_file;
    if (!version.file && typeof name === 'string' && name !== '') {
      if (isBareFileName(name)) {
        const file = {
          stored_name: name,
          original_name: name,
          mime_type: MIME_TYPES[path.extname(name).toLowerCase()] ?? 'application/octet-stream',
        };
        const size = await fileSize(uploadDir, name);
        if (size === null) summary.versions.missingFiles.push({ id, name });
        else file.size = size;
        set.file = file;
        summary.versions.filesLinked += 1;
      } else {
        summary.versions.unsafeFiles.push({ id, name });
      }
    }
  }

  return { updateOne: { filter: { _id: version._id }, update: buildUpdate(set, unset) } };
}

async function migrateVersions({ dryRun, uploadDir, summary }) {
  const legacyFilter = {
    $or: ['expire_date_raw', 'update_date_raw', 'document_file'].map((field) => ({
      [field]: { $exists: true },
    })),
  };
  const operations = [];
  for await (const version of DocumentInstance.collection.find(legacyFilter)) {
    operations.push(await migrateVersion(version, { uploadDir, summary }));
  }
  summary.versions.converted = operations.length;
  if (!dryRun) await bulkUpdate(DocumentInstance.collection, operations);

  const orphans = await DocumentInstance.collection
    .aggregate([
      {
        $lookup: {
          from: Document.collection.name,
          localField: 'document',
          foreignField: '_id',
          as: 'd',
        },
      },
      { $match: { d: { $size: 0 } } },
      { $project: { _id: 1 } },
    ])
    .toArray();
  summary.versions.orphans = orphans.map((version) => String(version._id));
}

async function buildIndexes({ summary }) {
  for (const model of MODELS) {
    try {
      await model.createIndexes();
    } catch (error) {
      summary.errors.push(`Could not build the indexes of ${model.modelName}: ${error.message}`);
    }
  }
}

/**
 * Migrates legacy (0.x) data on the current mongoose connection and returns a summary.
 * With `dryRun`, nothing is written.
 */
async function migrateLegacyData({ dryRun = false, uploadDir }) {
  const summary = createSummary(dryRun);
  await migrateAccounts({ dryRun, summary });
  await migrateCategories({ dryRun, summary });
  await migrateDocuments({ dryRun, summary });
  await migrateVersions({ dryRun, uploadDir, summary });
  if (!dryRun) await buildIndexes({ summary });
  return summary;
}

/** "1 file", "2 files" — `plural` defaults to `singular` + "s". */
function count(number, singular, plural = `${singular}s`) {
  return `${number} ${number === 1 ? singular : plural}`;
}

function formatList(items, describe) {
  return items.map((item) => `    - ${describe(item)}`).join('\n');
}

function formatSummary(summary) {
  const { users, owners, categories, documents, versions } = summary;
  const lines = [
    summary.dryRun
      ? 'Legacy data migration — DRY RUN: nothing was written, the counts show what would change.'
      : 'Legacy data migration finished.',
    `  Users:      ${users.created.length} created, ${users.skipped.length} skipped, ` +
      `${count(users.conflicts.length, 'conflict')}, ${users.invalid.length} invalid`,
  ];
  if (users.created.length > 0) {
    lines.push(
      formatList(
        users.created,
        (user) =>
          `${user.username} (${user.role})` +
          (user.renamedFrom ? ` — renamed from "${user.renamedFrom}"` : ''),
      ),
    );
  }
  for (const [key, title] of [
    ['skipped', 'Skipped'],
    ['conflicts', 'Conflicts'],
    ['invalid', 'Invalid'],
  ]) {
    if (users[key].length > 0) {
      lines.push(
        `  ${title} accounts:`,
        formatList(users[key], (u) => `${u.username}: ${u.reason}`),
      );
    }
  }
  lines.push(
    `  Owners:     ${owners.cleaned} cleaned (login fields removed)` +
      (owners.droppedIndexes.length > 0
        ? `, dropped indexes ${owners.droppedIndexes.join(', ')}`
        : ''),
    `  Categories: ${categories.converted} converted (personal ${categories.scopes.personal}, ` +
      `company ${categories.scopes.company}, employee ${categories.scopes.employee})`,
    `  Documents:  ${documents.cleaned} cleaned (status removed), ` +
      `${documents.dangling.length} with a missing owner or category`,
    `  Versions:   ${versions.converted} converted, ${count(versions.filesLinked, 'file')} linked, ` +
      `${count(versions.missingFiles.length, 'file')} not found in UPLOAD_DIR, ` +
      `${count(versions.issueDatesDropped, 'issue date')} after expiry dropped, ` +
      `${count(versions.orphans.length, 'orphan')}`,
  );
  if (versions.missingFiles.length > 0) {
    lines.push(
      '  Missing files:',
      formatList(versions.missingFiles, (f) => `${f.name} (${f.id})`),
    );
  }
  if (versions.unsafeFiles.length > 0) {
    lines.push(
      '  File names containing paths (not linked):',
      formatList(versions.unsafeFiles, (f) => `${f.name} (${f.id})`),
    );
  }
  if (versions.withoutExpiry.length > 0) {
    lines.push(
      '  Versions without a valid expiry date:',
      formatList(versions.withoutExpiry, String),
    );
  }
  if (versions.orphans.length > 0) {
    lines.push('  Versions whose document no longer exists:', formatList(versions.orphans, String));
  }
  if (documents.dangling.length > 0) {
    lines.push(
      '  Documents with a missing owner or category:',
      formatList(documents.dangling, String),
    );
  }
  if (summary.warnings.length > 0) lines.push('  Warnings:', formatList(summary.warnings, String));
  if (summary.errors.length > 0) lines.push('  Errors:', formatList(summary.errors, String));
  return lines.join('\n');
}

const USAGE = `Usage: npm run db:migrate -- [options]

Upgrades a database created by the DocDateTrack 0.x prototype to the 1.0 data model: login
accounts move from owners to users, category relations become scopes, version fields are renamed
and file names become file information. Running it again only touches records that still have
legacy fields. Back up the database (and UPLOAD_DIR) first.

Options:
  --dry-run   Show what would change without writing anything
  -h, --help  Show this help`;

async function main(args) {
  if (args.includes('--help') || args.includes('-h')) {
    console.info(USAGE);
    return;
  }
  const unknown = args.filter((arg) => arg !== '--dry-run');
  if (unknown.length > 0) {
    throw new Error(`Unknown argument(s): ${unknown.join(' ')}. Run with --help for usage.`);
  }
  const config = loadConfig(process.env, { requireSessionSecret: false });
  await mongoose.connect(config.mongodbUri, {
    autoCreate: false,
    autoIndex: false,
    serverSelectionTimeoutMS: 10_000,
  });
  try {
    const summary = await migrateLegacyData({
      dryRun: args.includes('--dry-run'),
      uploadDir: config.uploads.dir,
    });
    console.info(formatSummary(summary));
    if (summary.errors.length > 0) process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`Migration failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { migrateLegacyData, formatSummary };
