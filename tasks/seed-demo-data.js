#!/usr/bin/env node
/**
 * Fills a development or demo database with fictional data: two sign-in accounts, owners,
 * categories of every scope, and documents whose versions expire relative to today, so every
 * status appears (expired, expiring soon, valid, no versions). Some versions get a generated
 * sample PDF in UPLOAD_DIR.
 *
 *   npm run db:seed              seed a database whose name ends in _dev or _demo
 *   npm run db:seed -- --force   seed a database with any other name
 *
 * Accounts: "demo" (administrator) and "demo.member" (member), password DEMO_USER_PASSWORD
 * (default LocalDemoOnly123!). Idempotent: existing accounts, owners (matched by name),
 * categories (by name) and documents (by owner and category) are kept as they are, and versions
 * are only added to demo documents that have none.
 */
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const mongoose = require('mongoose');

const { loadConfig } = require('../config');
const Category = require('../models/category');
const Document = require('../models/document');
const DocumentInstance = require('../models/documentInstance');
const Owner = require('../models/owner');
const User = require('../models/user');
const { todayUtc } = require('../services/status');
const { removeStoredFile, storedFilePath } = require('../services/storage');

const DEFAULT_PASSWORD = 'LocalDemoOnly123!';
const DEFAULT_WARNING_DAYS = 30;
const SEEDABLE_DATABASE = /_(dev|demo)$/;
const DAY_MS = 24 * 60 * 60 * 1000;
const CASE_INSENSITIVE = { locale: 'en', strength: 2 };
const MODELS = [User, Owner, Category, Document, DocumentInstance];
const USAGE = [
  'Usage: npm run db:seed [-- --force]',
  '',
  'Loads fictional demo data into the database in MONGODB_URI. Only databases whose name ends',
  'in _dev or _demo are seeded, unless --force is given.',
].join('\n');

const DEMO_USERS = [
  { username: 'demo', email: 'demo@example.test', display_name: 'Demo Admin', role: 'admin' },
  {
    username: 'demo.member',
    email: 'member@example.test',
    display_name: 'Demo Member',
    role: 'member',
  },
];

const DEMO_OWNERS = [
  {
    first_name: 'Alex',
    last_name: 'Example',
    email: 'alex.example@example.test',
    phone: '+1 555 0100',
    notes: 'Fictional demo owner.',
  },
  {
    first_name: 'Jamie',
    last_name: 'Sample',
    email: 'jamie.sample@example.test',
    phone: '+1 555 0101',
  },
  {
    first_name: 'Zoë-Ann',
    last_name: "O'Neil",
    email: 'zoe-ann.oneil@example.test',
    phone: '+1 555 0102',
    notes: 'Prefers reminders by email.',
  },
  { first_name: 'Taylor', last_name: 'Placeholder', email: 'taylor.placeholder@example.test' },
  { first_name: 'Sam', last_name: 'Specimen', phone: '+1 555 0104', notes: 'No email address.' },
  {
    first_name: 'Example',
    last_name: 'Bakery',
    email: 'office.bakery@example.test',
    phone: '+1 555 0199',
    notes: 'A fictional small business. Its own licences and policies use company categories.',
  },
];

const DEMO_CATEGORIES = [
  {
    name: 'Passport',
    scope: 'personal',
    description: 'Travel document issued by a national government.',
  },
  { name: 'National ID card', scope: 'personal', description: 'Government-issued identity card.' },
  { name: 'Driving licence', scope: 'personal', description: 'Licence to drive motor vehicles.' },
  {
    name: 'Health insurance card',
    scope: 'personal',
    description: 'Proof of health insurance cover.',
  },
  {
    name: 'Business licence',
    scope: 'company',
    description: 'Permission to run the business at its premises.',
  },
  {
    name: 'Fire safety certificate',
    scope: 'company',
    description: 'Result of the periodic fire safety inspection of the premises.',
  },
  {
    name: 'Liability insurance',
    scope: 'company',
    description: 'Public and product liability insurance policy.',
  },
  {
    name: 'Medical fitness certificate',
    scope: 'employee',
    description: 'Periodic occupational health check of an employee.',
  },
  {
    name: 'Work permit',
    scope: 'employee',
    description: 'Permission for an employee to work in the country.',
  },
];

// Expiry dates relative to today. "Expiring" and "valid" dates adapt to EXPIRY_WARNING_DAYS.
const expired = (daysAgo) => ({ status: 'expired', days: -daysAgo });
const expiring = (days) => ({ status: 'expiring', days });
const valid = (days) => ({ status: 'valid', days });

