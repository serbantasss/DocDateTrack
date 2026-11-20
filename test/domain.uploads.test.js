const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { after, afterEach, before, beforeEach, describe, it } = require('node:test');
const { setTimeout: delay } = require('node:timers/promises');
const request = require('supertest');

const Category = require('../models/category');
const Document = require('../models/document');
const DocumentInstance = require('../models/documentInstance');
const Owner = require('../models/owner');
const {
  UploadTracker,
  detectFileType,
  downloadDetails,
  sanitizeFileName,
} = require('../services/uploads');
const {
  TEST_PASSWORD,
  createTestApp,
  createUser,
  getCsrfToken,
  loginAgent,
} = require('./helpers/app');
const { clearTestDb, startTestDb, stopTestDb } = require('./helpers/db');
const { makeTempDir, removeTempDir } = require('./helpers/tmp');

const PDF = Buffer.from('%PDF-1.4\n%%EOF\n', 'latin1');
const HTML = Buffer.from('<!doctype html><title>Scan</title><script>alert(1)</script>');

/** Files in `dir` once pending cleanups had a chance to finish. */
async function filesIn(dir, expectedCount) {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    if (fs.readdirSync(dir).length === expectedCount) break;
    await delay(10);
  }
  return fs.readdirSync(dir).sort();
}

async function setup(env = {}) {
  await createUser({ username: 'member' });
  const { app, config } = createTestApp(env);
  const agent = await loginAgent(app, { username: 'member' });
  const owner = await Owner.create({ first_name: 'Ana', last_name: 'Pop' });
  const category = await Category.create({ name: 'Passport' });
  const document = await Document.create({ owner, category });
  return { app, agent, config, document, token: await getCsrfToken(agent) };
}

/** A multipart form post as a browser sends it: same-origin, `_csrf` first, the file last. */
function postVersion({ agent, document, token }, file) {
  return agent
    .post('/versions')
    .set('Sec-Fetch-Site', 'same-origin')
    .field('_csrf', token)
    .field('document', String(document._id))
    .field('expires_at', '2030-01-31')
    .attach('file', file.content, { filename: file.name, contentType: file.type });
}

describe('file type detection', () => {
  it('recognises PDF, JPEG, PNG and WebP files by their first bytes', () => {
    const cases = [
      [PDF, { mimeType: 'application/pdf', extension: 'pdf' }],
      [
        Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]),
        { mimeType: 'image/jpeg', extension: 'jpg' },
      ],
      [
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]),
        { mimeType: 'image/png', extension: 'png' },
      ],
      [
        Buffer.from('RIFF\x24\x00\x00\x00WEBPVP8 ', 'latin1'),
        { mimeType: 'image/webp', extension: 'webp' },
      ],
    ];
    for (const [header, expected] of cases) assert.deepEqual(detectFileType(header), expected);
  });

  it('rejects anything else', () => {
    for (const header of [
      HTML,
      Buffer.from('RIFF\x24\x00\x00\x00WAVEfmt ', 'latin1'),
      Buffer.from('%PDF', 'latin1'),
      Buffer.from([0x89, 0x50, 0x4e, 0x47]),
      Buffer.from('GIF89a', 'latin1'),
      Buffer.alloc(0),
    ]) {
      assert.equal(detectFileType(header), null, header.toString('latin1'));
    }
  });
});

