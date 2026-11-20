# Upgrading

This guide explains how to upgrade DocDateTrack to a new release, how to roll back, and how to move the data of the 2023 prototype to version 1.0.

## Contents

- [Before you upgrade](#before-you-upgrade)
- [Upgrading with Docker Compose](#upgrading-with-docker-compose)
- [Upgrading without Docker](#upgrading-without-docker)
- [Rolling back](#rolling-back)
- [Upgrading from the 2023 prototype](#upgrading-from-the-2023-prototype)

## Before you upgrade

1. **Read the [changelog](../CHANGELOG.md)** for every version between yours and the new one. DocDateTrack follows [semantic versioning](https://semver.org/): minor and patch releases (1.x) are backwards compatible, while a new major version may change settings or stored data and describes the necessary steps in its changelog entry.
2. **Back up** the database and the uploaded files, together, and keep a copy of your `.env` file — see [Backups and restore](deployment.md#backups-and-restore). A backup is the only way to undo an upgrade.

## Upgrading with Docker Compose

The version you run is set by `DOCDATETRACK_VERSION` in `.env` (default `latest`); the [deployment guide](deployment.md#upgrading) explains the available tags. Pinning a major version, such as `DOCDATETRACK_VERSION=1`, gives you new features and fixes without breaking changes.

In the directory of `compose.yaml`:

```bash
docker compose pull      # download the new images
docker compose up -d     # recreate the containers that changed
docker compose ps        # both containers should become "healthy"
docker image prune       # optional: remove the old, unused images
```

Now and then, compare your `compose.yaml` and `.env` with the latest [`compose.yaml`](../compose.yaml) and [`.env.example`](../.env.example), and adopt the new settings you want to use.

## Upgrading without Docker

For an installation from a Git checkout, as in [Running without Docker](deployment.md#running-without-docker), check out the new release, reinstall the dependencies and restart the service (replace `v1.1.0` with the release you want):

```bash
cd /opt/docdatetrack
sudo git fetch --depth 1 origin tag v1.1.0
sudo git checkout v1.1.0
sudo npm ci --omit=dev
sudo systemctl restart docdatetrack
```

Check the [release notes](https://github.com/serbantasss/DocDateTrack/releases) for the required Node.js version before you upgrade Node.js or DocDateTrack.

After an upgrade, check that DocDateTrack is healthy (`curl http://localhost:8080/healthz` answers `{"status":"ok"}`) and that you can sign in.

## Rolling back

If something goes wrong, go back to the previous version **and** restore the backup that you made before the upgrade: a newer version may have changed the stored data, which an older version cannot read.

1. Stop DocDateTrack (`docker compose stop app`, or `sudo systemctl stop docdatetrack`).
2. Restore the database and the uploaded files from the backup, as described in [Restoring a backup](deployment.md#restoring-a-backup).
3. Start the previous version: with Docker, set `DOCDATETRACK_VERSION` to its exact version, for example `1.0.0`, and run `docker compose up -d`; without Docker, check out its tag, run `npm ci --omit=dev` and restart the service.

## Upgrading from the 2023 prototype

Before version 1.0, DocDateTrack was an unreleased prototype. It stored the login accounts on the owners and used other field names. A migration script, `npm run db:migrate`, converts such a database to the 1.0 data model. It is idempotent — running it again only changes records that still have legacy fields — and it has a `--dry-run` mode that shows what it would change without writing anything.

### What changes

| Data       | Prototype                                                                | DocDateTrack 1.0                                                                                                                                                                                                                                                                |
| ---------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Accounts   | Login data (username, password hash) stored on the owners.               | Separate user accounts. The earliest account becomes the **administrator** (unless an administrator exists already), the others become **members**. Passwords keep working. The display name is the owner's name.                                                               |
| Usernames  | Free text.                                                               | 3–50 lower-case letters, digits, dots, hyphens and underscores: accents are removed and other characters become dots, so `Zoë Ann` becomes `zoe.ann`. Usernames that would be too short are derived from the email address. Everyone can also sign in with their email address. |
| Owners     | Login fields, and unique indexes on username and email.                  | The login fields are removed and the old unique indexes `username_1` and `email_1` are dropped, so several owners may share an email address or have none.                                                                                                                      |
| Categories | Relation codes `DP`, `DF` and `DPF`.                                     | Scopes: `DP` → Personal, `DF` → Company, `DPF` → Employee. Categories without a relation, or with an unknown one, become Personal.                                                                                                                                              |
| Documents  | A stored status.                                                         | The status is removed; DocDateTrack computes it.                                                                                                                                                                                                                                |
| Versions   | `expire_date_raw`, `update_date_raw` and a file name in `document_file`. | `expires_at` and `issued_at`, stored as calendar dates; issue dates after the expiry date are dropped (the prototype filled in the upload time). The file name becomes file information — name, type (from the extension) and size (from `UPLOAD_DIR`).                         |
| Sessions   | —                                                                        | Everyone has to sign in again.                                                                                                                                                                                                                                                  |

The migration never deletes records and never moves or renames files. Problems it cannot solve — versions whose document no longer exists, documents whose owner or category is missing, files that cannot be found, duplicate names — are listed in its summary, so that you can fix them.

Files of types that DocDateTrack 1.0 does not accept for new uploads, such as GIF, TIFF or Word documents, stay linked to their versions and can still be downloaded; they are sent as generic binary files (`application/octet-stream`).

### Before you start

- **Back up** the prototype's database and its `uploads` folder, and keep the backup until you are sure that everything works.
- **Make the files available first.** The migration looks for every file in `UPLOAD_DIR` to record its size and to report missing files, so copy the prototype's files there before you run it.
- **Do not open DocDateTrack to others before the migration has run.** As long as there are no user accounts, DocDateTrack shows the first-run registration page, and whoever registers first becomes the administrator. Do not create an account yourself either: if an administrator already exists, every migrated account becomes a member.

### With Docker Compose

1. Prepare DocDateTrack with steps 1 and 2 of the [quick start](deployment.md#quick-start-with-docker-compose), and start only MongoDB: `docker compose up -d mongo`.
2. Copy the prototype's database into the bundled MongoDB and its files into the `uploads` volume, as shown in [Upgrading from the 2023 prototype](deployment.md#upgrading-from-the-2023-prototype) in the deployment guide.
3. Preview the migration, read the summary (see below), and then run it:

   ```bash
   docker compose run --rm app npm run db:migrate -- --dry-run
   docker compose run --rm app npm run db:migrate
   ```

   `docker compose run --rm` runs the command in a one-off container without starting the web server. The notice `.env not found. Continuing without it.` is expected: in the container, the settings come from Compose.

4. Start DocDateTrack with `docker compose up -d`.

### Without Docker

Install DocDateTrack 1.0 next to the prototype's database, as in [Running without Docker](deployment.md#running-without-docker), with `MONGODB_URI` pointing at the prototype's database and `UPLOAD_DIR` at the prototype's `uploads` folder (or a copy of it). Then run the migration from the installation directory:

```bash
npm run db:migrate -- --help      # what the migration does
npm run db:migrate -- --dry-run   # preview; reads .env in the project directory
npm run db:migrate
```

With a configuration file elsewhere, pass it to Node.js instead, for example:

```bash
sudo -u docdatetrack node --env-file=/etc/docdatetrack/docdatetrack.env tasks/migrate-legacy-data.js --dry-run
sudo -u docdatetrack node --env-file=/etc/docdatetrack/docdatetrack.env tasks/migrate-legacy-data.js
```

### Reading the summary

The migration prints a summary. With `--dry-run`, the counts show what would change; without it, what was changed. For example:

```text
Legacy data migration — DRY RUN: nothing was written, the counts show what would change.
  Users:      3 created, 0 skipped, 0 conflicts, 0 invalid
    - alex.example (admin) — renamed from "Alex.Example"
    - jamie (member)
    - zoe.ann (member) — renamed from "Zoë Ann"
  Owners:     3 cleaned (login fields removed), dropped indexes username_1, email_1
  Categories: 4 converted (personal 2, company 1, employee 1)
  Documents:  2 cleaned (status removed), 0 with a missing owner or category
  Versions:   4 converted, 2 files linked, 1 file not found in UPLOAD_DIR, 1 issue date after expiry dropped, 1 orphan
  Missing files:
    - renewed.png (6afcb6bd8234e9be856d70d1)
  File names containing paths (not linked):
    - scans/medical.pdf (6afcb6bd8234e9be856d70d2)
  Versions whose document no longer exists:
    - 6afcb6bd8234e9be856d70d3
```

| Line                                            | Meaning and what to do                                                                                                                                                                                                                                                         |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Users: created**                              | Accounts created from owners with login data, with their role. "Renamed from" shows usernames that were adapted to the new rules: tell those people their new username, or let them sign in with their email address.                                                          |
| **Users: skipped**                              | Owners without a complete username and password, or whose account already exists with the same username and email address. Their login fields are removed; nothing else to do.                                                                                                 |
| **Users: conflicts**                            | The (adapted) username already belongs to an account with another email address. Change one of the usernames in the database and run the migration again; until then, the owner keeps its login fields.                                                                        |
| **Users: invalid**                              | The account would be invalid, usually because the owner has no valid email address. Fix the owner's email address in the database and run the migration again.                                                                                                                 |
| **Owners**                                      | Owners whose login fields were removed, and the old indexes that were dropped.                                                                                                                                                                                                 |
| **Categories**                                  | Categories that received a scope. Check the scopes on the **Categories** page afterwards.                                                                                                                                                                                      |
| **Documents: with a missing owner or category** | Documents that point to a deleted owner or category; they are listed by id. They appear with "Unknown owner" or "Unknown category" and can be deleted in the app.                                                                                                              |
| **Versions: files linked**                      | Versions whose file name was turned into file information.                                                                                                                                                                                                                     |
| **Versions: files not found in UPLOAD_DIR**     | Listed under **Missing files**. The version keeps the file name, but downloading answers "The file of this version is missing." Copy the file into `UPLOAD_DIR` under the same name, or upload it again by editing the version.                                                |
| **File names containing paths (not linked)**    | File names with `/` or `\`, which DocDateTrack never follows for security reasons. Upload these files again by editing the versions.                                                                                                                                           |
| **Versions: issue dates after expiry dropped**  | The prototype filled in the upload time as the issue date; where it was after the expiry date, it is removed. Enter the real issue date if you know it.                                                                                                                        |
| **Versions: orphans**                           | Versions whose document no longer exists, listed under **Versions whose document no longer exists**. They are kept; the **Versions** page shows them as "Unknown document", and you can delete them there.                                                                     |
| **Versions without a valid expiry date**        | Versions that had no usable expiry date. Edit them and enter one.                                                                                                                                                                                                              |
| **Warnings**                                    | Unknown relation codes (the category became Personal), several categories with the same name, or several documents for the same owner and category. Rename or merge the duplicates — category names and owner-and-category pairs must be unique — and run the migration again. |
| **Errors**                                      | For example, an index that could not be built because of such duplicates. The migration then exits with code 1; fix the cause and run it again.                                                                                                                                |

Running the migration again is safe: on an already migrated database, it changes nothing and lists only the problems that remain, such as orphaned versions.

### After the migration

1. Start DocDateTrack and sign in with your username — possibly adapted, see the summary — or your email address, and your old password. Everyone has to sign in again.
2. Check the owners, the categories and their scopes, and the documents. Under **Users**, check the roles and make other people administrators where needed.
3. Set up what is new in 1.0, such as [email reminders](deployment.md#email-reminders), the time zone (`TZ`) and `APP_URL` — see the [configuration reference](configuration.md).
4. Run `npm run uploads:check` (with Docker: `docker compose exec app npm run uploads:check`). It lists the files in `UPLOAD_DIR` that no version uses — the prototype never deleted files — and the versions whose file is missing. `--delete-orphans` only deletes files named like DocDateTrack 1.0 uploads, so review the prototype's unused files and delete them by hand.

To undo the migration, restore the backup that you made before it, and run the prototype again — see [Rolling back](#rolling-back).
