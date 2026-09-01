# Engineering contract quick reference

## Planned stack

- Node.js 24 + strict TypeScript in a pnpm modular monolith
- Fastify + Zod
- PostgreSQL + Prisma
- PostgreSQL-backed durable jobs
- `AIProvider` with deterministic fake implementation; Ollama + DeepSeek-R1 8B baseline and 14B benchmark candidate
- Telegram Bot API through grammY behind a delivery port, long polling for closed MVP
- Ubuntu + Docker Engine and/or systemd
- React + Vite admin after the closed MVP if justified

## Pipeline invariants

1. Source Registry records rights and `ai_processing_allowed`.
2. Collector preserves URL, time, raw content, and source identity.
3. Normalize, deduplicate, and rule-filter before GPU work.
4. Jobs are durable, transactionally claimed, bounded, and observable.
5. Classification creates a non-personalized `Signal`; company fit never becomes a global signal field.
6. AI returns a versioned `Analysis`; invalid output does not become a successful analysis.
7. Facts, inferences, confidence, and source IDs stay separate.
8. Scoring persists a deterministic, profile-specific factor breakdown and rule version on `Recommendation`.
9. Delivery and feedback remain traceable through correlation IDs.

## Required tests by risk

- collectors: fixture parsing, idempotency, errors, and permission enforcement;
- normalization/dedup: canonicalization, hashes, bounded fuzzy matches, false-positive fixtures;
- jobs: single claim, retry budget, stale lock recovery, terminal failure;
- AI: provider conformance, schema validation, unknown handling, facts/inferences separation, eval regression;
- scoring: factor calculations, thresholds, version persistence, explanation;
- bot/API: validation, authorization, persistence, source links, safe errors;
- operations: restart, backup/restore, health checks, and redacted logs.

## Security boundaries

- `.env` and secrets never enter Git.
- Ollama and PostgreSQL stay on localhost or a restricted private network and are never exposed publicly.
- Public endpoints require validation, rate limiting, and appropriate authentication.
- Do not log bot tokens, passwords, full private PII, or private source credentials.
- Production-service changes on Denis's computer require coordination with Артём.

## Definition of done

Behavior works end to end, relevant tests pass, failure paths and logs are adequate, docs match the change, migration/recovery implications are handled, and the applicable gate has evidence.
