# Contributing to DocDateTrack

Thank you for your interest in DocDateTrack! Contributions of all kinds are welcome — bug reports, feature ideas, documentation improvements, code and code reviews. Whether this is your first open-source contribution or your hundredth, this guide will help you get started.

Everyone taking part in the project is expected to follow our [Code of Conduct](CODE_OF_CONDUCT.md).

Looking for something to work on? Have a look at the issues labelled [good first issue](https://github.com/serbantasss/DocDateTrack/labels/good%20first%20issue) or [help wanted](https://github.com/serbantasss/DocDateTrack/labels/help%20wanted). Documentation lives in [`README.md`](README.md) and [`docs/`](docs/), and improving it is a great first contribution.

## Contents

- [Reporting bugs and requesting features](#reporting-bugs-and-requesting-features)
- [Reporting security issues](#reporting-security-issues)
- [Setting up a development environment](#setting-up-a-development-environment)
- [Tests and quality checks](#tests-and-quality-checks)
- [Project layout](#project-layout)
- [Coding conventions](#coding-conventions)
- [Commit messages](#commit-messages)
- [Pull requests](#pull-requests)
- [Personal data and secrets](#personal-data-and-secrets)
- [Licence](#licence)

## Reporting bugs and requesting features

1. Search the [existing issues](https://github.com/serbantasss/DocDateTrack/issues) first. If someone has already reported the problem or suggested the idea, add your details or a 👍 reaction there instead of opening a duplicate.
2. Otherwise, [open a new issue](https://github.com/serbantasss/DocDateTrack/issues/new/choose) and choose a form:
   - **Bug report** — something is broken or does not work as documented.
   - **Feature request** — an idea for a new feature or an improvement.
3. Fill in the form as completely as you can. Clear steps to reproduce are the most helpful part of a bug report.

Issues are public: remove personal data (names, email addresses, document numbers, scans) and secrets from descriptions, logs and screenshots before posting.

Planning a larger change? Open a feature request first, so that we can agree on the approach before you spend time on a pull request.

## Reporting security issues

Please **do not** open public issues for security vulnerabilities. Report them privately as described in the [security policy](SECURITY.md).

## Setting up a development environment

You need:

- [Git](https://git-scm.com/)
- [nvm](https://github.com/nvm-sh/nvm), or another way to install the Node.js version pinned in `.nvmrc` (Node.js 24)
- [Docker](https://docs.docker.com/get-started/get-docker/) to run MongoDB locally

[Fork the repository](https://github.com/serbantasss/DocDateTrack/fork), then:

```bash
git clone https://github.com/<your-username>/DocDateTrack.git
cd DocDateTrack

nvm install && nvm use      # install and select the Node.js version from .nvmrc
npm ci                      # install the exact dependency versions from package-lock.json

cp .env.example .env
openssl rand -hex 32        # paste the output into SESSION_SECRET in .env

docker compose up -d mongo  # start MongoDB in Docker
npm run db:seed             # optional: load demo data
npm run dev                 # start the app; it restarts when you change a file
```

Then open <http://localhost:8080>. If you skipped the demo data, DocDateTrack starts with the first-run setup: the first account you register becomes the administrator. With the demo data, sign in as `demo` (administrator) or `demo.member` (member) with the password `LocalDemoOnly123!`.

The [development guide](docs/development.md) has the details — the architecture, the demo data, the tests, the conventions, and how to stop or reset the local database — and the [configuration reference](docs/configuration.md) describes every setting. Use only made-up data in your development environment, never real documents.

## Tests and quality checks

These checks must pass before a pull request can be merged, and CI runs them on every pull request:

```bash
npm run lint          # ESLint
npm run format:check  # Prettier
npm test              # test suite
```

- `npm run format` fixes formatting, and `npm run lint -- --fix` fixes many lint problems automatically.
- Add or update tests for every change in behaviour and every bug fix — ideally a test that fails without your change.
- Tests use the built-in [`node:test`](https://nodejs.org/api/test.html) runner and [supertest](https://github.com/ladjs/supertest). They live in `test/`, named `<area>.<topic>.test.js`, and shared helpers (test database, test app, users, signed-in agents, CSRF tokens) are in `test/helpers/`. The [testing section of the development guide](docs/development.md#testing) shows a typical test file.
- Tests run against an in-memory MongoDB server ([mongodb-memory-server](https://github.com/typegoose/mongodb-memory-server)), so you do not need a running database; the first run downloads a MongoDB binary. To use an existing server instead, set `MONGODB_TEST_URI` — each test process then creates its own database there, so never point it at a server that holds real data.
- Keep tests deterministic and offline: pass in the current date (`now`) wherever dates matter, and use temporary directories for uploads.
- To run a single test file, use `node --test test/<file>.test.js`; add `--test-name-pattern="<name>"` to run only the matching tests.

## Project layout

| Path                       | Contents                                                                                                                            |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `app.js`                   | Application factory: `createApp({ config })` sets up the middleware, routes and error handling.                                     |
| `bin/www`                  | Entry point: loads the configuration, connects to MongoDB, starts the HTTP(S) server and the reminder scheduler.                    |
| `config/`                  | Loads and validates the configuration from environment variables (`index.js`), and configures Passport (`passport.js`).             |
| `lib/`                     | Small shared helpers, such as date and file-size formatting for views.                                                              |
| `middleware/`              | Authentication, CSRF protection, rate limiting, flash messages, view locals and error handling.                                     |
| `models/`                  | Mongoose models: users, owners, categories, documents, document versions and the reminder log.                                      |
| `services/`                | Business logic, such as document status (`status.js`, `documents.js`), uploads (`uploads.js`) and email reminders (`reminders.js`). |
| `controllers/`             | Request handlers: validate input, call models and services, render views.                                                           |
| `controllers/userForms.js` | Validation rules and helpers shared by the registration, account and user administration forms.                                     |
| `routes/`                  | Express routers that map URLs to controllers.                                                                                       |
| `views/`                   | Pug templates: the main `layout.pug` and the templates for each page.                                                               |
| `views/layouts/`           | Additional layouts, such as the one for the sign-in pages.                                                                          |
| `views/partials/`          | Shared page fragments, such as the navigation bar and flash messages.                                                               |
| `views/mixins/`            | Reusable form and UI components (`forms.pug`, `ui.pug`, `documents.pug`); each file documents its mixins in a header comment.       |
| `views/emails/`            | Templates of the reminder and test emails.                                                                                          |
| `public/`                  | Static files: the stylesheet, client-side JavaScript and images.                                                                    |
| `tasks/`                   | Command-line tasks: demo data, legacy data migration, email reminders, user accounts and the upload check.                          |
| `test/`                    | Automated tests; shared helpers in `test/helpers/`.                                                                                 |
| `docs/`                    | User, deployment, configuration, upgrade and development guides; screenshots in `docs/images/`.                                     |

The [development guide](docs/development.md) explains how these parts work together.

## Coding conventions

- **JavaScript** — CommonJS modules (`require` / `module.exports`) for Node.js 24. Prefer built-in Node.js features over new dependencies.
- **Formatting and linting** — Prettier (`.prettierrc`) and ESLint (`eslint.config.js`) settle all style questions: 2-space indentation, single quotes and semicolons. Most editors also pick up `.editorconfig`.
- **Express 5** — route handlers can be `async` functions: if they throw or reject, Express passes the error to the error handler. Do not wrap them in helpers such as `express-async-handler`, and do not swallow errors. Give errors an HTTP status (for example with `http-errors`) and let the error handler render them.
- **Configuration** — application code reads settings from the validated configuration object (`req.app.get('config')` in controllers), not from `process.env`. A new setting belongs in `config/index.js`, `.env.example`, `compose.yaml` (if the container needs it) and the [configuration reference](docs/configuration.md).
- **Dates** — issue and expiry dates are calendar dates stored as UTC midnight. Parse `YYYY-MM-DD` as UTC and format dates in the `utc` zone, using the helpers in `services/status.js` and `lib/format.js`.
- **Views and Content Security Policy** — the app sends a strict CSP, so views must not contain inline `<script>` blocks, `on*=` event-handler attributes or `style=` attributes. Put behaviour in `public/js/`, hooked up through `data-*` attributes, and styles in `public/stylesheets/app.css`. Never load assets from a CDN or another external URL: add front-end libraries as npm dependencies and serve them from the app, as is done for Bootstrap and Bootstrap Icons. Output user data with Pug's escaping syntax (`=`, `#{}`), never the unescaped `!=` or `!{}`.
- **Forms** — use the mixins in `views/mixins/`; they add the CSRF token and the method override for `PUT` and `DELETE`. Validate input with express-validator, re-render invalid forms with status 422, `errors` (from `.mapped()`) and the submitted `values`, and redirect after successful changes (Post/Redirect/Get) with a flash message. Routes that accept `multipart/form-data` must call `verifyCsrf` right after the upload middleware, as in `uploadSingle('file'), verifyCsrf` in `routes/versions.js`.
- **Comments** — add comments where the code needs clarification, and do not leave dead or commented-out code behind.
- **Dependencies** — add new ones sparingly, explain why in your pull request, and commit the updated `package-lock.json`.

## Commit messages

We recommend [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/):

```text
feat(reminders): include the owner's name in digest emails
fix: keep form values when an upload is rejected
docs: explain TRUST_PROXY for reverse proxies
```

Common types are `feat`, `fix`, `docs`, `refactor`, `test`, `build`, `ci` and `chore`. Mark breaking changes with a `!` after the type (`feat!: …`) or a `BREAKING CHANGE:` footer. Write the subject line in the imperative mood and keep it short.

## Pull requests

1. For anything larger than a small fix, open an issue first to discuss the change.
2. Fork the repository and create a branch from `main`, for example `fix/upload-error-message`.
3. Make your change, including tests and documentation, and keep the pull request focused on a single topic.
4. Run `npm run lint`, `npm run format:check` and `npm test`.
5. Add a short entry to the `Unreleased` section of [`CHANGELOG.md`](CHANGELOG.md) for user-visible changes.
6. Open a pull request against `main` and fill in the template. Link the related issue (for example `Closes #123`) and add screenshots for UI changes, using made-up data.
7. Make sure the CI checks pass. A maintainer will review your pull request; respond to feedback by pushing new commits to the same branch.

Please allow edits from maintainers, so that we can help with small fixes before merging. Do not worry if something is not perfect — we are happy to help you get your pull request ready.

## Personal data and secrets

DocDateTrack handles personal documents, so please be careful:

- **Never commit secrets** — passwords, `SESSION_SECRET` values, SMTP credentials, API keys or connection strings that contain credentials. `.env` files are ignored by Git; keep it that way.
- **Never commit or share real personal data** — no real names, document numbers, scans or email addresses in code, tests, fixtures, screenshots, issues or pull requests. Use invented names and `example.com` or `example.test` email addresses. The `uploads/` directory is ignored by Git.
- If you accidentally publish a secret, treat it as compromised and revoke or rotate it immediately — removing it in a later commit is not enough. If it belongs to the project, tell the maintainer privately as described in the [security policy](SECURITY.md).

## Licence

By contributing, you agree that your contributions will be licensed under the project's [MIT License](LICENSE).

Thank you for helping to make DocDateTrack better!
