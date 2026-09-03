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
pnpm db:grant-runtime
```

The development defaults are defined in Docker Compose and Prisma config. The Compose owner `radar` performs migrations; application/CLI defaults connect as `radar_runtime`, which has table DML but no schema DDL. A fresh volume provisions runtime automatically; `db:grant-runtime` idempotently provisions or rotates it on an existing volume.

For another database, services receive a runtime `DATABASE_URL`, while the operator/migration environment receives `MIGRATION_DATABASE_URL`. `.env.example` intentionally contains no values. Never make the owner/migration URL available to API, bot or worker services.

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
pnpm fixtures:classify
pnpm process:fixtures
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

Integration tests start an isolated PostgreSQL container, apply the checked-in migrations, verify database permission/profile/delivery/job constraints and repository mapping, test RawItem idempotency/conflict behavior, run the seed twice, normalize without changing raw evidence, and prove the repeatable 200-to-150 dedup result plus the complete 110-analysis/110-recommendation fake-provider path, daily/weekly Digest and idempotent digest delivery. Job scenarios additionally cover concurrent single-claim, no-overlap, delayed/terminal retry, stale lease recovery and a process restart without duplicate enqueue.

The role bootstrap contract and a live local check verify that `radar_runtime` has `USAGE` on `public` and CRUD on application tables, but not `CREATE`, superuser, database/role creation, replication or row-security bypass. Runtime sessions also have bounded statement, lock and idle-transaction timeouts.

## Backup and recovery

`pnpm db:backup` creates an environment-scoped encrypted logical backup; `pnpm db:verify-backup` proves it through an isolated restore. `pnpm db:restore -- --target-database <new_name>` never replaces the active database. Encryption-key custody, retention, off-host storage and the recovery sequence are documented in [BACKUP_RESTORE.md](BACKUP_RESTORE.md).

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
- Production owner/migration and runtime users need independent generated passwords; runtime must not own the database or schema.
- Never commit `.env` or a production `DATABASE_URL`.
- Runtime code receives a database URL from its composition root; repositories do not read environment variables or log connection strings.
