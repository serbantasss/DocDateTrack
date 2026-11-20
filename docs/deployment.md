# Deployment guide

This guide explains how to run DocDateTrack on your own server: with Docker Compose (recommended) or directly with Node.js, behind HTTPS, with email reminders, backups, maintenance and upgrades.

DocDateTrack stores personal data and scans of identity documents. Before you put it into use, also work through the [deployment hardening checklist](../SECURITY.md#deployment-hardening) in the security policy.

## Contents

- [Requirements](#requirements)
- [Quick start with Docker Compose](#quick-start-with-docker-compose)
- [Configuration](#configuration)
- [HTTPS with a reverse proxy](#https-with-a-reverse-proxy)
- [Email reminders](#email-reminders)
- [Backups and restore](#backups-and-restore)
- [Maintenance](#maintenance)
- [Upgrading](#upgrading)
- [Running without Docker](#running-without-docker)
- [Trying DocDateTrack with demo data](#trying-docdatetrack-with-demo-data)
- [Troubleshooting](#troubleshooting)

## Requirements

- **Docker** — Docker Engine with Docker Compose v2 (the `docker compose` command) on Linux, or Docker Desktop. The DocDateTrack image is published for `linux/amd64` and `linux/arm64`.
- **A CPU that can run MongoDB 8.0** — on x86-64 it must support AVX (`grep -m1 -o avx /proc/cpuinfo` prints `avx`); on ARM64 it must be an ARMv8.2-A processor or newer, such as a Raspberry Pi 5 (a Raspberry Pi 4 is not supported).
- **Memory and disk** — at least 1 GB of RAM (2 GB recommended), plus disk space for the database and the uploaded scans.
- **For access over the internet** — a domain name and a reverse proxy that provides HTTPS, see [HTTPS with a reverse proxy](#https-with-a-reverse-proxy).
- **For email reminders** — an account on an SMTP server, for example from your email provider or a transactional email service.
- **One instance** — run a single DocDateTrack container (or Node.js process) per database. The sign-in rate limiter, the safeguard that keeps at least one administrator and the reminder scheduler work within one process, so running several replicas behind a load balancer is not supported.

To run DocDateTrack without Docker, you need Node.js 24 and MongoDB 4.4 or later (8.0 recommended) instead, see [Running without Docker](#running-without-docker).

## Quick start with Docker Compose

1. Create a directory for DocDateTrack and download the Compose file and the example configuration into it:

   ```bash
   mkdir docdatetrack && cd docdatetrack
   curl -fsSLO https://raw.githubusercontent.com/serbantasss/DocDateTrack/main/compose.yaml
   curl -fsSL -o .env https://raw.githubusercontent.com/serbantasss/DocDateTrack/main/.env.example
   ```

2. Generate a session secret:

   ```bash
   openssl rand -hex 32
   ```

   Open `.env` in a text editor and paste the output after `SESSION_SECRET=`. While you are there, set your time zone in the `TZ` line at the end (remove the `#` in front of it, for example `TZ=Europe/Berlin`) and set `APP_URL` to the address people will use to open DocDateTrack. The other settings can keep their defaults for now; [Configuration](#configuration) explains them. On Linux, you can also set the secret with a single command:

   ```bash
   sed -i "s/^SESSION_SECRET=.*/SESSION_SECRET=$(openssl rand -hex 32)/" .env
   ```

3. Start DocDateTrack:

   ```bash
   docker compose up -d
   ```

   Compose downloads the images, starts MongoDB, waits until it is ready and then starts DocDateTrack. After a few seconds, `docker compose ps` shows both containers as `healthy`.

4. Open `http://localhost:8080` (or `http://<server address>:8080`) and **create your account right away**. The first account becomes the administrator — until it exists, anyone who can reach DocDateTrack could claim it. After that, registration is closed: administrators add further accounts under **Users**.

Before you make DocDateTrack reachable from the internet, [set up HTTPS](#https-with-a-reverse-proxy).

Run all `docker compose` commands from this directory, and keep `compose.yaml` and `.env` together. Compose ignores the settings in `.env` that are meant for running Node.js directly (`NODE_ENV`, `PORT`, `MONGODB_URI`, `UPLOAD_DIR` and the built-in HTTPS settings): the container always runs in production mode, with the bundled MongoDB and the uploads volume.

DocDateTrack keeps its data in two Docker volumes: `mongo-data` (the database) and `uploads` (the uploaded files). Docker prefixes their names with the Compose project name — the name of the directory — for example `docdatetrack_uploads`. `docker compose down` keeps the volumes, but **`docker compose down -v` deletes them, and all your data with them**.

| Command                                  | What it does                                                                                         |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `docker compose ps`                      | Shows the containers and their health.                                                               |
| `docker compose logs -f app`             | Follows the log of DocDateTrack (`Ctrl+C` to stop).                                                  |
| `docker compose up -d`                   | Starts everything, and applies changes to `.env` or `compose.yaml`.                                  |
| `docker compose restart app`             | Restarts DocDateTrack.                                                                               |
| `docker compose down`                    | Stops and removes the containers; the data volumes are kept.                                         |
| `docker compose exec app npm run <task>` | Runs a command-line task in the container, for example `reminders:send`, `users` or `uploads:check`. |

Command-line tasks print `.env not found. Continuing without it.` in the container. That is expected: there, the settings come from Compose.

## Configuration

DocDateTrack is configured with environment variables. With Docker Compose, set them in the `.env` file next to `compose.yaml` and run `docker compose up -d` to apply changes. [`.env.example`](../.env.example) lists every setting with its default value and a short explanation, and the [configuration reference](configuration.md) describes each one in detail. DocDateTrack checks the configuration when it starts; if something is wrong, it exits with a message that lists every problem (see `docker compose logs app`).

The most important settings:

| Variable              | Default                 | Description                                                                                                                                                 |
| --------------------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SESSION_SECRET`      | (required)              | Secret used to sign session cookies, at least 32 characters. Generate it with `openssl rand -hex 32` and keep it private. Changing it signs everyone out.   |
| `APP_URL`             | `http://localhost:8080` | The address people use to open DocDateTrack, without a trailing slash, for example `https://docs.example.com`. Used for links in emails.                    |
| `TZ`                  | `UTC` (in Docker)       | Time zone, for example `Europe/Berlin`. Decides what "today" is for expiry dates, and when scheduled reminders are sent.                                    |
| `TRUST_PROXY`         | `false`                 | Set it when DocDateTrack runs behind a reverse proxy, usually to `1`. See [HTTPS with a reverse proxy](#https-with-a-reverse-proxy).                        |
| `COOKIE_SECURE`       | `auto`                  | Set it to `true` once DocDateTrack is only used over HTTPS.                                                                                                 |
| `ALLOW_REGISTRATION`  | `false`                 | `true` lets anyone who can reach DocDateTrack create an account (as a member). The first account can always be created.                                     |
| `EXPIRY_WARNING_DAYS` | `30`                    | Documents that expire within this many days are shown as "expiring soon" and trigger a reminder.                                                            |
| `MAX_UPLOAD_MB`       | `10`                    | Maximum size of an uploaded file, in megabytes.                                                                                                             |
| `DATE_LOCALE`         | `en-GB`                 | How dates are displayed, for example `en-US` or `de-DE`.                                                                                                    |
| `APP_NAME`            | `DocDateTrack`          | Name shown in the interface and in emails.                                                                                                                  |
| `SESSION_TTL_HOURS`   | `12`                    | How long a sign-in lasts without activity; sign-ins with "Keep me signed in" last 30 days.                                                                  |
| `REMINDERS_ENABLED`   | `false`                 | Sends email reminders on a schedule, see [Email reminders](#email-reminders), which also covers `REMINDER_CRON`, `NOTIFY_OWNERS`, `SMTP_*` and `MAIL_FROM`. |

These settings are only used by Docker Compose:

| Variable               | Default        | Description                                                                                                                                         |
| ---------------------- | -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DOCDATETRACK_VERSION` | `latest`       | The image version to run, see [Upgrading](#upgrading).                                                                                              |
| `APP_PORT`             | `8080`         | Port on the server for the web interface. `127.0.0.1:8080` only accepts connections from the server itself, for a reverse proxy on the same server. |
| `MONGODB_DATABASE`     | `docdatetrack` | Name of the database in the bundled MongoDB.                                                                                                        |
| `MONGODB_PORT`         | `27018`        | Port on which the bundled MongoDB is published, on `127.0.0.1` only.                                                                                |

Put values that contain spaces, `#` or `$` in single quotes, for example `SMTP_PASS='my$ecret #1'`.

### Customising the Compose setup

Instead of editing `compose.yaml`, put your changes into a file called `compose.override.yaml` next to it. Compose merges it automatically, and you can replace `compose.yaml` with a newer version without losing your changes.

The bundled MongoDB has no authentication. It only accepts connections from the containers of this Compose project and — for maintenance and local development — from the server itself, on `127.0.0.1` at port `MONGODB_PORT` (27018). If other people have accounts on the server, stop publishing that port with this `compose.override.yaml` (Docker Compose 2.24 or later):

```yaml
services:
  mongo:
    ports: !reset []
```

## HTTPS with a reverse proxy

DocDateTrack serves plain HTTP. To use it over the internet, or on any network you do not fully trust, put a reverse proxy in front of it: the proxy obtains a certificate, handles the HTTPS connections and forwards the requests to DocDateTrack.

Configure DocDateTrack for the proxy in `.env`:

```dotenv
APP_URL=https://docs.example.com
TRUST_PROXY=1
COOKIE_SECURE=true
# The proxy runs on the same server: accept connections from this server only
APP_PORT=127.0.0.1:8080
```

Then apply the changes with `docker compose up -d`.

- **`TRUST_PROXY=1`** tells DocDateTrack that one proxy forwards the requests to it, so that it trusts the `X-Forwarded-Proto` and `X-Forwarded-For` headers set by that proxy. DocDateTrack then recognises HTTPS requests, which it needs for secure cookies, and sees the real client addresses for its logs and for rate limiting. If there is more than one proxy, set the number of proxies, or a comma-separated list of their IP addresses or subnets. Never set `TRUST_PROXY` when clients connect to DocDateTrack directly: they could then fake their address.
- **`COOKIE_SECURE=true`** makes browsers send the session cookie over HTTPS only. The default, `auto`, marks the cookie as secure on HTTPS requests, which DocDateTrack can only recognise behind a proxy when `TRUST_PROXY` is set.
- **`APP_URL`** is used for the links in reminder emails.
- **`APP_PORT=127.0.0.1:8080`** keeps port 8080 private, so that nobody can bypass the proxy. Docker publishes ports past firewalls such as `ufw`, so do not rely on a firewall rule for this.

### Caddy

[Caddy](https://caddyserver.com/) obtains and renews certificates from Let's Encrypt automatically and redirects HTTP to HTTPS. With Caddy installed on the server, add a site to `/etc/caddy/Caddyfile` and reload Caddy (`sudo systemctl reload caddy`):

```caddyfile
docs.example.com {
    reverse_proxy 127.0.0.1:8080
    header Strict-Transport-Security "max-age=31536000"
}
```

Caddy can also run in the same Compose project. Then the app does not need a published port at all, and Caddy reaches it as `app:8080`. Create a `Caddyfile` next to `compose.yaml` with `reverse_proxy app:8080` instead of `reverse_proxy 127.0.0.1:8080`, and this `compose.override.yaml` (Docker Compose 2.24 or later):

```yaml
services:
  caddy:
    image: caddy:2
    restart: unless-stopped
    ports:
      - '80:80'
      - '443:443'
      - '443:443/udp'
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy-data:/data
      - caddy-config:/config
  app:
    ports: !reset []

volumes:
  caddy-data:
  caddy-config:
```

### nginx

With [nginx](https://nginx.org/), obtain a certificate first, for example with [Certbot](https://certbot.eff.org/). Then add a server configuration such as:

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name docs.example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    listen [::]:443 ssl;
    server_name docs.example.com;

    ssl_certificate     /etc/letsencrypt/live/docs.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/docs.example.com/privkey.pem;

    add_header Strict-Transport-Security "max-age=31536000" always;

    # nginx accepts request bodies up to 1 MB by default; allow uploads up to MAX_UPLOAD_MB.
    client_max_body_size 12m;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

### Why the proxy sets HSTS

The `Strict-Transport-Security` (HSTS) header tells browsers to use only HTTPS for a host name from then on — on every port, until the header expires. DocDateTrack does not send it itself, because it cannot know whether every way of reaching it uses HTTPS: many installations are used over plain HTTP on a home or office network, and a browser that has seen the header would refuse such an address. The proxy terminates HTTPS for your domain, so it is the right place for this decision. Start with a short `max-age` while you test your setup, and add `includeSubDomains` only if every subdomain of your domain uses HTTPS.

## Email reminders

DocDateTrack can send email reminders about documents that have expired or are about to expire:

- Every administrator receives a digest of all expired documents and of those that expire within `EXPIRY_WARNING_DAYS`.
- With `NOTIFY_OWNERS=true`, owners that have an email address also receive the reminders about their own documents.
- Each document is mentioned once when it is about to expire and once more when it has expired. DocDateTrack keeps a log of the reminders it has sent, so running the job again does not send duplicates. A new version, or a changed expiry date, starts the reminders over, and emails that could not be sent are tried again on the next run.

Configure the schedule and the SMTP server in `.env`, then run `docker compose up -d`:

```dotenv
REMINDERS_ENABLED=true
# Every day at 08:00 in the time zone TZ (minute hour day-of-month month day-of-week)
REMINDER_CRON='0 8 * * *'
TZ=Europe/Berlin
APP_URL=https://docs.example.com

SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=docdatetrack@example.com
SMTP_PASS='your SMTP password'
MAIL_FROM='DocDateTrack <docdatetrack@example.com>'
```

- Port 587 with `SMTP_SECURE=false` uses STARTTLS; for port 465, set `SMTP_SECURE=true`.
- Instead of `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER` and `SMTP_PASS`, you can set a single URL such as `SMTP_URL='smtps://user:password@smtp.example.com:465'`. Percent-encode special characters in the user name and password.
- Many providers only accept a `MAIL_FROM` address that belongs to your account or to a verified domain.
- `APP_URL` must be the public address of DocDateTrack; otherwise the links in the emails do not work.

The schedule runs inside the app container — you do not need a cron job on the server. The app's log (`docker compose logs app`) confirms the schedule and shows the time of the next run. To check the setup, or to send reminders right away:

```bash
# Send a test email to check the SMTP settings
docker compose exec app npm run reminders:send -- --test you@example.com

# Show who would get which reminders, without sending or recording anything
docker compose exec app npm run reminders:send -- --dry-run

# Send the reminders that are due now
docker compose exec app npm run reminders:send
```

## Backups and restore

A complete backup consists of **both**:

- the **database** — accounts, owners, categories, documents, versions and the reminder log, and
- the **uploaded files** in the `uploads` volume.

The database refers to the files by name: a database without its files has broken downloads, and the files on their own cannot be matched to documents. Also keep a copy of your `.env` file, which contains `SESSION_SECRET` and your SMTP credentials.

Backups contain personal data and scans of identity documents: store them securely, preferably encrypted, and keep a copy away from the server.

### Creating a backup

Run these commands in the directory of `compose.yaml` while DocDateTrack is running. They write the database and the files into the `backups` directory. If you changed `MONGODB_DATABASE`, use its value instead of `docdatetrack`.

```bash
mkdir -p backups
docker compose exec -T mongo mongodump --archive --gzip --db docdatetrack > "backups/db-$(date +%F).archive.gz"
docker compose exec -T app tar -czf - -C /data/uploads . > "backups/uploads-$(date +%F).tar.gz"
```

`-T` matters: without it, Docker would corrupt the binary output. To run backups automatically, put the commands into a script and run it daily, for example from cron:

```bash
#!/bin/sh
# backup.sh: run it daily from cron, for example: 0 3 * * * /opt/docdatetrack/backup.sh
set -eu
cd /opt/docdatetrack # the directory that contains compose.yaml
mkdir -p backups
stamp=$(date +%F)
docker compose exec -T mongo mongodump --archive --gzip --db docdatetrack > "backups/db-$stamp.archive.gz"
docker compose exec -T app tar -czf - -C /data/uploads . > "backups/uploads-$stamp.tar.gz"
# Keep the backups of the last 30 days
find backups -name '*.gz' -mtime +30 -delete
```

Test your backups now and then by restoring them on another machine.

### Restoring a backup

To restore a backup — into an existing installation, or on a new server prepared with steps 1 and 2 of the [quick start](#quick-start-with-docker-compose) — stop DocDateTrack, restore the database and the files, and start it again:

```bash
docker compose up -d mongo
docker compose stop app
docker compose exec -T mongo mongorestore --archive --gzip --drop < backups/db-2026-01-31.archive.gz
docker compose run --rm --no-deps -T app tar -xzf - -C /data/uploads < backups/uploads-2026-01-31.tar.gz
docker compose up -d
```

`--drop` replaces the collections in the database with those from the backup. The restored database keeps its original name, so `MONGODB_DATABASE` must have the same value as when the backup was made. Afterwards, [check the uploaded files](#checking-the-uploaded-files) to make sure that the database and the files match.

## Maintenance

### Checking the uploaded files

The database refers to the uploaded files by name. To check that both still match — after restoring a backup, after moving the installation, or now and then — run:

```bash
docker compose exec app npm run uploads:check
```

It lists the files in the uploads volume that no version uses, and the versions whose file is missing (their downloads fail with "The file of this version is missing."). It exits with `0` when it found no problems, `1` when it found some, and `2` when the check itself failed, so you can also run it from a monitoring script.

Unused files are left behind, for example, by an interrupted deletion or by the 2023 prototype. To delete them, add `--delete-orphans`:

```bash
docker compose exec app npm run uploads:check -- --delete-orphans
```

This only deletes unused files that DocDateTrack created (named `<uuid>.<ext>`) and that are older than one hour, so uploads in progress are never touched. Other files are only reported: check and delete them by hand. Missing files can only be restored from a backup, or uploaded again by editing the version.

### Resetting a password or adding an administrator

Administrators reset other users' passwords under **Users**. If nobody can sign in as an administrator any more — for example because the only administrator has forgotten the password — use the `users` command-line task:

```bash
docker compose exec app npm run users -- list                               # accounts, roles and last sign-ins
docker compose exec app npm run users -- reset-password <username or email> # new random password
docker compose exec app npm run users -- create-admin <username> <email>    # new administrator
docker compose exec app npm run users -- promote <username or email>        # make a user an administrator
```

New passwords are random and shown only once; a password reset also signs the user out everywhere. Sign in with the new password and choose your own on the **Account** page.

## Upgrading

1. Read the [changelog](../CHANGELOG.md) for all versions between yours and the new one.
2. [Back up](#backups-and-restore) the database and the uploaded files.
3. Download the new image and recreate the container:

   ```bash
   docker compose pull
   docker compose up -d
   docker image prune   # optional: removes the old, unused image
   ```

Which version you get depends on `DOCDATETRACK_VERSION` in `.env`:

| Tag                    | Version                                                                           |
| ---------------------- | --------------------------------------------------------------------------------- |
| `latest` (default)     | The latest release.                                                               |
| `1`                    | The latest 1.x release: new features and fixes, but no breaking changes.          |
| `1.2`                  | The latest 1.2.x release: fixes only.                                             |
| `1.2.3`                | Exactly this release; change the tag to upgrade.                                  |
| `edge`, `sha-<commit>` | The latest commit, or a specific commit, of the `main` branch — for testing only. |

Now and then, also compare your `compose.yaml` and `.env` with the versions in the repository, and adopt new settings you want to use.

`docker compose pull` also updates MongoDB to the latest 8.0.x release. Do not change the MongoDB image to a newer major version yourself: MongoDB must be upgraded one major version at a time, following the MongoDB upgrade instructions.

To build the image from the source code instead of downloading it, run `docker compose up -d --build` in a clone of the repository. Compose tags the result with the image name from `compose.yaml`, so set `DOCDATETRACK_VERSION` to a name of your own, such as `local`, to keep it apart from the published releases.

To go back to an earlier version, restore the backup you made before the upgrade; see [Rolling back](upgrading.md#rolling-back) in the upgrade guide.

### Upgrading from the 2023 prototype

The prototype that preceded version 1.0 stored the login accounts on the owners and used a different data model. A migration script converts such a database; the [upgrade guide](upgrading.md#upgrading-from-the-2023-prototype) describes every change in detail and explains its report:

- it moves the login accounts from the owners to the new users collection — the earliest account becomes the administrator, the others become members, and passwords keep working;
- it maps the category relations `DP`, `DF` and `DPF` to the scopes personal, company and employee;
- it renames the fields of the document versions (expiry date, issue date and uploaded file) and removes the stored document status;
- it drops the old unique indexes on the owners.

The script is idempotent: running it again only touches records that still have legacy fields. To migrate:

1. [Back up](#backups-and-restore) the prototype's database and its `uploads` folder.
2. Prepare DocDateTrack with steps 1 and 2 of the [quick start](#quick-start-with-docker-compose), but start only MongoDB for now:

   ```bash
   docker compose up -d mongo
   ```

3. Copy the prototype's database into the bundled MongoDB, under the name set in `MONGODB_DATABASE` (`docdatetrack` by default), and the files from the prototype's `uploads` folder into the uploads volume. For example, if the prototype used the database `olddb`:

   ```bash
   mongodump --uri 'mongodb://old-server:27017/olddb' --archive --gzip > prototype-db.archive.gz
   docker compose exec -T mongo mongorestore --archive --gzip --nsFrom 'olddb.*' --nsTo 'docdatetrack.*' < prototype-db.archive.gz
   tar -czf - -C /path/to/prototype/uploads . | docker compose run --rm --no-deps -T app tar -xzf - -C /data/uploads
   ```

4. Preview the migration, check the report (see [Reading the summary](upgrading.md#reading-the-summary)), and then run it. `docker compose run --rm` runs it in a one-off container, without starting the web server:

   ```bash
   docker compose run --rm app npm run db:migrate -- --dry-run
   docker compose run --rm app npm run db:migrate
   ```

5. Start DocDateTrack with `docker compose up -d`, sign in with your existing user name — the report lists the user names that had to be adapted to the new rules — or your email address, and your password, and check the owners, categories and documents. Everyone has to sign in again after the upgrade.

On an instance that is already running, run the migration with `docker compose exec app npm run db:migrate -- --dry-run`, and then again without `--dry-run`. Until the migration has run, DocDateTrack finds no user accounts and shows the first-run registration page to anyone who opens it — so do not make it reachable for others before the migration, and do not create an account yourself.

## Running without Docker

You need:

- [Node.js 24](https://nodejs.org/) (LTS);
- MongoDB 4.4 or later, 8.0 recommended — installed from the [MongoDB packages](https://www.mongodb.com/docs/manual/administration/install-community/), a hosted MongoDB, or the `mongo` service from `compose.yaml` (`docker compose up -d mongo`, then `MONGODB_URI=mongodb://127.0.0.1:27018/docdatetrack`).

Install DocDateTrack into `/opt/docdatetrack`, owned by root, and create a system user to run it (replace `v1.0.0` with the [latest release](https://github.com/serbantasss/DocDateTrack/releases)):

```bash
sudo useradd --system --no-create-home --home-dir /opt/docdatetrack --shell /usr/sbin/nologin docdatetrack
sudo git clone --depth 1 --branch v1.0.0 https://github.com/serbantasss/DocDateTrack.git /opt/docdatetrack
cd /opt/docdatetrack
sudo npm ci --omit=dev
```

Create the configuration file `/etc/docdatetrack/docdatetrack.env` — see [`.env.example`](../.env.example) for all settings:

```bash
sudo install -d -m 750 -o root -g docdatetrack /etc/docdatetrack
sudoedit /etc/docdatetrack/docdatetrack.env
sudo chown root:docdatetrack /etc/docdatetrack/docdatetrack.env
sudo chmod 640 /etc/docdatetrack/docdatetrack.env
```

```dotenv
NODE_ENV=production
PORT=8080
MONGODB_URI=mongodb://127.0.0.1:27017/docdatetrack
SESSION_SECRET=paste-the-output-of-openssl-rand-hex-32
UPLOAD_DIR=/var/lib/docdatetrack/uploads
APP_URL=https://docs.example.com
TRUST_PROXY=1
COOKIE_SECURE=true
TZ=Europe/Berlin
```

If MongoDB requires authentication, include the credentials in the URI, for example `mongodb://docdatetrack:password@127.0.0.1:27017/docdatetrack`, with special characters in the password percent-encoded.

Create a systemd service, `/etc/systemd/system/docdatetrack.service` (check the path of `node` with `command -v node`):

```ini
[Unit]
Description=DocDateTrack
Documentation=https://github.com/serbantasss/DocDateTrack/blob/main/docs/deployment.md
Wants=network-online.target
After=network-online.target mongod.service

[Service]
Type=simple
User=docdatetrack
Group=docdatetrack
WorkingDirectory=/opt/docdatetrack
EnvironmentFile=/etc/docdatetrack/docdatetrack.env
ExecStart=/usr/bin/node bin/www
Restart=on-failure
RestartSec=5
# Creates /var/lib/docdatetrack, owned by the service user, for UPLOAD_DIR
StateDirectory=docdatetrack
NoNewPrivileges=true
PrivateTmp=true
ProtectHome=true
ProtectSystem=strict

[Install]
WantedBy=multi-user.target
```

Start it, and follow its log:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now docdatetrack
journalctl -u docdatetrack -f
```

Then continue with step 4 of the [quick start](#quick-start-with-docker-compose) and [set up HTTPS](#https-with-a-reverse-proxy). For backups, use `mongodump` against your MongoDB and archive the `UPLOAD_DIR` directory.

To run the command-line tasks, pass the same configuration file to Node.js:

```bash
cd /opt/docdatetrack
sudo -u docdatetrack node --env-file=/etc/docdatetrack/docdatetrack.env tasks/send-reminders.js --test you@example.com
sudo -u docdatetrack node --env-file=/etc/docdatetrack/docdatetrack.env tasks/migrate-legacy-data.js --dry-run
sudo -u docdatetrack node --env-file=/etc/docdatetrack/docdatetrack.env tasks/manage-users.js list
sudo -u docdatetrack node --env-file=/etc/docdatetrack/docdatetrack.env tasks/check-uploads.js
```

To upgrade, check out the new release, reinstall the dependencies and restart the service:

```bash
cd /opt/docdatetrack
sudo git fetch --depth 1 origin tag v1.1.0
sudo git checkout v1.1.0
sudo npm ci --omit=dev
sudo systemctl restart docdatetrack
```

DocDateTrack can also serve HTTPS itself: set `SSL_KEY_PATH` and `SSL_CERT_PATH` to a private key and certificate, and it listens for HTTPS on `PORT_HTTPS` (default `8443`) in addition to HTTP on `PORT`. It reads the files at startup, so it must be restarted after the certificate is renewed — a reverse proxy is usually easier.

## Trying DocDateTrack with demo data

To look around before you enter real data, start a separate demo instance with sample owners, categories, documents and scans:

```bash
mkdir docdatetrack-demo && cd docdatetrack-demo
curl -fsSLO https://raw.githubusercontent.com/serbantasss/DocDateTrack/main/compose.yaml
printf 'SESSION_SECRET=%s\nMONGODB_DATABASE=docdatetrack_demo\n' "$(openssl rand -hex 32)" > .env
docker compose up -d
docker compose exec app npm run db:seed
```

Open `http://localhost:8080` and sign in as `demo` (administrator) or `demo.member` (member), with the password `LocalDemoOnly123!`. To use another password, set `DEMO_USER_PASSWORD` in `.env` before you seed. When you are done, delete the demo instance with all its data: `docker compose down -v`.

Because the demo has its own directory, Compose treats it as a separate project, with its own containers and volumes. If your real instance runs on the same machine, also add other ports to the demo's `.env`, for example `APP_PORT=8081` and `MONGODB_PORT=27019`.

> [!WARNING]
> Never load demo data into a real instance. The demo accounts have a publicly known password, and the sample files are added to the uploads volume. That is why the seeder only writes to databases whose name ends in `_dev` or `_demo` — do not override this with `--force`.

## Troubleshooting

Start with the status of the containers, the log and the health check:

```bash
docker compose ps                      # both containers should be "healthy"
docker compose logs --tail 50 app      # the latest log lines of DocDateTrack
curl -i http://localhost:8080/healthz  # 200 {"status":"ok"}, or 503 if MongoDB is unreachable
```

**DocDateTrack does not start, or keeps restarting.** Check `docker compose logs app`. `Unable to start: Invalid configuration` is followed by a list of the problems, for example a missing `SESSION_SECRET`: fix them in `.env` and run `docker compose up -d`. `Unable to connect to MongoDB` means that the database is not available — see the next item.

**MongoDB does not start.** Check `docker compose logs mongo`. MongoDB 5.0 and later need a CPU with AVX support (x86-64) or an ARMv8.2-A processor (ARM64); otherwise MongoDB exits right away, for example with `Illegal instruction`. In a virtual machine, pass the host's CPU features to the guest (in Proxmox, for example, set the CPU type to `host`).

**You cannot stay signed in.** If signing in brings you back to the sign-in page, or forms fail with "Your session expired. Reload the page and try again.", the browser does not send the session cookie back:

- Behind an HTTPS reverse proxy, set `TRUST_PROXY` (usually `1`). Without it, DocDateTrack cannot tell that a request arrived over HTTPS and does not send a secure session cookie.
- `COOKIE_SECURE=true` requires HTTPS. If you open DocDateTrack over plain HTTP, for example at `http://192.168.1.10:8080`, keep the default `auto`.
- Make sure the proxy forwards the `Host` and `X-Forwarded-Proto` headers, as in the [nginx example](#nginx), and always open DocDateTrack at the same address.

**Uploads fail.**

- A file is rejected as too large: raise `MAX_UPLOAD_MB`. Behind nginx, also raise `client_max_body_size`.
- Only PDF, JPEG, PNG and WebP files are accepted, and the type is checked by looking at the file's content.
- Permission errors, such as `UPLOAD_DIR /data/uploads is not a writable directory` at startup: DocDateTrack runs as the user `node` (UID 1000) in the container. The `uploads` volume from `compose.yaml` has the right owner. If you replaced it with a directory on the server (a bind mount), give that directory to UID 1000, for example `sudo chown -R 1000:1000 ./uploads`.

**Email reminders are not sent.** Look for lines starting with `Email reminders` in `docker compose logs app`. Send a test email with `docker compose exec app npm run reminders:send -- --test you@example.com` to check the SMTP settings, and use `--dry-run` to see whether any reminders are due. Remember that each document is mentioned only once while it is expiring and once after it has expired.

**Nobody can sign in as an administrator.** Reset the password, or create a new administrator, with the [`users` command-line task](#resetting-a-password-or-adding-an-administrator).

**A download fails with "The file of this version is missing."** The version refers to a file that is not in the uploads volume, for example after an incomplete restore. Run [`npm run uploads:check`](#checking-the-uploaded-files) to list all such versions, then restore the files from a backup or upload them again by editing the versions.

**Dates are off by a day, or reminders arrive at the wrong time.** Set `TZ` to your time zone, for example `TZ=Europe/Berlin`, and run `docker compose up -d`.

**A port is already in use.** If `docker compose up` fails with `port is already allocated`, choose another port with `APP_PORT` or `MONGODB_PORT` in `.env`.

**The logs take up a lot of disk space.** By default, Docker keeps container logs without a size limit. [Configure log rotation](https://docs.docker.com/engine/logging/configure/) for the Docker daemon, for example with the `local` logging driver.