// Versions are listed oldest first; `years` is the validity period used for the issue date.
const DEMO_DOCUMENTS = [
  {
    owner: 'Alex Example',
    category: 'Passport',
    versions: [
      { expires: expired(380), years: 10, file: true },
      {
        expires: valid(3270),
        years: 10,
        file: true,
        notes: 'Renewed after the previous passport expired.',
      },
    ],
  },
  {
    owner: 'Alex Example',
    category: 'National ID card',
    versions: [{ expires: expiring(12), years: 10, file: true }],
  },
  {
    owner: 'Alex Example',
    category: 'Driving licence',
    versions: [{ expires: valid(1460), years: 10 }],
  },
  {
    owner: 'Alex Example',
    category: 'Health insurance card',
    versions: [{ expires: expired(45), years: 5 }],
  },
  {
    owner: 'Alex Example',
    category: 'Medical fitness certificate',
    versions: [{ expires: valid(250), years: 1, file: true }],
  },
  { owner: 'Jamie Sample', category: 'Passport', versions: [{ expires: expiring(25), years: 10 }] },
  {
    owner: 'Jamie Sample',
    category: 'National ID card',
    versions: [
      { expires: expired(750), years: 10 },
      { expires: valid(2900), years: 10, file: true },
    ],
  },
  {
    owner: 'Jamie Sample',
    category: 'Medical fitness certificate',
    versions: [
      {
        expires: expired(3),
        years: 1,
        file: true,
        notes: 'The appointment for the next check-up is booked.',
      },
    ],
  },
  { owner: 'Jamie Sample', category: 'Work permit', versions: [{ expires: valid(540), years: 2 }] },
  {
    owner: "Zoë-Ann O'Neil",
    category: 'Passport',
    versions: [{ expires: valid(2000), years: 10, file: true }],
  },
  {
    owner: "Zoë-Ann O'Neil",
    category: 'Driving licence',
    versions: [{ expires: expiring(5), years: 10 }],
  },
  { owner: "Zoë-Ann O'Neil", category: 'Health insurance card', versions: [] },
  {
    owner: "Zoë-Ann O'Neil",
    category: 'Work permit',
    versions: [
      { expires: expired(400), years: 1 },
      { expires: expiring(20), years: 1, file: true },
    ],
  },
  {
    owner: 'Taylor Placeholder',
    category: 'National ID card',
    versions: [{ expires: valid(1200), years: 10 }],
  },
  {
    owner: 'Taylor Placeholder',
    category: 'Driving licence',
    versions: [{ expires: expired(10), years: 10, file: true }],
  },
  { owner: 'Taylor Placeholder', category: 'Medical fitness certificate', versions: [] },
  { owner: 'Sam Specimen', category: 'Passport', versions: [] },
  {
    owner: 'Sam Specimen',
    category: 'Health insurance card',
    versions: [{ expires: valid(300), years: 5, file: true }],
  },
  {
    owner: 'Example Bakery',
    category: 'Business licence',
    versions: [
      { expires: expired(365), years: 3, file: true },
      { expires: valid(730), years: 3, file: true },
    ],
  },
  {
    owner: 'Example Bakery',
    category: 'Fire safety certificate',
    versions: [{ expires: expiring(18), years: 1, file: true }],
  },
  {
    owner: 'Example Bakery',
    category: 'Liability insurance',
    versions: [
      {
        expires: expired(60),
        years: 1,
        notes: 'Waiting for the renewal offer from the insurer.',
      },
    ],
  },
];

// Characters outside Latin-1 that the PDF WinAnsiEncoding can still show.
const WIN_ANSI_EXTRA = new Map([
  ['€', 0x80],
  ['…', 0x85],
  ['‘', 0x91],
  ['’', 0x92],
  ['“', 0x93],
  ['”', 0x94],
  ['–', 0x96],
  ['—', 0x97],
]);

/** Throws unless the database may receive demo data (name ends in _dev or _demo, or forced). */
function assertSeedableDatabase(name, { force = false } = {}) {
  if (force || (typeof name === 'string' && SEEDABLE_DATABASE.test(name))) return;
  throw new Error(
    `Refusing to seed the database "${name || '(none)'}": demo data is only written to ` +
      'databases whose name ends in _dev or _demo (for example docdatetrack_dev). Point ' +
      'MONGODB_URI at such a database, or pass --force (npm run db:seed -- --force) to seed ' +
      'this one anyway.',
  );
}

