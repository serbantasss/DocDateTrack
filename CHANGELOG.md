# Changelog

All notable changes to DocDateTrack are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

Version **1.0.0** (in progress) — the first stable release, which turns the 2023 prototype into a self-hosted, open-source application.

### Added

- User accounts, separate from document owners, with `admin` and `member` roles. On a new installation the first account registered becomes the administrator (first-run setup); after that, self-registration is closed unless `ALLOW_REGISTRATION=true`, and new accounts are members.
- User management for administrators — create, edit and delete accounts, change roles and reset passwords — with safeguards against deleting your own account and against deleting or demoting the last administrator, also when two administrators make changes at the same time.
- Account page for changing your email address, display name and password.
- Signing in with either a username or an email address, and a "Keep me signed in" option that keeps a sign-in for 30 days; other sign-ins end after `SESSION_TTL_HOURS` without activity.
- `npm run users` command-line task to list the accounts, reset a password (`reset-password`), create an administrator (`create-admin`) or make a user an administrator (`promote`) — for example when the only administrator is locked out. New passwords are random and shown once.
- Dashboard with the number of expired, expiring, valid and missing documents, the documents that need attention, the recently added versions, and getting-started steps on a new installation.
- Document status — Expired, Expiring soon, Valid or No versions — computed from the current version (the one with the latest expiry date) and the `EXPIRY_WARNING_DAYS` threshold (30 days by default).
- Versions of a document, each with an issue date, an expiry date, notes and an optional scan (PDF, JPEG, PNG or WebP, up to `MAX_UPLOAD_MB`) that signed-in users can download. Replacing or removing a scan deletes the old file, and saving a version that someone else changed in the meantime is refused instead of overwriting their changes.
- List, create, edit and delete pages for owners, categories, documents and versions, and detail pages for owners, categories and documents. The document list can be filtered by owner, category, scope and status, is paginated, and has a search that matches every word in owner and category names, ignoring case and accents; owners can be searched by name or email address in the same way.
- Category scopes (personal, company, employee), and contact details and notes for owners.
- Optional email reminders: a scheduled digest of expired and expiring documents for administrators (`REMINDERS_ENABLED`, `REMINDER_CRON`), optionally also sent to owners who have an email address (`NOTIFY_OWNERS`), through any SMTP server. Each recipient is told about a version once when it starts expiring and once when it has expired; a new version or a changed expiry date starts over, and emails that could not be sent are retried on the next run.
- `npm run reminders:send` sends the due reminders from the command line; `--dry-run` shows who would get which reminders without sending or recording anything, and `--test <email>` sends a test email to check the SMTP settings.
- `npm run uploads:check` command-line task that reports files in `UPLOAD_DIR` that no version uses and versions whose file is missing; `--delete-orphans` deletes unused uploads that DocDateTrack created and that are older than one hour.
- Configuration through environment variables, validated at startup with clear error messages, including `APP_NAME`, `APP_URL`, `UPLOAD_DIR`, `DATE_LOCALE`, `SESSION_TTL_HOURS`, `COOKIE_SECURE`, `TRUST_PROXY` and `LOG_FORMAT` (see `.env.example` and the configuration reference).
- Health-check endpoint `GET /healthz`.
- Production Docker image for `linux/amd64` and `linux/arm64`, published to the GitHub Container Registry as `ghcr.io/serbantasss/docdatetrack` with the tags `latest`, `1`, `1.2`, `1.2.3`, `edge` (the `main` branch) and `sha-<commit>`. It runs as a non-root user, keeps uploads in the `/data/uploads` volume and has a health check. A Docker workflow builds and smoke-tests the image on every pull request and push, and publishes it for every push to `main` and every release tag.
- Docker Compose setup with MongoDB 8.0 and the volumes `mongo-data` and `uploads`; MongoDB is published on `127.0.0.1` only (`MONGODB_PORT`, default 27018) for local development.
- Idempotent migration script for databases created by the prototype (`npm run db:migrate`, with a `--dry-run` mode).
- Demo data seeder (`npm run db:seed`) with two demo accounts, fictional owners, categories, documents and sample PDFs. It only writes to databases whose name ends in `_dev` or `_demo`, unless `--force` is given.
- Light, dark and automatic colour themes.
- Automated tests (`node:test`, supertest and mongodb-memory-server), ESLint, Prettier, EditorConfig and continuous integration with GitHub Actions, which also audits the production dependencies.
- Documentation: a user guide, deployment guide, configuration reference, upgrade guide and development guide, with screenshots.
- Open-source project files: MIT licence, contributing guide, code of conduct, security policy, this changelog, issue and pull request templates, Dependabot configuration and CODEOWNERS.

### Changed

