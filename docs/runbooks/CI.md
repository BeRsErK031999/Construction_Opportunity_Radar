# Continuous integration

## Purpose

`.github/workflows/ci.yml` checks every push and pull request to `main`, and also supports a manual run. CI uses the committed lockfile, deterministic fake adapters and an isolated PostgreSQL service; it never needs Telegram, Ollama, backup keys or production credentials.

Workflow permissions are limited to `contents: read`. The automatic read-only `GITHUB_TOKEN` is used only by repository checkout and upstream pnpm setup; no application runtime credential is configured.

## Jobs

`Quality` runs on Node.js 24.19.0 and pnpm 11.19.0:

1. full-history checkout for the secret-history scan;
2. `pnpm install --frozen-lockfile`;
3. formatting, lint and strict typecheck;
4. Prisma schema and eval-dataset validation;
5. unit/contract tests and build;
6. candidate/history secret scan and production dependency audit.

`PostgreSQL integration` starts only `postgres:17.6-alpine` as a GitHub Actions service, waits for `pg_isready`, applies the committed migrations and runs the integration suite. The test password exists only in the ephemeral workflow and is not a production secret.

Reusable actions and the PostgreSQL image are pinned to immutable commits/digest. Updating a pin requires reviewing the upstream release and rerunning both jobs.

## Database safety boundary

Local integration tests continue to start Testcontainers automatically. CI sets `INTEGRATION_DATABASE_URL` to reuse its service container. The test harness accepts that override only when all of these conditions hold:

- PostgreSQL URL;
- loopback host;
- database name `radar_test`;
- user `radar_test`;
- non-empty password.

The suite clears application tables between tests, so the guard must not be weakened to accept an arbitrary database URL.

## Local reproduction

Run the quality job commands from the repository root:

```powershell
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm db:validate
pnpm evals:validate
pnpm test
pnpm build
pnpm security:check
```

Run `pnpm test:integration` for the default Testcontainers path. To reproduce the CI service path, start an isolated local `radar_test` PostgreSQL and set only `INTEGRATION_DATABASE_URL` for that command.

## Failure handling

- frozen install failure: reconcile `package.json` and `pnpm-lock.yaml` locally; never disable the frozen check;
- formatting/lint/type/build failure: reproduce the exact named command and fix the source;
- secret scan failure: remove and rotate real credentials, then inspect Git history before rewriting it;
- dependency audit failure: assess exploitability and update the direct dependency or lockfile with tests;
- integration failure: inspect migration output and service health before retrying; do not point the suite at a shared database.

After the first remote run passes, configure `Quality` and `PostgreSQL integration` as required branch checks. Repository settings are an operator action and are not changed by the workflow itself.
