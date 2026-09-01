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

## Verification

```powershell
pnpm db:validate
pnpm test:integration
```

Integration tests start an isolated PostgreSQL container, apply the checked-in migrations, verify database permission constraints and repository mapping, test RawItem idempotency/conflict behavior, and run the seed twice.

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
