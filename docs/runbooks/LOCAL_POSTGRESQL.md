# Local PostgreSQL

## Purpose

This runbook starts the local PostgreSQL used by Prisma migrations, development seed, and repository verification. It does not expose PostgreSQL beyond localhost and does not require Telegram or Ollama.

## Prerequisites

- Node.js and pnpm versions from the root `package.json`;
- Docker Engine or Docker Desktop with a working Linux container runtime;
- local port `54329` available, unless overridden with `POSTGRES_PORT` and a matching `DATABASE_URL`.

## First start

```powershell
pnpm install --frozen-lockfile
pnpm db:up
pnpm db:migrate:deploy
pnpm db:seed
```

The development defaults are defined in Docker Compose and Prisma config. To use another database, set `DATABASE_URL` in the root `.env`; `.env.example` intentionally contains no value.

On a clean database the seed prints:

```json
{ "createdRawItems": 100, "rawItems": 100, "signals": 0, "sources": 10 }
```

Running `pnpm db:seed` again is safe and prints `createdRawItems: 0` while the three totals remain unchanged.

## Versioned ingestion fixtures

`db:seed` is the small ART-004 persistence seed. The ART-005 pipeline uses the separate checked-in `fixture-ingestion/v1` corpus:

```powershell
pnpm fixtures:ingest
pnpm fixtures:normalize
pnpm fixtures:deduplicate
```

On a clean migrated database it loads 10 source definitions and 200 raw candidates. Repeating the command creates zero new raw items because the repository matches `(source_id, external_id)` and `(source_id, content_hash)`. Materials from the `REVIEW_REQUIRED` source are preserved, but the ingestion summary does not count them in `aiPermissionPassedCreated`.

Normalization writes one versioned attempt per raw item. Successful items become `normalized_items`; explicit rejections remain in `normalization_attempts` without a partially valid normalized row. Deduplication then writes one evidence-backed assignment per normalized item. For the checked-in v1 corpus the expected first run is:

```json
{
  "assignments": 200,
  "clusters": 150,
  "created": 200,
  "duplicates": 50,
  "exactDuplicates": 25,
  "nearDuplicates": 25
}
```

Repeating normalization or deduplication is safe: each command reports `created: 0` and keeps the same totals. A changed normalization or dedup policy requires a new version instead of overwriting existing evidence.

## Verification

```powershell
pnpm db:validate
pnpm test:integration
```

Integration tests start an isolated PostgreSQL container, apply the checked-in migrations, verify database permission constraints and repository mapping, test RawItem idempotency/conflict behavior, run the seed twice, normalize without changing raw evidence, and prove the repeatable 200-to-150 dedup result.

## Stop and clean reset

`pnpm db:down` stops the project containers and preserves the named PostgreSQL volume.

The following command is destructive and removes only this Compose project's local database volume. Use it only when a clean development database is intended:

```powershell
docker compose -f infra/docker/docker-compose.yml down --volumes
```

Then repeat `db:up`, `db:migrate:deploy`, and `db:seed`.

## Safety

- The Compose port binds to `127.0.0.1`, not all network interfaces.
- Local default credentials are development-only and must not be reused in production.
- Never commit `.env` or a production `DATABASE_URL`.
- Runtime code receives a database URL from its composition root; repositories do not read environment variables or log connection strings.
