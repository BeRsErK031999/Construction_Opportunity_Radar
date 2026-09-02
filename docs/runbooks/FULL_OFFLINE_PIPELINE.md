# Full offline pipeline

## Purpose

`pnpm process:fixtures` is the ART-013 end-to-end verification path. It runs the checked-in fixture corpus through PostgreSQL persistence, deterministic rules, the validated fake AI provider, company-profile scoring, and Recommendation persistence. It does not require Ollama, Telegram, or network access.

## Prerequisites

```powershell
pnpm install --frozen-lockfile
pnpm db:up
pnpm db:migrate:deploy
```

PostgreSQL remains bound to localhost by the Compose configuration. The command uses `DATABASE_URL` when present and otherwise uses the documented local development URL.

## Run

```powershell
pnpm process:fixtures
```

The composition root loads `fixture-ingestion/v1`, creates two fixed test profiles—one Construction and one HoReCa—and invokes the application orchestrator. The fixture timestamp and all pipeline identifiers are deterministic. No production profile, credential, source, or external endpoint is used.

On a clean migrated database the stage totals are:

```json
{
  "ingestion": { "rawItems": 200, "sources": 10 },
  "normalization": { "attempts": 200, "normalizedItems": 200 },
  "deduplication": { "assignments": 200, "clusters": 150 },
  "classification": { "signals": 110 },
  "analysis": { "succeeded": 110, "failed": 0, "total": 110 },
  "scoring": { "profiles": 2, "recommendations": 110 }
}
```

If earlier fixture-stage commands already populated the database, their stage totals remain the same while the corresponding `created` counters are zero.

## Idempotency and permission boundary

Run the same command again. The second run must report:

- zero `created` for raw items, normalization attempts, deduplication assignments, signals, analyses, and recommendations;
- 110 existing analyses and 110 existing recommendations;
- `analysis.providerCalls: 0`;
- unchanged totals at every stage.

Analysis identity is `(signal, provider, model, prompt version, schema version, analysis version)`. The orchestrator checks it before invoking the provider. Recommendation identity includes signal, analysis, profile revision, and scoring version. A later execution timestamp therefore does not create a duplicate.

Only evidence that still passes the source AI permission policy can enter `createAIAnalysisRequest`. A revoked permission is counted as a rejected analysis candidate and never reaches the provider. Schema, identity, provenance, or domain-invalid provider output is stored as `FAILED / AI_INVALID_RESPONSE`, never as a successful analysis.

## Verification

```powershell
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm build
pnpm db:validate
pnpm process:fixtures
pnpm process:fixtures
```

The integration suite repeats the full pipeline with a different execution timestamp and asserts stable totals, zero second-run provider calls, and the absence of any Analysis linked to a source whose AI permission is false.

This run proves Milestone M2 with `AI provider: fake`. It does not pass Gate G2: collector uptime, real-model JSON success, durable-job restart behavior, and operational duplicate rates require later evidence.
