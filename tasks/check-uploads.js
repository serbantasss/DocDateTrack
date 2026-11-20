#!/usr/bin/env node
/**
 * Compares UPLOAD_DIR with the versions in the database. See USAGE below or run
 * `npm run uploads:check -- --help`.
 */
const fs = require('node:fs/promises');
const path = require('node:path');
const { parseArgs } = require('node:util');
const mongoose = require('mongoose');

const { ConfigError, loadConfig } = require('../config');
const { fileSize } = require('../lib/format');
const DocumentInstance = require('../models/documentInstance');
const { removeStoredFile } = require('../services/storage');
const { isAppStoredName } = require('../services/uploads');

const MIN_ORPHAN_AGE_MS = 60 * 60 * 1000;

const USAGE = `Usage: npm run uploads:check -- [options]

Compares the upload directory (UPLOAD_DIR) with the database and reports
  - files that no version uses, and
  - versions whose file is missing from the upload directory.
Hidden files (names starting with a dot) are ignored.

Options:
  --delete-orphans  Delete the unused files that DocDateTrack created (named <uuid>.<ext>) and
                    that are older than 1 hour. Other files are only reported, never deleted.
  -h, --help        Show this help

Exit codes: 0 = no problems found, 1 = problems found (unused or missing files remain),
2 = the check failed (invalid arguments or settings, database or directory not reachable, or a
file could not be deleted).`;

const STATUS_TEXT = {
  deletable: 'can be deleted with --delete-orphans',
  deleted: 'deleted',
  recent: 'less than 1 hour old, possibly an upload in progress; kept',
  foreign: 'not named like a DocDateTrack upload; delete it by hand if it is not needed',
  other: 'not a regular file; left alone',
};

class UsageError extends Error {}

class UploadDirError extends Error {}

/** Returns `{ help: true }` or `{ deleteOrphans }`. */
function parseCliArgs(args) {
  try {
    const { values } = parseArgs({
      args,
      options: {
        'delete-orphans': { type: 'boolean' },
        help: { type: 'boolean', short: 'h' },
      },
      strict: true,
      allowPositionals: false,
    });
    return values.help ? { help: true } : { deleteOrphans: Boolean(values['delete-orphans']) };
  } catch (error) {
    throw new UsageError(error.message);
  }
}

