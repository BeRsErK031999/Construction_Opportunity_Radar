---
name: construction-radar-engineering
description: Implement or review Construction Opportunity Radar architecture, TypeScript services, PostgreSQL/Prisma data, collectors, local Ollama processing, scoring, Telegram delivery, testing, security, or operations. Use for engineering work in this repository; do not use for market/content tasks without a technical change.
---

# Construction Radar Engineering

Build the smallest reliable end-to-end slice while preserving provenance, permissions, structured contracts, and explainability.

## Start here

1. Read [references/engineering-contract.md](references/engineering-contract.md).
2. Read `../../../docs/PROJECT_CONTEXT.md` and `../../../docs/architecture/MVP_ARCHITECTURE.md`.
3. Read the relevant ADR and `../../../docs/quality/QUALITY_GATES.md`.
4. Check `../../../ROADMAP.md` to understand the current milestone without assuming dates prove readiness.

## Workflow

1. Inspect repository state, existing contracts, migrations, tests, and user changes.
2. Identify the pipeline stage and invariant affected by the request.
3. Implement the narrowest vertical slice that produces an observable result.
4. Enforce source rights at the boundary before AI enqueue.
5. Preserve idempotency, bounded retries, terminal failures, provenance, and version fields.
6. Add tests for contract validation and the failure paths changed.
7. Run the repository's actual lint, typecheck, test, and migration checks when available.
8. Update docs or an ADR if the change alters architecture, schema contracts, scoring, security boundaries, or operating procedures.

Never commit secrets, publish Ollama/PostgreSQL/debug endpoints, silently weaken validation, or bypass a quality gate to meet a date.
