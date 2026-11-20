# Configuration reference

DocDateTrack is configured entirely with environment variables. This page lists every variable with its default value, the values it accepts and what it affects. For a ready-made starting point, copy [`.env.example`](../.env.example), which contains every setting with a short comment.

## Contents

- [How the configuration is loaded](#how-the-configuration-is-loaded)
- [Overview](#overview)
- [Server](#server)
- [Database](#database)
- [Sessions and security](#sessions-and-security)
- [Documents and uploads](#documents-and-uploads)
- [Email reminders and SMTP](#email-reminders-and-smtp)
- [Built-in HTTPS](#built-in-https)
- [Docker Compose](#docker-compose)
- [Demo data and tests](#demo-data-and-tests)
- [Notes](#notes): [booleans](#booleans), [cron syntax](#cron-syntax), [time zones](#time-zones), [reverse proxies](#reverse-proxies), [rate limiting](#rate-limiting)

## How the configuration is loaded

- **npm scripts** — `npm start`, `npm run dev` and the command-line tasks (`npm run db:seed`, `npm run db:migrate`, `npm run reminders:send`, `npm run users`, `npm run uploads:check`) read the file `.env` in the project directory, if it exists; without it, Node.js prints the harmless notice `.env not found. Continuing without it.` Variables that are already set in the environment take precedence over `.env`, so `PORT=8081 npm run dev` works as expected.
- **Node.js directly** — `node bin/www` and `node tasks/<task>.js` do not read `.env`. Set the variables in the environment, pass a file with `node --env-file=<file> bin/www`, or use `EnvironmentFile=` in a systemd service (see [Running without Docker](deployment.md#running-without-docker)).
- **Docker Compose** — Compose reads the `.env` file next to `compose.yaml` and passes only the settings listed in `compose.yaml` to the container. `NODE_ENV`, `PORT`, `MONGODB_URI` and `UPLOAD_DIR` are fixed there (production mode, port 8080, the bundled MongoDB and the `uploads` volume), and the [built-in HTTPS](#built-in-https) settings are not passed on. Variables set in your shell take precedence over `.env`.

In `.env` files, write one `NAME=value` per line, keep comments on their own lines, and put values that contain spaces, `#` or `$` in single quotes, for example `SMTP_PASS='my$ecret #1'`. An empty value, such as `APP_URL=`, means "use the default".

DocDateTrack checks the whole configuration when it starts. If anything is wrong, it exits with a message that lists every problem, for example:

```text
Unable to start: Invalid configuration:
  - SESSION_SECRET must be at least 32 characters long in production.
  - TRUST_PROXY must be false, true, a hop count, or a comma-separated list of IP addresses/subnets (or loopback, linklocal, uniquelocal), got "maybe".
```

The command-line tasks check the same settings, except that they do not need `SESSION_SECRET`.

## Overview

| Variable                                                           | Default                           | Summary                                                      |
| ------------------------------------------------------------------ | --------------------------------- | ------------------------------------------------------------ |
| **Server**                                                         |                                   |                                                              |
| [`NODE_ENV`](#node_env)                                            | `development`                     | `production` for real installations.                         |
| [`PORT`](#port)                                                    | `8080`                            | HTTP port.                                                   |
| [`APP_URL`](#app_url)                                              | `http://localhost:<PORT>`         | Public address, used for links in emails.                    |
| [`APP_NAME`](#app_name)                                            | `DocDateTrack`                    | Name shown in the interface and in emails.                   |
| [`LOG_FORMAT`](#log_format)                                        | `dev` / `combined`                | Request log format.                                          |
| **Database**                                                       |                                   |                                                              |
| [`MONGODB_URI`](#mongodb_uri)                                      | (required)                        | MongoDB connection string, including the database name.      |
| **Sessions and security**                                          |                                   |                                                              |
| [`SESSION_SECRET`](#session_secret)                                | (required)                        | Secret that signs the session cookies.                       |
| [`SESSION_TTL_HOURS`](#session_ttl_hours)                          | `12`                              | How long a sign-in lasts without activity.                   |
| [`COOKIE_SECURE`](#cookie_secure)                                  | `auto`                            | When session cookies are marked as HTTPS-only.               |
| [`TRUST_PROXY`](#trust_proxy)                                      | `false`                           | Which reverse proxies to trust.                              |
| [`ALLOW_REGISTRATION`](#allow_registration)                        | `false`                           | Let anyone create a member account.                          |
| **Documents and uploads**                                          |                                   |                                                              |
| [`UPLOAD_DIR`](#upload_dir)                                        | `uploads`                         | Where uploaded files are stored.                             |
| [`MAX_UPLOAD_MB`](#max_upload_mb)                                  | `10`                              | Maximum size of an uploaded file.                            |
| [`EXPIRY_WARNING_DAYS`](#expiry_warning_days)                      | `30`                              | When a document counts as "expiring soon".                   |
| [`DATE_LOCALE`](#date_locale)                                      | `en-GB`                           | How dates are displayed.                                     |
| **Email reminders and SMTP**                                       |                                   |                                                              |
| [`REMINDERS_ENABLED`](#reminders_enabled)                          | `false`                           | Send reminders on a schedule.                                |
| [`REMINDER_CRON`](#reminder_cron)                                  | `0 8 * * *`                       | When reminders are sent.                                     |
| [`NOTIFY_OWNERS`](#notify_owners)                                  | `false`                           | Also email owners about their own documents.                 |
| [`SMTP_URL`](#smtp_url)                                            | —                                 | SMTP server as a single URL.                                 |
| [`SMTP_HOST`](#smtp_host)                                          | —                                 | SMTP server host name.                                       |
| [`SMTP_PORT`](#smtp_port)                                          | `587`                             | SMTP server port.                                            |
| [`SMTP_SECURE`](#smtp_secure)                                      | `false`                           | Use TLS from the start of the connection.                    |
| [`SMTP_USER`, `SMTP_PASS`](#smtp_user-and-smtp_pass)               | —                                 | SMTP credentials.                                            |
| [`MAIL_FROM`](#mail_from)                                          | `<APP_NAME> <no-reply@localhost>` | Sender address of the emails.                                |
| **Built-in HTTPS**                                                 |                                   |                                                              |
| [`SSL_KEY_PATH`, `SSL_CERT_PATH`](#ssl_key_path-and-ssl_cert_path) | —                                 | Private key and certificate for HTTPS.                       |
| [`PORT_HTTPS`](#port_https)                                        | `8443`                            | HTTPS port.                                                  |
| **Docker Compose**                                                 |                                   |                                                              |
| [`DOCDATETRACK_VERSION`](#docdatetrack_version)                    | `latest`                          | Image version to run.                                        |
| [`APP_PORT`](#app_port)                                            | `8080`                            | Host port of the web interface.                              |
| [`MONGODB_DATABASE`](#mongodb_database)                            | `docdatetrack`                    | Database name in the bundled MongoDB.                        |
| [`MONGODB_PORT`](#mongodb_port)                                    | `27018`                           | Host port of the bundled MongoDB, on `127.0.0.1` only.       |
| [`TZ`](#tz)                                                        | `UTC` (Compose), system (Node.js) | Time zone for "today", timestamps and the reminder schedule. |
| **Demo data and tests**                                            |                                   |                                                              |
| [`DEMO_USER_PASSWORD`](#demo_user_password)                        | `LocalDemoOnly123!`               | Password of the demo accounts.                               |
| [`MONGODB_TEST_URI`](#mongodb_test_uri)                            | —                                 | Run the tests against an existing MongoDB server.            |

## Server

### `NODE_ENV`

- **Default:** `development`. The Docker image and the Compose file use `production`.
- **Accepted values:** any text; `production`, `development` and `test` have a special meaning.

Use `production` for every real installation. DocDateTrack then caches compiled views, lets browsers cache static files for an hour, requires a [`SESSION_SECRET`](#session_secret) of at least 32 characters, and uses `combined` as the default [`LOG_FORMAT`](#log_format). Only `development` shows stack traces on error pages; `test` turns off the request log by default and is used by the test suite.

### `PORT`

- **Default:** `8080`
- **Accepted values:** a whole number from 0 to 65535. `0` picks a free port; the log shows which one.

The port of the HTTP server. If it is taken, DocDateTrack exits with `HTTP port 8080 is already in use.` In the container the port is always 8080; use [`APP_PORT`](#app_port) to choose the port on the host.

### `APP_URL`

- **Default:** `http://localhost:<PORT>`
- **Accepted values:** an absolute `http://` or `https://` URL without a query string or fragment, for example `https://docs.example.com`. Trailing slashes are removed.

The address people use to open DocDateTrack. It is used for the links and the "Open DocDateTrack" button in reminder emails, in the test email, and in the startup message. Set it whenever you use email reminders or run DocDateTrack behind a reverse proxy; while it points to `localhost`, `127.0.0.1` or `[::1]`, the reminder scheduler and `npm run reminders:send` warn that the links in emails only work on that computer.

DocDateTrack must be served at the root of a host name, such as `https://docs.example.com/`. Serving it under a path prefix, such as `https://example.com/docs/`, is not supported, because its pages link to absolute paths like `/documents`.

### `APP_NAME`

- **Default:** `DocDateTrack`
- **Accepted values:** any text up to 100 characters.

The product name shown in the navigation bar, page titles (`Dashboard · DocDateTrack`), the sign-in and registration pages and the footer, in email subjects (`[DocDateTrack] 2 documents expired`) and texts, and in the default [`MAIL_FROM`](#mail_from).

### `LOG_FORMAT`

- **Default:** `dev` when `NODE_ENV=development`, `none` when `NODE_ENV=test`, otherwise `combined`.
- **Accepted values:** `combined`, `common`, `dev`, `short`, `tiny`, `none`, or a custom [morgan](https://github.com/expressjs/morgan#tokens) format that contains at least one `:token`, for example `':remote-addr :method :url :status :response-time ms'`.

The format of the request log, which is written to standard output. `none` turns the request log off; startup messages, warnings and errors are always printed. Successful health checks (`GET /healthz`) are never logged. Behind a reverse proxy, the logged client address is only correct when [`TRUST_PROXY`](#trust_proxy) is set.

## Database

### `MONGODB_URI`

- **Default:** none — required by the server and by every command-line task.
- **Accepted values:** a MongoDB connection string that starts with `mongodb://` or `mongodb+srv://` and names the database, for example `mongodb://127.0.0.1:27017/docdatetrack`.

DocDateTrack keeps all records in this database, as well as the sign-in sessions (collection `sessions`) and the reminder log. If the server requires authentication, include the credentials, with special characters percent-encoded, for example `mongodb://docdatetrack:p%40ssword@db.internal:27017/docdatetrack?authSource=admin`.

The server connects when it starts and exits with `Unable to connect to MongoDB at …` if the database cannot be reached within 10 seconds; after that, it reconnects automatically. MongoDB 4.4 or later is required, 8.0 is recommended. With Docker Compose, the URI is fixed to the bundled MongoDB; choose the database name with [`MONGODB_DATABASE`](#mongodb_database).

## Sessions and security

### `SESSION_SECRET`

- **Default:** none — required by the server (the command-line tasks do not need it).
- **Accepted values:** any text; at least 32 characters when `NODE_ENV=production`.

The secret that signs the session cookies. Generate a random one with `openssl rand -hex 32` and keep it private: it protects the session cookies against tampering. Changing it signs everyone out.

### `SESSION_TTL_HOURS`

- **Default:** `12`
- **Accepted values:** a number greater than 0 and at most 8760 (one year); decimals are allowed, for example `0.5`.

How long a sign-in lasts without activity. Every request extends the session; after this many hours without one, the user has to sign in again. Without **Keep me signed in**, the browser also forgets the sign-in when it is closed. With **Keep me signed in**, the sign-in lasts 30 days instead, also across browser restarts. Independently of this setting, changing or resetting a password signs out the user's other sessions.

### `COOKIE_SECURE`

- **Default:** `auto`
- **Accepted values:** `auto`; `true`, `1` or `yes`; `false`, `0` or `no` (case-insensitive).

Controls the `Secure` attribute of the session cookie, which tells browsers to send it over HTTPS only:

- `auto` marks the cookie as secure when the request arrived over HTTPS.
- `true` always marks it as secure. Use it once DocDateTrack is only reached over HTTPS. DocDateTrack then only sets the cookie on requests that it recognises as HTTPS, so signing in over plain HTTP no longer works.
- `false` never marks it as secure.

Behind a reverse proxy, DocDateTrack only recognises HTTPS requests when [`TRUST_PROXY`](#trust_proxy) is set — without it, `auto` never marks the cookie as secure, and with `true` nobody can sign in.

The session cookie (`ddt.sid`) is always `HttpOnly` and `SameSite=Lax`.

### `TRUST_PROXY`

- **Default:** `false`
- **Accepted values:**
  - `false` or `no` — trust no proxy (connect directly);
  - a whole number — the number of proxies in front of DocDateTrack, usually `1` (`0` means `false`);
  - a comma-separated list of the proxies' IP addresses or subnets, such as `127.0.0.1`, `10.0.0.0/8` or `fd00::/8`, and the presets `loopback`, `linklocal` and `uniquelocal`;
  - `true` or `yes` — trust every proxy. Avoid it: any client could then fake its address.

Set it when DocDateTrack runs behind a reverse proxy, so that it trusts the `X-Forwarded-For`, `X-Forwarded-Proto` and `X-Forwarded-Host` headers of that proxy. DocDateTrack then sees the real client address, which the [rate limiting](#rate-limiting) and the request log rely on, and recognises HTTPS requests for [`COOKIE_SECURE=auto`](#cookie_secure). Never set it when clients connect to DocDateTrack directly. See [Reverse proxies](#reverse-proxies).

### `ALLOW_REGISTRATION`

- **Default:** `false`
- **Accepted values:** a [boolean](#booleans).

With `true`, the sign-in page links to a registration form, and anyone who can reach DocDateTrack can create an account with the **member** role. With `false`, only administrators add accounts, under **Users**. Either way, the very first account can always be created while no account exists; it becomes the administrator.

## Documents and uploads

### `UPLOAD_DIR`

- **Default:** `uploads` in the project directory. Docker Compose: `/data/uploads`, the `uploads` volume (fixed).
- **Accepted values:** a directory path. Relative paths are resolved from the project directory (the directory of `package.json`), not from the current directory.

Where uploaded files are stored, under random names such as `0b6c3f1e-….pdf`; their original names are kept in the database. DocDateTrack creates the directory when it starts and exits with `UPLOAD_DIR … is not a writable directory` if it cannot write to it. Keep it outside `public/` and any directory served by a web server, and back it up together with the database — see [Backups and restore](deployment.md#backups-and-restore).

### `MAX_UPLOAD_MB`

- **Default:** `10`
- **Accepted values:** a number greater than 0 and at most 1024, in megabytes; decimals are allowed, for example `2.5`.

The maximum size of one uploaded file. The browser refuses larger files before sending them, and the server rejects them with a message next to the file field. Reverse proxies have their own limit, which must be a little higher — nginx, for example, accepts only 1 MB by default (`client_max_body_size`).

### `EXPIRY_WARNING_DAYS`

- **Default:** `30`
- **Accepted values:** a whole number from 0 to 3650.

A document is **Expiring soon** when its current version expires within this many days, counting today; with `0`, only on its expiry date itself. The same threshold decides when the "expiring soon" reminder is sent, and the demo data adapts its sample dates to it. See [Statuses](user-guide.md#statuses).

### `DATE_LOCALE`

- **Default:** `en-GB`
- **Accepted values:** a language tag that Node.js supports, such as `en-US`, `de-DE` or `fr-FR`.

How dates and times are displayed in the web interface and in emails: `en-GB` shows `7 Dec 2026`, `en-US` shows `Dec 7, 2026`, and `de-DE` shows `7. Dez. 2026`. The interface itself stays in English, and date fields in forms follow the language of the browser.

## Email reminders and SMTP

See [Email reminders](deployment.md#email-reminders) in the deployment guide for a complete example, and [Email reminders](user-guide.md#email-reminders) in the user guide for what people receive.

### `REMINDERS_ENABLED`

- **Default:** `false`
- **Accepted values:** a [boolean](#booleans).

With `true`, the server sends reminders on the [`REMINDER_CRON`](#reminder_cron) schedule — but only if an SMTP server is configured ([`SMTP_URL`](#smtp_url) or [`SMTP_HOST`](#smtp_host)); otherwise it logs a warning and sends nothing. At startup, the log shows the schedule and the next run, for example `Email reminders are on: schedule "0 8 * * *" (Europe/Berlin), next run 18 Nov 2026, 08:00`. Run a single DocDateTrack instance per database (see [Requirements](deployment.md#requirements)); reminders are sent by that instance.

`npm run reminders:send` sends the due reminders right away, whatever this setting says.

### `REMINDER_CRON`

- **Default:** `0 8 * * *` (every day at 08:00)
- **Accepted values:** a five-field [cron expression](#cron-syntax), interpreted in the server's [time zone](#time-zones).

When the server sends reminders. The expression is checked at startup even while reminders are off; an invalid one stops the server with a message such as `REMINDER_CRON must be a cron expression (minute hour day-of-month month day-of-week) such as "0 8 * * *" for every day at 08:00, got "0 25 * * *"`. Each document is only mentioned once per stage, so a more frequent schedule picks up changes sooner without repeating reminders.

### `NOTIFY_OWNERS`

- **Default:** `false`
- **Accepted values:** a [boolean](#booleans).

Administrators always receive a digest of all expired and expiring documents. With `true`, owners that have an email address also receive the reminders about their own documents. Every address gets at most one email per run; an owner address that belongs to an administrator gets the administrator's digest.

### `SMTP_URL`

- **Default:** none
- **Accepted values:** an `smtp://` or `smtps://` URL, for example `smtps://user:password@smtp.example.com:465`. Percent-encode special characters in the user name and password.

The SMTP server as a single setting. When it is set, `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER` and `SMTP_PASS` are ignored.

### `SMTP_HOST`

- **Default:** none
- **Accepted values:** a host name or IP address, such as `smtp.example.com`.

The SMTP server. Email counts as configured when `SMTP_URL` or `SMTP_HOST` is set; without either, reminders are not sent and `npm run reminders:send` reports `Email is not configured.`

### `SMTP_PORT`

- **Default:** `587`
- **Accepted values:** a whole number from 1 to 65535.

The port of the SMTP server: usually `587` (STARTTLS) or `465` (TLS).

### `SMTP_SECURE`

- **Default:** `false`
- **Accepted values:** a [boolean](#booleans).

With `true`, the connection uses TLS from the start, as port 465 expects. With `false`, DocDateTrack connects without TLS and switches to TLS with STARTTLS if the server offers it, as is usual on port 587. Port 465 always uses TLS, whatever this setting says.

### `SMTP_USER` and `SMTP_PASS`

- **Default:** none
- **Accepted values:** any text. Put the password in single quotes in `.env` if it contains spaces, `#` or `$`.

The credentials of your SMTP account. DocDateTrack only authenticates when `SMTP_USER` is set.

### `MAIL_FROM`

- **Default:** the app name with `no-reply@localhost`, for example `DocDateTrack <no-reply@localhost>`.
- **Accepted values:** an email address, optionally with a name: `'DocDateTrack <docdatetrack@example.com>'`.

The sender of reminders and test emails. Set it whenever you configure SMTP: many providers only accept an address that belongs to your account or to a verified domain. To check the settings, send a test email with `npm run reminders:send -- --test you@example.com` (with Docker: `docker compose exec app npm run reminders:send -- --test you@example.com`).

## Built-in HTTPS

DocDateTrack can serve HTTPS itself, in addition to HTTP. A [reverse proxy](deployment.md#https-with-a-reverse-proxy) is usually the better option: it renews certificates automatically, redirects HTTP to HTTPS and sets HSTS. The Compose file does not pass these settings to the container.

### `SSL_KEY_PATH` and `SSL_CERT_PATH`

- **Default:** none (HTTPS off)
- **Accepted values:** paths to a PEM private key and the matching PEM certificate (with its chain). Set both or neither. Relative paths are resolved from the project directory.

With both set, DocDateTrack also listens for HTTPS on [`PORT_HTTPS`](#port_https); plain HTTP on [`PORT`](#port) keeps working and is not redirected. The files are read at startup, so restart DocDateTrack after the certificate is renewed. If a file cannot be read, it exits with `Unable to read SSL_KEY_PATH (…)`.

### `PORT_HTTPS`

- **Default:** `8443`
- **Accepted values:** a whole number from 0 to 65535.

The port of the HTTPS server, used only when `SSL_KEY_PATH` and `SSL_CERT_PATH` are set.

## Docker Compose

These variables are used by [`compose.yaml`](../compose.yaml), together with the settings above that it passes to the container; `TZ` also applies when you run Node.js directly. See the [deployment guide](deployment.md) for how to use them.

### `DOCDATETRACK_VERSION`

- **Default:** `latest`
- **Accepted values:** a tag of the `ghcr.io/serbantasss/docdatetrack` image: `latest` (the latest release), a major version such as `1`, a minor version such as `1.2`, an exact version such as `1.2.3`, `edge` (the `main` branch) or `sha-<commit>`.

The image version to run; see [Upgrading](upgrading.md). To build the image from a clone of the repository instead, choose a name of your own: `DOCDATETRACK_VERSION=local docker compose up -d --build`.

### `APP_PORT`

- **Default:** `8080`
- **Accepted values:** a port, optionally with an address: `8080` accepts connections on every network interface, `127.0.0.1:8080` only from the server itself — for a reverse proxy on the same server.

Where Compose publishes the web interface on the host.

### `MONGODB_DATABASE`

- **Default:** `docdatetrack`
- **Accepted values:** a MongoDB database name.

The name of the database in the bundled MongoDB. Use `docdatetrack_demo` for a [demo instance](deployment.md#trying-docdatetrack-with-demo-data): the demo data seeder only writes to databases whose name ends in `_dev` or `_demo`. Changing it later makes DocDateTrack start with a new, empty database; the old one is kept.

### `MONGODB_PORT`

- **Default:** `27018`
- **Accepted values:** a port number.

The port on `127.0.0.1` at which the bundled MongoDB is published, for maintenance and for [local development](development.md) (`docker compose up -d mongo`). When you run Node.js on your machine against it, keep the port in `MONGODB_URI` the same. The bundled MongoDB has no authentication; see [Customising the Compose setup](deployment.md#customising-the-compose-setup) to stop publishing it.

### `TZ`

- **Default:** `UTC` with Docker Compose; outside Docker, the system time zone.
- **Accepted values:** a time zone name from the [tz database](https://en.wikipedia.org/wiki/List_of_tz_database_time_zones), such as `Europe/Berlin` or `America/New_York`.

The time zone of the server, which decides what "today" is, how timestamps are shown and when scheduled reminders are sent — see [Time zones](#time-zones). Compose passes it to the container; Node.js outside Docker also honours it. Never set it to an empty value: Node.js then cannot tell which time zone it is in.

## Demo data and tests

### `DEMO_USER_PASSWORD`

- **Default:** `LocalDemoOnly123!`
- **Accepted values:** any text.

The password that `npm run db:seed` gives the demo accounts `demo` (administrator) and `demo.member` (member) when it creates them; existing accounts keep their password. Only used by the seeder, which only writes to databases whose name ends in `_dev` or `_demo`. Never load demo data into a real instance.

### `MONGODB_TEST_URI`

- **Default:** none — the tests start an in-memory MongoDB server.
- **Accepted values:** a MongoDB connection string, for example `mongodb://127.0.0.1:27017`. A database name in it is ignored.

Used only by `npm test`. Each test process then creates its own database (`docdatetrack_test_<process>_<random>`) on that server and drops it at the end. Never point it at a server that holds real data. See [Testing](development.md#testing).

## Notes

### Booleans

Boolean settings accept `true`, `1` or `yes` and `false`, `0` or `no`, in any letter case. Any other value is a configuration error. Two settings accept more: [`COOKIE_SECURE`](#cookie_secure) also accepts `auto`, and in [`TRUST_PROXY`](#trust_proxy) a number is a count of proxies, so `TRUST_PROXY=1` means "one proxy", not "true".

### Cron syntax

[`REMINDER_CRON`](#reminder_cron) uses the five fields of the classic cron format, separated by spaces:

```text
┌──────── minute (0–59)
│ ┌────── hour (0–23)
│ │ ┌──── day of the month (1–31)
│ │ │ ┌── month (1–12 or jan–dec)
│ │ │ │ ┌ day of the week (0–7 or sun–sat; 0 and 7 are Sunday)
│ │ │ │ │
0 8 * * *
```

Each field accepts `*` (every value), a number or name, a list (`8,17`), a range (`1-5`) and a step (`*/6`).

| Expression        | Runs                                     |
| ----------------- | ---------------------------------------- |
| `0 8 * * *`       | Every day at 08:00 (the default).        |
| `30 7 * * 1-5`    | Monday to Friday at 07:30.               |
| `0 8 * * mon`     | Every Monday at 08:00.                   |
| `0 7 * * sat,sun` | Saturdays and Sundays at 07:00.          |
| `0 8,17 * * *`    | Every day at 08:00 and 17:00.            |
| `0 */6 * * *`     | Every six hours, at 00:00, 06:00, 12:00… |
| `0 9 1 * *`       | On the first day of every month, 09:00.  |

The times are in the server's [time zone](#time-zones). In `.env`, put the expression in single quotes: `REMINDER_CRON='30 7 * * 1-5'`.

### Time zones

Issue and expiry dates are calendar dates without a time of day. To compute the status of a document, DocDateTrack compares the expiry date with today's date **in the server's time zone**: a document that expires on 7 December is "Expiring soon" (or "Valid") until the end of 7 December and "Expired" from 8 December. The time zone also decides how timestamps, such as "Uploaded 17 Nov 2026, 22:14", are displayed, and when the [`REMINDER_CRON`](#reminder_cron) schedule fires.

Docker containers run in UTC unless you set [`TZ`](#tz), so set it to your own time zone, for example `TZ=Europe/Berlin`. Changing the time zone never changes the stored dates.

### Reverse proxies

Behind a reverse proxy that terminates HTTPS, set three things:

```dotenv
# The address people use, for links in emails
APP_URL=https://docs.example.com
# One proxy forwards the requests: trust its X-Forwarded-* headers
TRUST_PROXY=1
# Send the session cookie over HTTPS only
COOKIE_SECURE=true
```

- [`TRUST_PROXY`](#trust_proxy) lets DocDateTrack see the real client address and recognise HTTPS requests. Without it, all clients appear to come from the proxy — they share one [rate limit](#rate-limiting) — and with `COOKIE_SECURE=true` nobody can sign in.
- [`COOKIE_SECURE=true`](#cookie_secure) guarantees that the session cookie never travels over plain HTTP.
- [`APP_URL`](#app_url) makes the links in emails point to the public address.

The proxy must forward the original `Host` header and set `X-Forwarded-Proto`, and its request size limit must allow uploads of [`MAX_UPLOAD_MB`](#max_upload_mb). With Docker Compose, also set `APP_PORT=127.0.0.1:8080` when the proxy runs on the same server, so that nobody can bypass it. The deployment guide has complete [Caddy and nginx examples](deployment.md#https-with-a-reverse-proxy).

### Rate limiting

Failed sign-in, registration and password-change attempts are limited per client IP address: after 10 failed attempts within 15 minutes, further attempts from that address are refused for the rest of the 15 minutes with "Too many attempts. Please wait a few minutes and try again." Successful attempts do not count, and accounts are never locked. These limits are built in and cannot be configured. Behind a reverse proxy, set [`TRUST_PROXY`](#trust_proxy), so that the limit applies to each client rather than to the proxy.