async function readUploadDir(uploadDir) {
  try {
    const entries = await fs.readdir(uploadDir, { withFileTypes: true });
    return entries
      .filter((entry) => !entry.name.startsWith('.'))
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch (error) {
    throw new UploadDirError(`Unable to read UPLOAD_DIR ${uploadDir}: ${error.message}`, {
      cause: error,
    });
  }
}

/** Describes an unused directory entry; null when it disappeared in the meantime. */
async function inspectOrphan(uploadDir, entry, now) {
  if (!entry.isFile()) return { name: entry.name, status: 'other' };
  let stats;
  try {
    stats = await fs.lstat(path.join(uploadDir, entry.name));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  let status = 'deletable';
  if (!isAppStoredName(entry.name)) status = 'foreign';
  else if (now - stats.mtime < MIN_ORPHAN_AGE_MS) status = 'recent';
  return { name: entry.name, size: stats.size, modifiedAt: stats.mtime, status };
}

async function deleteOrphan(uploadDir, orphan) {
  // A version may have started to use the file since the versions were read.
  if (await DocumentInstance.exists({ 'file.stored_name': orphan.name })) return null;
  try {
    await removeStoredFile(uploadDir, orphan.name);
    return { ...orphan, status: 'deleted' };
  } catch (error) {
    return { ...orphan, status: 'failed', error: error.message };
  }
}

/**
 * Compares the upload directory with the versions on the open mongoose connection. With
 * `deleteOrphans`, deletes the unused files the app created (`<uuid>.<ext>`) that are older than
 * one hour. Returns `{ uploadDir, entries, versions, orphans, missing }`, where `orphans` lists
 * the unused entries with a status (deletable, deleted, failed, recent, foreign or other) and
 * `missing` the versions whose file does not exist.
 */
async function checkUploads({ uploadDir, deleteOrphans = false, now = new Date() }) {
  // Versions first: a file uploaded meanwhile then shows up as a recent orphan, never as missing.
  const versions = await DocumentInstance.find({ 'file.stored_name': { $exists: true } })
    .select('document file')
    .sort({ _id: 1 })
    .lean();
  const entries = await readUploadDir(uploadDir);
  const referenced = new Set(versions.map((version) => version.file.stored_name));
  const files = new Set(entries.filter((entry) => entry.isFile()).map((entry) => entry.name));

  const orphans = [];
  for (const entry of entries) {
    if (entry.isFile() && referenced.has(entry.name)) continue;
    let orphan = await inspectOrphan(uploadDir, entry, now);
    if (orphan && deleteOrphans && orphan.status === 'deletable') {
      orphan = await deleteOrphan(uploadDir, orphan);
    }
    if (orphan) orphans.push(orphan);
  }

  const missing = versions
    .filter((version) => !files.has(version.file.stored_name))
    .map((version) => ({
      versionId: String(version._id),
      documentId: String(version.document),
      storedName: version.file.stored_name,
      originalName: version.file.original_name ?? null,
    }));

  return { uploadDir, entries: entries.length, versions: versions.length, orphans, missing };
}

function plural(count, singular, pluralForm = `${singular}s`) {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

function formatTimestamp(date) {
  return `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

function describeOrphan(orphan) {
  const details =
    orphan.size === undefined
      ? ''
      : ` (${fileSize(orphan.size)}, modified ${formatTimestamp(orphan.modifiedAt)})`;
  const status =
    orphan.status === 'failed'
      ? `could not be deleted: ${orphan.error}`
      : STATUS_TEXT[orphan.status];
  return `  - ${orphan.name}${details}: ${status}`;
}

/** Human-readable report of checkUploads(). */
function formatReport(report) {
  const lines = [
    `Checked ${report.uploadDir}: ${plural(report.entries, 'entry', 'entries')}, ` +
      `${plural(report.versions, 'version')} with a file.`,
  ];
  if (report.orphans.length > 0) {
    lines.push('', `Not used by any version (${report.orphans.length}):`);
    lines.push(...report.orphans.map(describeOrphan));
  }
  if (report.missing.length > 0) {
    lines.push('', `Versions whose file is missing (${report.missing.length}):`);
    for (const item of report.missing) {
      const name = item.originalName ? `“${item.originalName}”, ` : '';
      lines.push(
        `  - version ${item.versionId} of document ${item.documentId}: ` +
          `${name}stored as ${item.storedName}`,
      );
    }
  }
  const deleted = report.orphans.filter((orphan) => orphan.status === 'deleted').length;
  if (deleted > 0) lines.push('', `Deleted ${plural(deleted, 'unused file')}.`);
  if (report.orphans.length === 0 && report.missing.length === 0) {
    lines.push('', 'No problems found.');
  }
  return lines.join('\n');
}

/** 0 = nothing left to do, 1 = unused or missing files remain, 2 = a deletion failed. */
function exitCodeFor(report) {
  if (report.orphans.some((orphan) => orphan.status === 'failed')) return 2;
  const remaining = report.orphans.filter((orphan) => orphan.status !== 'deleted');
  return remaining.length > 0 || report.missing.length > 0 ? 1 : 0;
}

/**
 * Runs the command for `args` (process.argv without node and the script) and resolves with the
 * exit code.
 */
async function main(args, { env = process.env, output = console } = {}) {
  let options;
  try {
    options = parseCliArgs(args);
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    output.error(`${error.message}\n\n${USAGE}`);
    return 2;
  }
  if (options.help) {
    output.log(USAGE);
    return 0;
  }

  let config;
  try {
    config = loadConfig(env, { requireSessionSecret: false });
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    output.error(error.message);
    return 2;
  }

  try {
    await mongoose.connect(config.mongodbUri, { serverSelectionTimeoutMS: 10_000 });
  } catch (error) {
    output.error(`Unable to connect to MongoDB: ${error.message}`);
    return 2;
  }
  try {
    const report = await checkUploads({
      uploadDir: config.uploads.dir,
      deleteOrphans: options.deleteOrphans,
    });
    output.log(formatReport(report));
    return exitCodeFor(report);
  } catch (error) {
    if (!(error instanceof UploadDirError)) throw error;
    output.error(error.message);
    return 2;
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      console.error('Checking the uploads failed:', error);
      process.exitCode = 2;
    },
  );
}

module.exports = {
  MIN_ORPHAN_AGE_MS,
  USAGE,
  UsageError,
  checkUploads,
  exitCodeFor,
  formatReport,
  main,
  parseCliArgs,
};