function addDays(date, days) {
  return new Date(date.getTime() + days * DAY_MS);
}

function addYears(date, years) {
  const result = new Date(date.getTime());
  result.setUTCFullYear(result.getUTCFullYear() + years);
  return result;
}

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function expiryOffset({ status, days }, warningDays) {
  if (status === 'expiring') return Math.min(days, warningDays);
  if (status === 'valid') return Math.max(days, warningDays + 1);
  return days;
}

function slug(text) {
  return text
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** A PDF string literal in WinAnsiEncoding; characters it cannot show become '?'. */
function pdfString(text) {
  let encoded = '';
  for (const char of text.normalize('NFC')) {
    const code = WIN_ANSI_EXTRA.get(char) ?? char.codePointAt(0);
    if (char === '(' || char === ')' || char === '\\') encoded += `\\${char}`;
    else if (code >= 0x20 && code < 0x7f) encoded += char;
    else if (WIN_ANSI_EXTRA.has(char) || (code >= 0xa0 && code <= 0xff)) {
      encoded += `\\${code.toString(8).padStart(3, '0')}`;
    } else encoded += '?';
  }
  return `(${encoded})`;
}

/** A minimal one-page PDF; `lines` are `{ text, size, y, bold }` (y in points from the bottom). */
function samplePdf(lines) {
  const content = [
    'BT',
    ...lines.flatMap(({ text, size, y, bold }) => [
      `/${bold ? 'F2' : 'F1'} ${size} Tf`,
      `1 0 0 1 56 ${y} Tm`,
      `${pdfString(text)} Tj`,
    ]),
    'ET',
  ].join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] ' +
      '/Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
    `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`,
  ];
  let pdf = '%PDF-1.4\n%\u00e2\u00e3\u00cf\u00d3\n';
  const offsets = objects.map((object, index) => {
    const offset = Buffer.byteLength(pdf, 'latin1');
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
    return offset;
  });
  const xrefOffset = Buffer.byteLength(pdf, 'latin1');
  pdf +=
    `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` +
    offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('') +
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}

async function writeSampleFile(uploadDir, { owner, category, issuedAt, expiresAt }) {
  const content = samplePdf([
    { text: 'Sample document — DocDateTrack demo data', size: 18, y: 770, bold: true },
    { text: `${category.name} — ${owner.name}`, size: 12, y: 740 },
    { text: `Issued: ${isoDate(issuedAt)}    Expires: ${isoDate(expiresAt)}`, size: 12, y: 722 },
    {
      text: 'Fictional data generated by the demo data seeder. This is not a real document.',
      size: 10,
      y: 696,
    },
  ]);
  const storedName = `${crypto.randomUUID()}.pdf`;
  await fs.writeFile(storedFilePath(uploadDir, storedName), content, { flag: 'wx' });
  return {
    stored_name: storedName,
    original_name: `${slug(`${category.name} ${owner.name}`)}-${expiresAt.getUTCFullYear()}.pdf`,
    mime_type: 'application/pdf',
    size: content.length,
  };
}

async function seedUsers(password, summary) {
  for (const data of DEMO_USERS) {
    if (await User.exists({ $or: [{ username: data.username }, { email: data.email }] })) {
      summary.users.existing.push(data.username);
      continue;
    }
    await User.register(new User(data), password);
    summary.users.created.push(data.username);
  }
}

/** Finds each record with `findExisting` or creates it; returns them keyed by `keyOf(data)`. */
async function findOrCreateAll(Model, items, { findExisting, keyOf }, counts) {
  const records = new Map();
  for (const data of items) {
    let record = await findExisting(data);
    if (record) {
      counts.existing += 1;
    } else {
      record = await Model.create(data);
      counts.created += 1;
    }
    records.set(keyOf(data), record);
  }
  return records;
}

async function seedVersions(document, plan, { owner, category, today, uploadDir, warningDays }) {
  const created = { versions: 0, files: 0 };
  for (const version of plan.versions) {
    const expiresAt = addDays(today, expiryOffset(version.expires, warningDays));
    const issuedAt = new Date(Math.min(addYears(expiresAt, -version.years), today));
    const file = version.file
      ? await writeSampleFile(uploadDir, { owner, category, issuedAt, expiresAt })
      : undefined;
    try {
      await DocumentInstance.create({
        document: document._id,
        issued_at: issuedAt,
        expires_at: expiresAt,
        file,
        notes: version.notes,
      });
    } catch (error) {
      if (file) await removeStoredFile(uploadDir, file.stored_name);
      throw error;
    }
    created.versions += 1;
    if (file) created.files += 1;
  }
  return created;
}

