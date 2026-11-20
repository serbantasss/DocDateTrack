const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const { body } = require('express-validator');
const createError = require('http-errors');
const multer = require('multer');

const { removeStoredFile, storedFilePath } = require('./storage');

const MEGABYTE = 1024 * 1024;
const HEADER_LENGTH = 12;
const MAX_FILE_NAME_LENGTH = 255;
// Control characters and the bidirectional formatting marks that can disguise an extension.
const UNSAFE_NAME_CHARACTERS = /[\p{Cc}\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu;

const UPLOAD_ACCEPT = '.pdf,.jpg,.jpeg,.png,.webp';
const TYPE_ERROR = 'Upload a PDF, JPEG, PNG or WebP file.';
const EMPTY_ERROR = 'The selected file is empty.';

const PDF_SIGNATURE = Buffer.from('%PDF-', 'latin1');
const JPEG_SIGNATURE = Buffer.from([0xff, 0xd8, 0xff]);
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const RIFF_SIGNATURE = Buffer.from('RIFF', 'latin1');
const WEBP_SIGNATURE = Buffer.from('WEBP', 'latin1');

function hasBytes(header, signature, offset = 0) {
  return (
    header.length >= offset + signature.length &&
    header.subarray(offset, offset + signature.length).equals(signature)
  );
}

// The accepted types; the first extension is the canonical one, used for stored names.
const FILE_TYPES = [
  {
    mimeType: 'application/pdf',
    extensions: ['pdf'],
    matches: (h) => hasBytes(h, PDF_SIGNATURE),
  },
  {
    mimeType: 'image/jpeg',
    extensions: ['jpg', 'jpeg'],
    matches: (h) => hasBytes(h, JPEG_SIGNATURE),
  },
  {
    mimeType: 'image/png',
    extensions: ['png'],
    matches: (h) => hasBytes(h, PNG_SIGNATURE),
  },
  {
    mimeType: 'image/webp',
    extensions: ['webp'],
    matches: (h) => hasBytes(h, RIFF_SIGNATURE) && hasBytes(h, WEBP_SIGNATURE, 8),
  },
];
// Names given to accepted uploads by inspectFile(): `<random UUID>.<canonical extension>`.
const STORED_NAME =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(?:pdf|jpg|png|webp)$/;

/** Recognises an accepted file type from the first bytes of a file: `{ mimeType, extension }`. */
function detectFileType(header) {
  const type = FILE_TYPES.find((candidate) => candidate.matches(header));
  return type ? { mimeType: type.mimeType, extension: type.extensions[0] } : null;
}

function fileTypeForMime(mimeType) {
  if (typeof mimeType !== 'string') return null;
  const normalized = mimeType.trim().toLowerCase();
  return FILE_TYPES.find((type) => type.mimeType === normalized) ?? null;
}

/** True for names the app gives to accepted uploads (`<uuid>.<ext>`). */
function isAppStoredName(name) {
  return typeof name === 'string' && STORED_NAME.test(name);
}

async function readFileHeader(filePath) {
  const handle = await fs.open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(HEADER_LENGTH);
    const { bytesRead } = await handle.read(buffer, 0, HEADER_LENGTH, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

function truncateFileName(name, maxLength) {
  if (name.length <= maxLength) return name;
  const dot = name.lastIndexOf('.');
  const extension = dot > 0 && name.length - dot <= 16 ? name.slice(dot) : '';
  let stem = '';
  // Iterate by code point so a surrogate pair is never cut in half.
  for (const character of name.slice(0, name.length - extension.length)) {
    if (stem.length + character.length + extension.length > maxLength) break;
    stem += character;
  }
  return stem.trimEnd() + extension;
}

function cleanBaseName(name) {
  if (typeof name !== 'string') return '';
  return (
    name
      .normalize('NFC')
      .split(/[\\/]/)
      .pop()
      .replace(UNSAFE_NAME_CHARACTERS, '')
      // Leading dots hide a file; Windows drops trailing dots and spaces from names.
      .replace(/^[\s.]+|[\s.]+$/g, '')
  );
}

function extensionOf(name) {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

/**
 * Display and download name of a stored file: the client-supplied base name without control and
 * direction characters, at most 255 characters. For the accepted types (`mimeType`) the extension
 * always matches the type — a PDF named `invoice.html` becomes `invoice.html.pdf`, so it cannot
 * be opened as a web page or a script from the downloads folder — and an unusable name becomes
 * `document.<ext>`. Other (legacy) types keep their cleaned name, or get '' when nothing is left.
 * The name is only used for display and in Content-Disposition headers, never as a path.
 */
function sanitizeFileName(name, mimeType) {
  const type = fileTypeForMime(mimeType);
  const baseName = cleanBaseName(name);
  if (!type) return truncateFileName(baseName, MAX_FILE_NAME_LENGTH);
  if (!baseName) return `document.${type.extensions[0]}`;
  const fitting = type.extensions.includes(extensionOf(baseName));
  return truncateFileName(
    fitting ? baseName : `${baseName}.${type.extensions[0]}`,
    MAX_FILE_NAME_LENGTH,
  );
}

/**
 * Attachment name and Content-Type for sending a stored file (a DocumentInstance#file). Only the
 * accepted types are sent with their own type; anything else, such as files from the legacy
 * version of the app, is sent as application/octet-stream.
 */
function downloadDetails(file) {
  const type = fileTypeForMime(file.mime_type);
  return {
    fileName: sanitizeFileName(file.original_name, file.mime_type) || file.stored_name,
    contentType: type ? type.mimeType : 'application/octet-stream',
  };
}

function formatMegabytes(bytes) {
  return Math.round((bytes / MEGABYTE) * 10) / 10;
}

/** Help text of upload fields, e.g. "PDF, JPEG, PNG or WebP, up to 10 MB." */
function uploadHelp(maxBytes) {
  return `PDF, JPEG, PNG or WebP, up to ${formatMegabytes(maxBytes)} MB.`;
}

/**
 * Remembers the files stored for one request and deletes every file that was not committed —
 * referenced by a saved version — once the response is over: sent normally, replaced by an error
 * page (CSRF failure, validation errors, exceptions) or abandoned by the client. Cleanup waits
 * while run()/commit() callbacks are in progress, so a file is never deleted while the version
 * that references it is being saved.
 */
class UploadTracker {
  /** Metadata of the accepted upload, ready for DocumentInstance#file, or null. */
  file = null;
  /** Message for the file field when the upload was rejected, or null. */
  error = null;

  #uploadDir;
  #pending = new Set();
  #busy = 0;
  #responseOver = false;

  constructor(uploadDir, res) {
    this.#uploadDir = uploadDir;
    // The client may already be gone, in which case 'close' will not be emitted again.
    this.#responseOver = Boolean(res.destroyed);
    const onResponseOver = () => {
      this.#responseOver = true;
      this.#sweep();
    };
    res.once('finish', onResponseOver);
    res.once('close', onResponseOver);
  }

  /** True once the response has been sent or the client has gone away. */
  get responseOver() {
    return this.#responseOver;
  }

  /** Registers a stored file that must be deleted unless it is committed. */
  track(storedName) {
    this.#pending.add(storedName);
    this.#sweep();
  }

  /** Runs `task` while holding back the cleanup. Fails once the response is over. */
  async run(task) {
    if (this.#responseOver) throw createError(400, 'The upload was cancelled.');
    this.#busy += 1;
    try {
      return await task();
    } finally {
      this.#busy -= 1;
      this.#sweep();
    }
  }

  /** Runs `save` (which stores the reference to the file) and keeps the files if it succeeds. */
  commit(save) {
    return this.run(async () => {
      const result = await save();
      this.#pending.clear();
      return result;
    });
  }

  /** Gives a tracked file a new name inside the upload directory. */
  async rename(storedName, newName) {
    await fs.rename(
      storedFilePath(this.#uploadDir, storedName),
      storedFilePath(this.#uploadDir, newName),
    );
    this.#pending.delete(storedName);
    this.#pending.add(newName);
  }

  /** Deletes the uncommitted files right away. */
  async discard() {
    const storedNames = [...this.#pending];
    this.#pending.clear();
    await Promise.all(storedNames.map((storedName) => this.#remove(storedName)));
  }

  #sweep() {
    if (this.#responseOver && this.#busy === 0 && this.#pending.size > 0) this.discard();
  }

  async #remove(storedName) {
    try {
      await removeStoredFile(this.#uploadDir, storedName);
    } catch (error) {
      console.warn(`Unable to delete the uploaded file ${storedName}: ${error.message}`);
    }
  }
}

const parser = multer({
  storage: multer.diskStorage({
    destination(req, file, callback) {
      const { dir } = req.app.get('config').uploads;
      fs.mkdir(dir, { recursive: true }).then(() => callback(null, dir), callback);
    },
    filename(req, file, callback) {
      callback(null, crypto.randomUUID());
    },
  }),
  limits: (req) => ({
    fileSize: req.app.get('config').uploads.maxBytes,
    files: 1,
    fields: 20,
    fieldNameSize: 100,
    fieldSize: 32 * 1024,
    parts: 25,
  }),
  // Browsers send UTF-8 file names; busboy would otherwise decode them as Latin-1.
  defParamCharset: 'utf8',
});

/** Message for the file field when multer rejected the file because of a limit, else null. */
function limitMessage(error, maxBytes) {
  if (!(error instanceof multer.MulterError)) return null;
  if (error.code === 'LIMIT_FILE_SIZE') {
    return `The file is larger than ${formatMegabytes(maxBytes)} MB.`;
  }
  if (error.code === 'LIMIT_FILE_COUNT' || error.code === 'LIMIT_UNEXPECTED_FILE') {
    return 'Upload a single file.';
  }
  return null;
}

async function inspectFile(upload, file) {
  const type = file.size > 0 ? detectFileType(await readFileHeader(file.path)) : null;
  if (!type) {
    upload.error = file.size > 0 ? TYPE_ERROR : EMPTY_ERROR;
    await upload.discard();
    return;
  }
  const storedName = `${file.filename}.${type.extension}`;
  await upload.rename(file.filename, storedName);
  upload.file = {
    stored_name: storedName,
    original_name: sanitizeFileName(file.originalname, type.mimeType),
    mime_type: type.mimeType,
    size: file.size,
  };
}

/**
 * Multipart parser for forms with one optional file field. Use it as the first step of the route
 * and verify the CSRF token right after it:
 *
 *   router.post('/', uploadSingle('file'), verifyCsrf, ...rules, uploadedFile('file'), handler)
 *
 * The file is stored under a random name in UPLOAD_DIR and accepted only when its first bytes
 * show a PDF, JPEG, PNG or WebP file. The handler finds the result in `req.upload`
 * (an UploadTracker): `req.upload.file` is the metadata to save, and the file is kept only when
 * the version is saved inside `req.upload.commit(() => version.save())`. Rejected files
 * (too large, wrong type, empty) are reported by the uploadedFile() rule, so the form can be
 * shown again once the CSRF token has been verified.
 */
function uploadSingle(fieldName) {
  const parse = parser.single(fieldName);
  return function handleUpload(req, res, next) {
    const config = req.app.get('config');
    const upload = new UploadTracker(config.uploads.dir, res);
    req.upload = upload;

    parse(req, res, (error) => {
      if (req.file) upload.track(req.file.filename);
      // The client went away (multer removes partial files itself): there is nobody to answer.
      if (upload.responseOver) return;
      if (error) {
        upload.error = limitMessage(error, config.uploads.maxBytes);
        if (upload.error) return next();
        // Errors without a code come from parsing a malformed body, not from the server.
        if (error.name === 'MulterError' || error.code) return next(error);
        return next(createError(400, 'The upload could not be read. Please try again.'));
      }
      if (!req.file) return next();
      upload.run(() => inspectFile(upload, req.file)).then(() => next(), next);
    });
  };
}

/** express-validator rule reporting a rejected upload as an error of the file field. */
function uploadedFile(fieldName) {
  return body(fieldName).custom((value, { req }) => {
    if (req.upload?.error) throw new Error(req.upload.error);
    return true;
  });
}

module.exports = {
  UPLOAD_ACCEPT,
  UploadTracker,
  detectFileType,
  downloadDetails,
  formatMegabytes,
  isAppStoredName,
  sanitizeFileName,
  uploadHelp,
  uploadSingle,
  uploadedFile,
};