- Node.js 24 or later is now required. Upgraded to Express 5 and to current releases of Mongoose, Passport, multer, helmet and the other dependencies.
- Owners are now only the people or organisations whose documents are tracked; signing in uses the new user accounts. The migration script turns existing prototype accounts into users.
- Categories have a scope instead of the former relation codes (`DP`, `DF`, `DPF`).
- Document instances are now called versions in the interface and URLs. Their issue and expiry dates are stored as calendar dates, and an uploaded file is stored together with its original name, type and size.
- The user interface was rebuilt with Bootstrap 5.3 and Bootstrap Icons and is now entirely in English. The product name can be changed with `APP_NAME`.
- Forms show validation errors next to each field and keep the values you entered.
- Sessions are stored in MongoDB, so restarting the app no longer signs everyone out; their lifetime is set with `SESSION_TTL_HOURS`. Everyone has to sign in again after upgrading from the prototype.
- The Docker image now runs the application itself instead of only seeding demo data, and the Compose file runs the application together with MongoDB.
- `npm start` and the npm task scripts read `.env` only if it exists; `npm run dev` replaces `npm run devstart` and uses Node.js's built-in file watching instead of nodemon.

### Removed

- The stored document status and the scheduled task that updated it (`tasks/document-status_update.js`); the status is now computed when needed.
- The old email notification task (`tasks/send-email-notification.js`), replaced by the new email reminders.
- The one-shot `seed-demo-data` service and the `docdatetrack-mongo-data` volume of the Compose file; load demo data with `docker compose exec app npm run db:seed` instead.
- Signing out with `GET /logout`; signing out now requires a `POST` request.
- Dependencies that are no longer needed, including `express-async-handler`, `express-fileupload`, `mongoose-autopopulate`, `connect-flash`, `bcryptjs` and `nodemon`.
- Legacy and unused files: the `.oldshiz/` prototype pages, `tasks/add-dummy-data.js`, `tasks/test-db-con.js`, `routes/public.js`, an unrelated Pug/Bootstrap test suite, IDE project files (`.idea/`), and vendored Bootstrap copies and example CSS.
- Leftover branding and placeholder UI: the "Pandora Medical" and "DocTrack" names, non-functional social sign-in buttons, the "CHECK" button and the disabled search box.

### Fixed

- Adding a version for an owner and category that have no document yet now creates the document instead of failing.
- Deleting an owner or a document now really deletes it, together with its versions and uploaded files, and deleting a version no longer causes an error.
- Deleting a category no longer depends on a hard-coded database record, and categories that are still in use cannot be deleted.
- The scope of a new category is now saved, validation messages name the correct fields, and names are no longer HTML-escaped twice.
- The app no longer crashes in production installations (`npm ci --omit=dev`) because of an import from a development-only package.
- Edit links lead to working pages, and the placeholder detail pages for owners and categories were replaced by real ones.
- Status calculations use the version with the latest expiry date (previously the earliest) and handle documents without versions.
- Owner names may contain any characters, such as digits, `&`, commas and parentheses (up to 100 characters each), and phone numbers are free text of up to 40 characters, so extensions fit; previously names were restricted and phone numbers limited to Romanian formats.

### Security

- All pages except sign-in and registration, and all uploaded files, require signing in. Self-registration is closed by default, and user management is restricted to administrators.
- Fixed a path traversal in file downloads: files are only served for existing versions, from their server-generated names inside `UPLOAD_DIR`.
- Upload safeguards: files are limited in size (`MAX_UPLOAD_MB`) and type (PDF, JPEG, PNG, WebP); the type is verified from the file's content, not from its name or the type the browser reports; files are stored under random names; rejected and abandoned uploads are deleted. Downloads are always sent as attachments, with a file name whose extension matches the verified type and `X-Content-Type-Options: nosniff`.
- CSRF protection for all forms and other state-changing requests.
- Security headers through helmet, including a strict Content Security Policy without inline scripts or styles. Bootstrap and Bootstrap Icons are served by the app instead of a CDN. HSTS is left to the TLS-terminating reverse proxy.
- Hardened session cookies (`HttpOnly`, `SameSite=Lax`, and `Secure` over HTTPS via `COOKIE_SECURE`) and support for reverse proxies (`TRUST_PROXY`).
- Changing or resetting a password signs out the user's other sessions.
- Rate limiting of failed sign-in, registration and password-change attempts per client IP; no per-account lock-out.
- `SESSION_SECRET` is required and must be at least 32 characters long in production.
- Dependencies upgraded to resolve known vulnerabilities reported by `npm audit`.

## Earlier versions

Development started in 2023 with a prototype that was never versioned or released, so it has no entries in this changelog. The changelog starts with version 1.0.0.

[Unreleased]: https://github.com/serbantasss/DocDateTrack/commits/main/