describe('file names', () => {
  it('keeps the base name without control and direction characters', () => {
    const pdf = 'application/pdf';
    assert.equal(sanitizeFileName('C:\\Scans\\passport.pdf', pdf), 'passport.pdf');
    assert.equal(sanitizeFileName('  bill\u0000\u001f\u007f.pdf. ', pdf), 'bill.pdf');
    assert.equal(sanitizeFileName('Pașaport Ștefan.PDF', pdf), 'Pașaport Ștefan.PDF');
    assert.equal(sanitizeFileName('../../etc/passwd', pdf), 'passwd.pdf');
  });

  it('gives every accepted file an extension that matches its type', () => {
    const cases = [
      ['invoice.html', 'application/pdf', 'invoice.html.pdf'],
      ['photo.svg', 'image/png', 'photo.svg.png'],
      ['run.hta ', 'application/pdf', 'run.hta.pdf'],
      ['invoice\u202efdp.exe', 'application/pdf', 'invoicefdp.exe.pdf'],
      ['scan.JPEG', 'image/jpeg', 'scan.JPEG'],
      ['scan.jpg', 'image/jpeg', 'scan.jpg'],
      ['scan.png', 'image/jpeg', 'scan.png.jpg'],
      ['card.WebP', 'image/webp', 'card.WebP'],
      ['.pdf', 'application/pdf', 'pdf.pdf'],
    ];
    for (const [name, mimeType, expected] of cases) {
      assert.equal(sanitizeFileName(name, mimeType), expected, name);
    }
  });

  it('keeps the cleaned name of other (legacy) types', () => {
    assert.equal(sanitizeFileName('old/scan.html', 'text/html'), 'scan.html');
    assert.equal(sanitizeFileName('..', 'text/plain'), '');
  });

  it('falls back to a generic name', () => {
    for (const name of ['', '   ', '.', '..', 'dir/', '\u202e', undefined, 42]) {
      assert.equal(sanitizeFileName(name, 'image/png'), 'document.png', String(name));
    }
  });

  it('shortens long names to 255 characters and keeps the extension', () => {
    const shortened = sanitizeFileName(`${'a'.repeat(300)}.jpeg`, 'image/jpeg');
    assert.equal(shortened.length, 255);
    assert.ok(shortened.endsWith('a.jpeg'));
    const renamed = sanitizeFileName(`${'b'.repeat(300)}.html`, 'application/pdf');
    assert.equal(renamed.length, 255);
    assert.ok(renamed.endsWith('b.pdf'));
    const emoji = sanitizeFileName(`${'😀'.repeat(200)}.pdf`, 'application/pdf');
    assert.ok(emoji.length <= 255);
    assert.ok(emoji.endsWith('😀.pdf'));
  });

  it('sends only the accepted types with their own content type', () => {
    const file = (original_name, mime_type) => ({
      stored_name: 'stored.bin',
      original_name,
      mime_type,
    });
    assert.deepEqual(downloadDetails(file('photo.svg', 'image/png')), {
      fileName: 'photo.svg.png',
      contentType: 'image/png',
    });
    assert.deepEqual(downloadDetails(file('Scan.PDF', 'Application/PDF')), {
      fileName: 'Scan.PDF',
      contentType: 'application/pdf',
    });
    for (const mimeType of ['text/html', 'image/svg+xml', 'text/plain', undefined]) {
      assert.deepEqual(downloadDetails(file('legacy.html', mimeType)), {
        fileName: 'legacy.html',
        contentType: 'application/octet-stream',
      });
    }
    assert.equal(downloadDetails(file('', 'text/plain')).fileName, 'stored.bin');
  });
});

describe('UploadTracker', () => {
  let dir;
  beforeEach(() => {
    dir = makeTempDir('tracker-');
  });
  afterEach(() => removeTempDir(dir));

  function trackedFile(upload, name) {
    fs.writeFileSync(path.join(dir, name), 'data');
    upload.track(name);
  }

  it('deletes uncommitted files once the response is over', async () => {
    const res = new EventEmitter();
    const upload = new UploadTracker(dir, res);
    trackedFile(upload, 'a.pdf');
    await delay(20);
    assert.deepEqual(fs.readdirSync(dir), ['a.pdf']);

    res.emit('finish');
    assert.equal(upload.responseOver, true);
    assert.deepEqual(await filesIn(dir, 0), []);

    trackedFile(upload, 'late.pdf');
    assert.deepEqual(await filesIn(dir, 0), []);
  });

  it('keeps committed files, even when the client leaves during the save', async () => {
    const res = new EventEmitter();
    const upload = new UploadTracker(dir, res);
    trackedFile(upload, 'b.pdf');
    await upload.commit(async () => {
      res.emit('close');
      await delay(20);
    });
    await delay(20);
    assert.deepEqual(fs.readdirSync(dir), ['b.pdf']);
  });

  it('cleans up after a failed save and refuses to save once the client has left', async () => {
    const res = new EventEmitter();
    const upload = new UploadTracker(dir, res);
    trackedFile(upload, 'c.pdf');
    await assert.rejects(
      upload.commit(async () => {
        res.emit('close');
        await delay(20);
        assert.deepEqual(fs.readdirSync(dir), ['c.pdf']);
        throw new Error('save failed');
      }),
      /save failed/,
    );
    assert.deepEqual(await filesIn(dir, 0), []);
    await assert.rejects(
      upload.commit(async () => {}),
      { status: 400 },
    );
  });
});