/**
 * Seeds the database of the open mongoose connection and returns a summary. Refuses databases
 * whose name does not end in _dev or _demo unless `force` is set.
 */
async function seedDemoData({
  now = new Date(),
  uploadDir,
  force = false,
  password = DEFAULT_PASSWORD,
  warningDays = DEFAULT_WARNING_DAYS,
} = {}) {
  if (!uploadDir) throw new TypeError('uploadDir is required');
  const database = mongoose.connection.name;
  assertSeedableDatabase(database, { force });

  await Promise.all(MODELS.map((Model) => Model.createIndexes()));
  await fs.mkdir(uploadDir, { recursive: true });

  const summary = {
    database,
    uploadDir,
    users: { created: [], existing: [] },
    owners: { created: 0, existing: 0 },
    categories: { created: 0, existing: 0 },
    documents: { created: 0, existing: 0 },
    versions: { created: 0, files: 0 },
  };

  await seedUsers(password, summary);
  const owners = await findOrCreateAll(
    Owner,
    DEMO_OWNERS,
    {
      findExisting: ({ first_name, last_name }) =>
        Owner.findOne({ first_name, last_name }).collation(CASE_INSENSITIVE),
      keyOf: ({ first_name, last_name }) => `${first_name} ${last_name}`,
    },
    summary.owners,
  );
  const categories = await findOrCreateAll(
    Category,
    DEMO_CATEGORIES,
    {
      findExisting: ({ name }) => Category.findOne({ name }).collation(CASE_INSENSITIVE),
      keyOf: ({ name }) => name,
    },
    summary.categories,
  );

  const today = todayUtc(now);
  for (const plan of DEMO_DOCUMENTS) {
    const owner = owners.get(plan.owner);
    const category = categories.get(plan.category);
    const pair = { owner: owner._id, category: category._id };
    let document = await Document.findOne(pair);
    if (document) {
      summary.documents.existing += 1;
    } else {
      document = await Document.create(pair);
      summary.documents.created += 1;
    }
    if (plan.versions.length === 0 || (await DocumentInstance.exists({ document: document._id }))) {
      continue;
    }
    const created = await seedVersions(document, plan, {
      owner,
      category,
      today,
      uploadDir,
      warningDays,
    });
    summary.versions.created += created.versions;
    summary.versions.files += created.files;
  }
  return summary;
}

function formatSummary(summary) {
  const { users, owners, categories, documents, versions } = summary;
  const counts = ({ created, existing }) => `${created} created, ${existing} already existed`;
  const createdUsers = users.created.length > 0 ? ` (${users.created.join(', ')})` : '';
  return [
    `Demo data in database "${summary.database}":`,
    `  Accounts:   ${users.created.length} created${createdUsers}, ` +
      `${users.existing.length} already existed (left unchanged)`,
    `  Owners:     ${counts(owners)}`,
    `  Categories: ${counts(categories)}`,
    `  Documents:  ${counts(documents)}`,
    `  Versions:   ${versions.created} created, ${versions.files} with a sample PDF in ` +
      summary.uploadDir,
    'Sign in as "demo" (administrator) or "demo.member" (member) with the password from',
    `DEMO_USER_PASSWORD (default: ${DEFAULT_PASSWORD}). For local development and demos only.`,
  ].join('\n');
}

async function main(args) {
  if (args.includes('--help') || args.includes('-h')) {
    console.info(USAGE);
    return;
  }
  const unknown = args.filter((arg) => arg !== '--force');
  if (unknown.length > 0) throw new Error(`Unknown argument(s): ${unknown.join(' ')}.\n${USAGE}`);

  const config = loadConfig(process.env, { requireSessionSecret: false });
  // No automatic index builds: nothing may be written before the database name is checked.
  await mongoose.connect(config.mongodbUri, {
    autoCreate: false,
    autoIndex: false,
    serverSelectionTimeoutMS: 10_000,
  });
  try {
    const summary = await seedDemoData({
      force: args.includes('--force'),
      uploadDir: config.uploads.dir,
      warningDays: config.expiryWarningDays,
      password: process.env.DEMO_USER_PASSWORD || DEFAULT_PASSWORD,
    });
    console.info(formatSummary(summary));
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`Seeding failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { seedDemoData, assertSeedableDatabase, formatSummary };
