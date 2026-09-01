# ADR-0003: PostgreSQL and Prisma persistence baseline

- Status: accepted
- Date: 2026-09-01
- Owner: Артём

## Context

`ART-003` established a persistence-independent domain model. `ART-004` must make PostgreSQL the operational source of truth without leaking Prisma types into `packages/core`, while preserving permission, provenance, immutability, version, and score invariants at the database boundary.

At the decision date Prisma 7.10 is the stable supported line. The published Prisma 8 CLI is still a release candidate and introduces a new contract/query/migration workflow. Adopting that prerelease would add migration risk without improving the MVP's first persistence slice.

## Decision

- Pin Prisma ORM `7.10.0`, `@prisma/client`, `@prisma/adapter-pg`, and `pg`; revisit Prisma 8 only through a separate upgrade decision.
- Override Prisma CLI's vulnerable transitive `deepmerge-ts` to patched `8.0.2`; generation and schema validation are regression checks for compatibility until Prisma ships the patched dependency directly.
- Use the ESM `prisma-client` generator with an explicit ignored output directory and regenerate it in `postinstall` and before schema-dependent checks.
- Use PostgreSQL `17.6` for local and integration infrastructure. Docker publishes it only on `127.0.0.1:54329` and keeps data in a named volume.
- Keep Prisma configuration, schema, migrations, generated client, mappers, and repositories inside `packages/db`.
- Use UUID database identifiers while domain identifiers remain opaque branded strings.
- Map query-critical permissions, statuses, timestamps, scores, versions, and relationships to typed columns. Keep raw payload and versioned structured collections in `jsonb`.
- Add SQL `CHECK` and partial unique constraints in the migration for invariants Prisma Schema Language cannot express.
- Keep profile revisions append-only with composite identity `(id, revision)` so historical recommendations keep their original personalization context.
- Implement `Source` and `RawItem` repositories first because they are the next end-to-end ingestion slice. Later repositories are added with the application use case that exercises them.
- Run PostgreSQL integration tests through Testcontainers and apply checked-in Prisma migrations before repository assertions.

## Consequences

- `packages/core` remains free of Prisma/PostgreSQL imports.
- A missing generated client fails typecheck/build early; `pnpm install` restores it deterministically.
- Raw ingestion is protected by both `(source_id, external_id)` and `(source_id, content_hash)` unique identities. Reused external identity with different content is an explicit conflict and never overwrites evidence.
- Database checks defend permission and scoring boundaries even if a future adapter bypasses domain factories.
- Local integration tests require a working Docker-compatible container runtime; unit tests, schema validation, generation, lint, typecheck, and build do not.
- Upgrading to Prisma 8 requires deliberate migration of the client and migration ledger rather than an automatic dependency bump.
