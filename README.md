# DocDateTrack

DocDateTrack is an Express application for managing official documents, owners, categories, and uploaded document instances. It uses MongoDB through Mongoose and renders its interface with Pug.

## Local development

### Requirements

- macOS or Linux (or Windows through WSL)
- [nvm](https://github.com/nvm-sh/nvm) for Node.js version management
- Docker for a local MongoDB database

The project targets Node.js 24 LTS. From the repository directory, install and activate the pinned major version, then install the locked dependencies:

```bash
nvm install
nvm use
npm ci
```

Create a local environment file and generate a session secret:

```bash
cp .env.example .env
openssl rand -hex 32
```

Copy the generated value into `SESSION_SECRET` in `.env`. The example file points to a separate local database named `docdatetrack_dev`. Do not use production credentials or real business documents in local development.

Start MongoDB and build/run the one-shot demo-data seeder:

```bash
docker compose up --build -d
```

The MongoDB port is bound to the local machine only; database data persists in the `docdatetrack-mongo-data` volume. Compose uses port `27018` by default to avoid colliding with other local MongoDB services. If it is occupied, set `MONGODB_PORT` in `.env` to another free port and update `MONGODB_URI` to match. The seeder creates three demo accounts, three document categories, and nine documents. The demo accounts are `demo`, `demo.jamie`, and `demo.taylor`; they all use the `DEMO_USER_PASSWORD` value (defaults to `LocalDemoOnly123!`). Change this value in `.env` before seeding if desired. These credentials are for local development only and must never be used in a deployed environment. The seeder is idempotent and refuses to write to databases other than `docdatetrack_dev`.

If you change or remove demo data and want to run the seeder again:

```bash
docker compose run --build --rm seed-demo-data
```

Start the application:

```bash
npm run devstart
```

Open [http://localhost:8080](http://localhost:8080). `npm start` starts the app without file watching.

Stop and restart the database container with:

```bash
docker compose stop mongo
docker compose start mongo
```

To stop all Compose services while retaining the database volume:

```bash
docker compose down
```

To permanently remove the local database and all its data:

```bash
docker compose down --volumes
```

## Configuration

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `PORT` | No | `8080` | HTTP port |
| `MONGODB_URI` | Yes | — | MongoDB connection string |
| `MONGODB_PORT` | No | `27018` | Host port published by Docker Compose for MongoDB |
| `SESSION_SECRET` | Yes | — | Secret used to sign session cookies |
| `DEMO_USER_PASSWORD` | No | `LocalDemoOnly123!` | Password assigned to seeded demo accounts; local development only |
| `SSL_KEY_PATH` | No | — | Path to a TLS private key; configure with `SSL_CERT_PATH` |
| `SSL_CERT_PATH` | No | — | Path to the matching TLS certificate; configure with `SSL_KEY_PATH` |
| `PORT_HTTPS` | No | `8443` | HTTPS port when both TLS paths are set |

The application connects to MongoDB before it starts listening. Startup fails with an error if required configuration is missing or the database cannot be reached. HTTP is used by default; local certificates are not needed. In production, TLS is generally better terminated by the hosting platform or reverse proxy.

`.env` and other `.env.*` files are ignored by Git; `.env.example` is safe to commit and contains local defaults and placeholders, not production credentials.
