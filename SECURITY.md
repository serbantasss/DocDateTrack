# Security policy

DocDateTrack stores personal data and scans of identity documents, so we take security seriously. Thank you for helping to keep DocDateTrack and its users safe.

## Supported versions

Security fixes are made for the latest 1.x release. Before reporting, please check whether the issue still exists in the latest release or on the `main` branch.

| Version                                | Supported              |
| -------------------------------------- | ---------------------- |
| 1.x                                    | :white_check_mark: Yes |
| < 1.0 (2023 prototype, never released) | :x: No                 |

## Reporting a vulnerability

**Please do not report security vulnerabilities through public GitHub issues, discussions or pull requests.**

Report them privately through GitHub's private vulnerability reporting instead:

1. Go to the [Security tab](https://github.com/serbantasss/DocDateTrack/security) of the repository.
2. Click **Report a vulnerability** (or open the [report form](https://github.com/serbantasss/DocDateTrack/security/advisories/new) directly).
3. Fill in the form and submit it. Only you and the maintainers can see the report.

If you cannot use private vulnerability reporting, ask the maintainer, [@serbantasss](https://github.com/serbantasss), to contact you privately — without giving any details of the vulnerability.

### What to include

- The type of issue (for example authentication bypass, cross-site scripting or path traversal) and its impact: what can an attacker do, and do they need an account?
- The affected version or commit, and how DocDateTrack is deployed (Docker or Node.js, reverse proxy, relevant settings with all secrets removed).
- Step-by-step instructions to reproduce the issue, including any requests, scripts or files needed. A minimal proof of concept helps a lot.
- Any known workarounds, or a suggested fix.
- Whether and how you would like to be credited.

Use made-up test data only. Never include real personal data, real documents or real credentials in a report.

## What happens next

DocDateTrack is maintained by volunteers, so these are targets rather than guarantees:

- We acknowledge your report within **7 days**.
- Within **14 days** we send a status update — whether we could reproduce the issue and how we plan to address it — and we keep you informed until it is resolved.
- We follow **coordinated disclosure**: the fix is prepared privately and released first, then we publish a [security advisory](https://github.com/serbantasss/DocDateTrack/security/advisories) (with a CVE where appropriate). Please keep the details confidential until the advisory is published; we will agree on the timing with you.
- With your permission, we credit you in the advisory and in the [changelog](CHANGELOG.md).

## Scope

In scope is the code in this repository — the web application, its views and client-side scripts, and the command-line tasks — as well as the official Docker image and Compose file, used with a documented configuration. For example:

- accessing pages, documents or uploaded files without signing in;
- a member gaining administrator rights, or creating accounts when registration is closed;
- cross-site scripting (XSS), cross-site request forgery (CSRF), injection (including NoSQL injection) or session fixation;
- reading or writing arbitrary files on the server, for example through uploads or downloads;
- personal data or secrets leaking through responses, logs or reminder emails.

Out of scope:

- Signed-in users accessing owners, documents or files created by other users. Each DocDateTrack instance is one shared workspace: by design, every signed-in user can see and manage all records, and only user management is restricted to administrators.
- Vulnerabilities in dependencies without a demonstrated impact on DocDateTrack — please report those upstream. Dependabot keeps our dependencies up to date.
- Issues that require an already compromised server, administrator account or device, or that only affect installations which ignore the hardening checklist below.
- Denial of service through traffic volume, social engineering, and automated scanner reports without a demonstrated impact.

## Deployment hardening

DocDateTrack holds sensitive documents. When you run it, make sure that you:

- [ ] Set a strong, unique `SESSION_SECRET` (for example the output of `openssl rand -hex 32`), and keep `.env` files out of version control.
- [ ] Run with `NODE_ENV=production`, so that error pages never show stack traces.
- [ ] Serve DocDateTrack over HTTPS through a reverse proxy (such as Caddy, nginx or Traefik), set `TRUST_PROXY` to match your proxy, and set `COOKIE_SECURE=true` so that session cookies are never sent over plain HTTP.
- [ ] Create the administrator account immediately after the first start — until then, anyone who can reach the app can claim it — and keep `ALLOW_REGISTRATION=false` (the default); administrators can add accounts under **Users**.
- [ ] Keep MongoDB private. The bundled Compose setup does this for you: MongoDB is only reachable from the containers of the Compose project and, on the server itself, at `127.0.0.1` on `MONGODB_PORT` (27018), without authentication. If MongoDB must be reachable from anywhere else — another host, or a server on which other people have accounts — enable authentication with a dedicated database user, or stop publishing the port as described in [Customising the Compose setup](docs/deployment.md#customising-the-compose-setup). Never make MongoDB reachable from the internet.
- [ ] Back up MongoDB and the uploads volume together and regularly, and store the backups securely: they contain personal documents.
- [ ] Keep the uploads directory (`UPLOAD_DIR`) outside the web root — never inside `public/` or any directory served by your web server. DocDateTrack only serves uploaded files to signed-in users.
- [ ] Update regularly to receive security fixes for DocDateTrack, Node.js, MongoDB and the container base image.

The [deployment guide](docs/deployment.md) describes a complete production setup.

## Built-in protections

For reference when you assess a deployment or a report, DocDateTrack:

- requires signing in for every page and uploaded file — only the sign-in and registration pages, static assets such as stylesheets and scripts, and the health check (`/healthz`) are public; only administrators can manage users;
- protects every form and state-changing request with a per-session CSRF token;
- sends a strict Content Security Policy (no inline scripts or styles, no third-party sources) and other security headers through helmet, and serves Bootstrap and Bootstrap Icons itself instead of loading them from a CDN; HSTS is left to the TLS-terminating proxy;
- stores sessions in MongoDB, with `HttpOnly`, `SameSite=Lax` and — depending on `COOKIE_SECURE` — `Secure` cookies; changing or resetting a password signs out the user's other sessions;
- hashes passwords with PBKDF2 and rate-limits failed sign-in, registration and password-change attempts per client IP address, without locking accounts;
- accepts only PDF, JPEG, PNG and WebP uploads up to `MAX_UPLOAD_MB`, verified by their content; stores them under random names inside `UPLOAD_DIR`; and sends them back only as attachments, with `X-Content-Type-Options: nosniff` and a file name whose extension matches the verified type;
- validates its configuration at startup and refuses to run in production with a `SESSION_SECRET` shorter than 32 characters;
- runs as a non-root user in the official Docker image.