describe('uploads over HTTP', () => {
  before(startTestDb);
  after(stopTestDb);
  beforeEach(clearTestDb);

  it('names polyglot files after their detected type', async () => {
    const context = await setup();
    const polyglots = [
      {
        content: Buffer.from('%PDF-1.4\n<html><script>alert(document.cookie)</script></html>\n'),
        name: 'invoice.html',
        type: 'text/html',
        expected: { original_name: 'invoice.html.pdf', mime_type: 'application/pdf' },
      },
      {
        content: Buffer.concat([
          Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
          Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
        ]),
        name: 'photo.svg',
        type: 'image/svg+xml',
        expected: { original_name: 'photo.svg.png', mime_type: 'image/png' },
      },
    ];
    for (const polyglot of polyglots) {
      await postVersion(context, polyglot).expect(302);
      const version = await DocumentInstance.findOne().sort({ _id: -1 });
      assert.equal(version.file.original_name, polyglot.expected.original_name);
      assert.equal(version.file.mime_type, polyglot.expected.mime_type);

      const download = await context.agent.get(`/versions/${version._id}/download`).expect(200);
      assert.equal(download.headers['content-type'], polyglot.expected.mime_type);
      assert.equal(
        download.headers['content-disposition'].replaceAll('"', ''),
        `attachment; filename=${polyglot.expected.original_name}`,
      );
    }
  });

  it('rejects content that is not a PDF, JPEG, PNG or WebP file', async () => {
    const context = await setup();
    const response = await postVersion(context, {
      content: HTML,
      name: 'scan.pdf',
      type: 'application/pdf',
    }).expect(422);
    assert.match(response.text, /Upload a PDF, JPEG, PNG or WebP file\./);
    assert.equal(await DocumentInstance.countDocuments(), 0);
    assert.deepEqual(await filesIn(context.config.uploads.dir, 0), []);
  });

  it('rejects empty files', async () => {
    const context = await setup();
    const response = await postVersion(context, {
      content: Buffer.alloc(0),
      name: 'scan.pdf',
      type: 'application/pdf',
    }).expect(422);
    assert.match(response.text, /The selected file is empty\./);
    assert.deepEqual(await filesIn(context.config.uploads.dir, 0), []);
  });

  it('rejects files above MAX_UPLOAD_MB', async () => {
    const context = await setup({ MAX_UPLOAD_MB: '1' });
    const response = await postVersion(context, {
      content: Buffer.concat([PDF, Buffer.alloc(1.5 * 1024 * 1024)]),
      name: 'big.pdf',
      type: 'application/pdf',
    }).expect(422);
    assert.match(response.text, /The file is larger than 1 MB\./);
    assert.match(response.text, /PDF, JPEG, PNG or WebP, up to 1 MB\./);
    assert.match(response.text, /data-max-bytes="1048576"/);
    assert.equal(await DocumentInstance.countDocuments(), 0);
    assert.deepEqual(await filesIn(context.config.uploads.dir, 0), []);
  });

  it('rejects more than one file', async () => {
    const context = await setup();
    const response = await postVersion(context, {
      content: PDF,
      name: 'a.pdf',
      type: 'application/pdf',
    })
      .attach('file', PDF, { filename: 'b.pdf', contentType: 'application/pdf' })
      .expect(422);
    assert.match(response.text, /Upload a single file\./);
    assert.deepEqual(await filesIn(context.config.uploads.dir, 0), []);
  });

  it('rejects multipart requests without a valid CSRF token', async () => {
    const { agent, config, document } = await setup();
    const version = await DocumentInstance.create({ document, expires_at: new Date('2030-01-01') });
    for (const url of ['/versions', `/versions/${version._id}?_method=PUT`]) {
      for (const token of [null, 'forged']) {
        let req = agent
          .post(url)
          .set('Sec-Fetch-Site', 'same-origin')
          .set('Accept', 'application/json');
        if (token) req = req.field('_csrf', token);
        const response = await req
          .field('document', String(document._id))
          .field('expires_at', '2031-01-31')
          .attach('file', PDF, { filename: 'scan.pdf', contentType: 'application/pdf' })
          .expect(403);
        assert.equal(response.body.error.status, 403);
      }
    }
    assert.equal(await DocumentInstance.countDocuments(), 1);
    assert.deepEqual((await DocumentInstance.findById(version._id)).file, undefined);
    assert.deepEqual(await filesIn(config.uploads.dir, 0), []);
  });

  it('answers 400 to a malformed multipart body', async () => {
    const { agent, config, document, token } = await setup();
    const boundary = 'ddt-boundary';
    const truncated = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="_csrf"',
      '',
      token,
      `--${boundary}`,
      'Content-Disposition: form-data; name="document"',
      '',
      String(document._id),
      `--${boundary}`,
      'Content-Disposition: form-data; name="file"; filename="scan.pdf"',
      'Content-Type: application/pdf',
      '',
      '%PDF-1.4 and the request ends here',
    ].join('\r\n');
    const response = await agent
      .post('/versions')
      .set('Sec-Fetch-Site', 'same-origin')
      .set('Accept', 'application/json')
      .set('Content-Type', `multipart/form-data; boundary=${boundary}`)
      .send(truncated)
      .expect(400);
    assert.equal(response.body.error.status, 400);
    assert.deepEqual(await filesIn(config.uploads.dir, 0), []);
  });

  it('removes the partial file when the client aborts the upload', async () => {
    const { app, config, document } = await setup();
    // A raw connection that can be cut mid-upload needs its own session cookie.
    const first = await request(app).get('/csrf-token').expect(200);
    const anonymous = first.headers['set-cookie'][0].split(';')[0];
    const login = await request(app)
      .post('/login')
      .set('Cookie', anonymous)
      .type('form')
      .send({ username: 'member', password: TEST_PASSWORD, _csrf: first.body.token })
      .expect(302);
    const cookie = (login.headers['set-cookie']?.[0] ?? anonymous).split(';')[0];
    const { token } = (await request(app).get('/csrf-token').set('Cookie', cookie)).body;

    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const boundary = 'ddt-boundary';
      const head = Buffer.from(
        [
          `--${boundary}`,
          'Content-Disposition: form-data; name="_csrf"',
          '',
          token,
          `--${boundary}`,
          'Content-Disposition: form-data; name="document"',
          '',
          String(document._id),
          `--${boundary}`,
          'Content-Disposition: form-data; name="expires_at"',
          '',
          '2030-01-31',
          `--${boundary}`,
          'Content-Disposition: form-data; name="file"; filename="scan.pdf"',
          'Content-Type: application/pdf',
          '',
          '',
        ].join('\r\n'),
      );
      const upload = http.request({
        host: '127.0.0.1',
        port: server.address().port,
        method: 'POST',
        path: '/versions',
        headers: {
          cookie,
          'sec-fetch-site': 'same-origin',
          'content-type': `multipart/form-data; boundary=${boundary}`,
          'content-length': String(head.length + 4 * 1024 * 1024),
        },
      });
      upload.on('error', () => {});
      upload.write(head);
      upload.write(Buffer.concat([PDF, Buffer.alloc(256 * 1024)]));
      assert.equal((await filesIn(config.uploads.dir, 1)).length, 1);

      upload.destroy();
      assert.deepEqual(await filesIn(config.uploads.dir, 0), []);
      assert.equal(await DocumentInstance.countDocuments(), 0);
    } finally {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
