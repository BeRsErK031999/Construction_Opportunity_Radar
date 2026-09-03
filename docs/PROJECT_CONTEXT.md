# Project context

## One-minute summary

Construction Opportunity Radar is a two-person MVP that converts a large stream of permitted business signals into a short, personalized digest. A useful card answers four questions: what happened, why it matters to this company, what the company can do next, and where the underlying facts came from.

The first eight weeks focus on two verticals only: Construction and HoReCa. The user interface is a Telegram bot. The system runs locally on Denis's computer through Ollama, with PostgreSQL as the operational source of truth.

## North Star

The user should feel: "I understand what happened, what it means specifically for my business, and what to do next."

Examples of actions:

- inspect a tender or project;
- create a lead;
- prepare a commercial proposal;
- check a regulatory change;
- adjust price or supply assumptions;
- contact a client or partner.

## Current state

- GitHub remote: `https://github.com/BeRsErK031999/Construction_Opportunity_Radar.git`.
- Default branch: `main`.
- Repository was empty when cloned on 2026-09-01.
- `ART-001` pre-development audit is complete: the RoadMap, modular-monolith boundary, provider abstraction, canonical data chain, planned commands, and external blockers are documented.
- `ART-002 Project scaffold` is complete: Node.js 24/pnpm workspace, Fastify health API, typed config, redacted structured logging, graceful shutdown, lockfile, strict checks, and smoke tests work without external services.
- `ART-003 Domain model` is complete: `packages/core` contains immutable source-to-feedback models, branded identifiers, permission/provenance/version/time invariants, safe identity keys, and a documented PostgreSQL mapping.
- `ART-004 PostgreSQL persistence` is complete: Prisma 7/PostgreSQL schema and migrations, localhost-only Docker Compose, repositories, deterministic seed, and Testcontainers integration all run on the current workstation. A clean seed produces 10 sources, 100 raw items, and 0 signals repeatably.
- `ART-005 Fixture source adapter` is complete: the provider-independent `SourceAdapter`, application ingestion use case, fixture adapter, one-command CLI composition, and versioned 200-item corpus run repeatably against PostgreSQL.
- The fixture corpus contains 100 Construction, 80 HoReCa, and 20 OTHER materials, including 20 advertisements, 25 exact duplicates, and 25 near duplicates. One review-required source is collectible as raw evidence but its new items never pass the AI permission boundary.
- `ART-007 Normalization pipeline` is complete: `normalizer-v1` preserves raw evidence, cleans markup/boilerplate, canonicalizes URL/time/language/text, and stores versioned success or explicit rejection outcomes idempotently.
- `ART-008 Exact and near deduplication` is complete: versioned assignments record source identity, canonical URL, normalized hash, or bounded near-text evidence. The checked-in corpus produces 200 assignments, 150 clusters, 25 exact duplicates, and 25 near duplicates; a repeat run creates zero rows.
- `ART-006 RSS/HTTP adapter` is complete: `rss-http-v1` parses RSS 2.0 and Atom through an injected bounded HTTP transport, preserves item provenance, enforces collection permissions before I/O, and exposes retry/rate-limit/failure metrics. Offline fixtures cover idempotency, timeout, retry exhaustion, status/content/XML failures, and response-size bounds.
- `ART-009 Vertical classifier and relevance rules` is complete: `classifier-v1` selects one permitted representative per dedup cluster, classifies Construction/HoReCa/OTHER from versioned source/text rules, rejects advertisements/no-opportunity/ambiguous material, and exposes only permitted evidence to future AI work.
- The 150 fixture clusters deterministically produce 110 AI-eligible persisted signals, 28 irrelevant decisions, and 12 permission-denied decisions. A second classification run creates zero signals; persisted signals retain dedup representative/version, taxonomy/classifier versions, matched rule IDs, and permitted provenance links.
- `ART-010 Opportunity scoring` is complete: `opportunity-score-v1` freezes the 35/25/20/10/10 formula, explicit band thresholds, per-factor contributions, probability-to-confidence conversion, and a profile-specific company-fit policy across vertical, region, event type, offering, and project value.
- Company-fit unknowns score neutrally and remain visible in criterion reasons. An ignored event type or excluded keyword returns `EXCLUDED` without an Opportunity Score, preventing a high-impact global signal from bypassing the profile's explicit negative preferences. The scoring result maps directly into Recommendation while Signal remains global.
- `ART-011 AI provider abstraction` is complete: application owns an Ollama-free `AIProvider` port with `analyzeSignal`, `healthCheck`, `modelInfo`, provider capabilities, bounded-input metadata, and stable retryable/non-retryable failure codes.
- `createAIAnalysisRequest` accepts domain Signal/NormalizedItem/Source values, rejects inactive signals, missing/foreign/duplicate/incomplete evidence, and sources whose AI permission is currently absent or revoked. The provider receives only a frozen sanitized snapshot with source-backed text and provenance IDs, not rights/contact metadata.
- `FakeAIProvider` deterministically returns a domain-valid successful or failed Analysis, can throw safe typed provider errors, reports controllable health, and enforces its advertised input-character bound without Ollama or network I/O.
- `ART-012 Structured AI contract` is complete: `ai-analysis/v1` is a strict versioned Zod envelope for successful output with bounded text/arrays/scores, two-to-five actions, explicit facts and inferences, exact fact-source union, confidence, provider/model/prompt/schema/analysis versions, IDs, and timestamps.
- `analysisFromAIResponseV1` accepts `unknown`, validates the schema, then matches response identity and source provenance against the permission-checked request before mapping into domain Analysis. Schema, identity, provenance, or domain drift returns a safe non-retryable `FAILED / AI_INVALID_RESPONSE` without storing raw output as a success.
- `FakeAIProvider` now runs its generated success through the same contract mapper and can deterministically emit an invalid response for failure-path tests.
- `ART-013 Full offline pipeline` is complete: the application-owned synchronous orchestrator composes persistence, rules, validated fake analysis, profile scoring, and PostgreSQL Analysis/Recommendation repositories behind `pnpm process:fixtures`.
- A clean isolated PostgreSQL run produces 200 raw items, 200 normalized items, 150 deduplication clusters, 110 permitted signals, 110 successful analyses, and 110 recommendations for two fixture profiles. A second run with a different execution timestamp creates zero rows and makes zero provider calls.
- Analysis failures are stored with safe stable codes; provider/request identity drift becomes `AI_INVALID_RESPONSE`. Existing analysis identity is checked before inference, and scoring remains versioned and deterministic.
- `ART-014 Application API` is complete: the private Fastify contract exposes public liveness plus authenticated Source Registry, personalized SignalOpportunity, append-only UserProfile, and idempotent Feedback operations backed by PostgreSQL repositories.
- API v1 rejects unknown fields, bounds cursor pagination, keeps Signal global while filtering profile-owned Recommendation score, enforces source AI-rights invariants and profile ownership, and returns one safe versioned error envelope. Production config requires an explicit runtime database URL, distinct 32+ character user/admin service tokens, and permanent loopback binding for this private caller-assertion scheme.
- The HTTP contract is documented field by field under `docs/presentation/http`; contract/HTTP tests and the PostgreSQL integration suite cover authorization, permission rejection, profile revision, evidence-backed reads, feedback persistence, idempotency, and sentiment conflict.
- `ART-015 Telegram UI` is complete: a grammY long-polling process serves the exact five-item menu in private chats for pre-registered users and renders current/saved Recommendation cards with score, explanation, practical actions, and source provenance.
- Delivery is now a first-class persisted aggregate. The application writes `PENDING` before transport and immutable `SENT`/`FAILED` outcomes afterward; channel/idempotency uniqueness prevents an interaction replay from sending the same recommendation twice. Feedback callbacks retain user, recommendation, delivery, and correlation context.
- Telegram and fake delivery adapters share an application-owned semantic port. The Telegram adapter bounds and HTML-escapes card text, keeps callback data compact, and stores only safe failure details. Unit and PostgreSQL integration tests exercise sending, replay, transport failure, saved lookup, feedback idempotency, and cross-user denial without a bot token.
- `ART-016 Feedback loop` is complete: Telegram cards expose all five MVP actions (`USEFUL`, `NOT_USEFUL`, `SAVED`, `ACTED`, `ALREADY_KNOWN`), while direct HTTP feedback retains an optional reason. Same-action callback races converge on one append-only record and opposite sentiment remains an explicit conflict.
- `GET /users/:id/feedback-summary` is a caller-owned, all-time read model. It reports explicit action counts, direct/Telegram attribution, distinct-delivery feedback coverage, positive sentiment, and bounded `HIGH/CRITICAL + NOT_USEFUL` review items with reason and trace IDs. Feedback does not modify scoring weights or Recommendation state.
- A composite PostgreSQL foreign key enforces that a non-null Feedback delivery belongs to the same user and Recommendation; the migration and rollback preflight are documented in the feedback runbook.
- `ART-017 Digest` is complete: `digest-v1` persists one immutable personalized daily or weekly snapshot per user/UTC period/version, records the profile revision, and ranks at most five compact Recommendation by score, time, and ID without reading raw text.
- Weekly summaries expose stage activity (`processed`, `unique`, `relevant`), personalized opportunity/HIGH counts, and positive category deltas against the previous equal period. Telegram `📊 Дайджест` now sends the current daily snapshot through a separate persisted `DigestDelivery`; repeated build/menu requests reuse the first Digest and do not call transport twice.
- `ART-018 Durable jobs and scheduler` is complete: `processing_jobs` stores versioned payload, correlation, idempotency/concurrency keys, attempt budget, lease and terminal outcome for `fetchSources`, `normalize`, `deduplicate`, `classify`, `analyze`, `buildDigest`, and `deliverDigest`.
- Scheduler time buckets survive repeat ticks/restart without duplicate rows. PostgreSQL `FOR UPDATE SKIP LOCKED` claim, active-job partial uniqueness, owner leases, bounded exponential retry and stale recovery are verified across concurrent repositories and a disconnected/recreated client. The worker composition accepts the existing application operations explicitly; no live schedules are enabled by default.
- `ART-019 Eval dataset` is complete: strict `eval-gold/v1` and `packages/evals` validate a Git-versioned 200-item project-authored synthetic baseline, split evenly between Construction and HoReCa with 160 relevant and 40 negative examples.
- The eval set contains 360 facts with exact source-text evidence, expected actions and explained importance. Its 80 calibration and 120 holdout items are separate from operational PostgreSQL and have no complete source-text overlap with `fixture-ingestion/v1`; the technical baseline is explicitly not claimed as human-adjudicated or representative of live distribution.
- `ART-020 AI benchmark harness` is complete: `benchmark:ai` maps eval evidence through production domain/request boundaries without expected relevance/event/fact labels and validates every successful provider result against `ai-analysis/v1`, request identity, versions, and source union.
- Strict `ai-benchmark-report/v1` separates structured valid rate from provider coverage/failures; reports exact event-type and relevance confusion metrics, conservative source-supported factual errors and hallucination count, p50/p95 latency, and optional measured token/VRAM telemetry. The full fake baseline produces 200/200 valid responses and zero unsupported facts while intentionally scoring zero event-type accuracy from neutral `UNCLASSIFIED` input.
- `ART-021 Observability` is complete: application and job runtime expose typed fail-open observer ports, while `@radar/observability` maps their outcomes to stable `snake_case` JSON events and versioned in-memory counters.
- Ingestion records source and raw-item outcomes with source/correlation IDs; AI and Telegram delivery preserve correlation through analysis/delivery IDs; the offline pipeline emits six stage summaries plus a run outcome. Metric labels use only bounded status/stage/kind/job-type values and never IDs, model/provider strings, payload or user data.
- `process:fixtures` includes a deterministic `radar_metrics/v1` snapshot in stdout while events remain in stderr. Bot and worker emit a final snapshot during graceful shutdown; Grafana, a network exporter, retention and alert thresholds remain deployment decisions.
- `ART-022 Security hardening` is complete: a repeatable scanner covers tracked/non-ignored candidate content and all reachable Git blobs, and the production dependency audit is a named check. The private API uses distinct Source Registry/user-process credentials, strict Bearer parsing, bounded bodies, patched IPv6-aware IP rate limiting, defensive headers and route-template-only access events.
- Logger redaction now covers additional secret aliases and sanitizes credentials embedded in serialized errors. The live HTTP transport rejects URL credentials, non-default ports and local/private/reserved DNS/IP targets, then manually revalidates up to five redirects; host egress allow rules remain required against DNS rebinding.
- Local PostgreSQL provisions a separate `radar_runtime` role with schema usage/table DML but no DDL, superuser, role/database creation, replication or RLS bypass. Migration/owner credentials remain separate, and ADR-0004 plus the security threat/runbook documents rotation, incident response and residual risks.
- `ART-023 Backup and restore` is complete: `db:backup` streams a PostgreSQL custom dump into the versioned `cor-postgresql-backup/v1` AES-256-GCM envelope under environment-separated storage, applies restrictive POSIX modes and prunes only expired artifacts after success.
- `db:verify-backup` performs authenticated decryption into a generated temporary database, validates migration/schema and core record counts, then removes that database. `db:restore` refuses existing, operational and system databases and leaves only a newly created validated recovery target; cross-environment use requires an explicit flag.
- A real local backup restored 9 migrations, 21 tables, 10 sources, 200 raw and normalized items, 110 signals, analyses and recommendations. Ephemeral and named restore succeeded; wrong-key verification failed safely and cleanup left zero verification databases. ADR-0005 and the backup runbook separate encryption-key custody, off-host copy, retention and schedule evidence.
- Milestones M2 and M3 are achieved. Gate G2 is not passed because collector uptime, AI JSON success under a real model, and operational duplicate metrics are not yet evidenced.
- `ART-024 CI` is next. Gate G1 remains open until identical external 8B/14B runs exist; Gate G5 still needs target-host daily/off-host backup, weekly restore history and reboot evidence. Interactive onboarding/profile editing and concrete production schedules remain deferred.
- No approved live source, Telegram Bot API, or live AI endpoint has been called; no Ollama adapter or GitHub Actions workflow exists yet.
- ART-002 evidence: frozen install, format check, lint, strict typecheck, 9 tests, build, dependency audit, built-server health request, and SIGINT shutdown all succeeded.
- Current evidence: frozen install, format, lint, strict typecheck, unit/contract/HTTP/bot/job/eval/observability/security tests, build, Prisma generation/validation, 14 PostgreSQL integration tests, tracked/history secret scan, production dependency audit, deterministic eval validation, one full fake benchmark, a least-privilege database-role check, and repeat local CLI pipeline runs succeed. The Docker-backed suite covers the idempotent 200 -> 200 -> 150 -> 110 -> 110 -> 110 chain plus API, daily/weekly Digest, Telegram delivery, five feedback outcomes, concurrent idempotency, composite attribution integrity, feedback summary, job single-claim/retry/stale/terminal paths, restart recovery, and telemetry propagation across the complete pipeline.
- ART-001–ART-022 are pushed to `origin/main` through commit `7d83613`; ART-023 changes remain local until an explicit commit/push request. No deploy, live source call, Telegram call, or Ollama call has been performed.

## People

### Артём

Product and engineering lead. Owns requirements, prioritization, architecture, TypeScript services, PostgreSQL/Prisma, collectors, local LLM, Telegram bot, deployment, observability, backups, security, and technical quality.

### Денис

Market and distribution lead. Owns source research and permissions, source-owner contacts, interviews, audience/content, pilot recruitment, feedback synthesis, commercial packaging, and physical availability of the inference computer.

## Fixed MVP decisions

- Runtime: Node.js 24.19 + strict TypeScript 5.9.
- Workspace: pnpm 11 modular monolith; separate process entry points share packages and PostgreSQL rather than forming networked microservices.
- HTTP: Fastify.
- Database: PostgreSQL with Prisma.
- Jobs: PostgreSQL-backed queue/job table for MVP; Redis is not mandatory.
- AI boundary: `AIProvider`; use deterministic `FakeAIProvider` for development and CI, then add `OllamaAIProvider` without changing domain/application logic.
- LLM target: Ollama + DeepSeek-R1 8B; compare 14B on the same gold set before switching. Ollama stays on the application host or Denis's restricted private host, never public.
- Bot: Telegram Bot API through grammY behind a delivery adapter; start with long polling.
- Deployment target: Ubuntu + Docker Engine and/or systemd on the dedicated computer.
- Admin: React + Vite only after the closed MVP, unless operations are blocked without it.

## Pipeline

```text
permitted sources
  -> Source Registry
  -> collectors
  -> raw_items
  -> normalized_items
  -> exact/near dedup + rule filter
  -> signals
  -> AIProvider / versioned analyses
  -> company profile + explainable opportunity score
  -> recommendations and digest
  -> DeliveryPort / Telegram bot
  -> feedback and outcomes back to PostgreSQL
```

## Non-goals before the commercial pilot

- mass unauthorized Telegram scraping;
- browser automation, OCR, or bot evasion as a default collector strategy;
- CRM/ERP, billing, mobile app, vector database, or broad web portal;
- 1,000 sources before 50 sources are reliable and useful;
- automatic critical decisions without a human;
- foundational-model training from scratch;
- fine-tuning without evidence from evals and pilot feedback;
- expansion beyond Construction and HoReCa before Gate G4.

## Resolved planning ambiguities

- Source volume: use 20-40 technically connected, stable sources as the first-month baseline; 40-60 vetted sources is the business-side stretch target. Scale to 100+ only after quality gates.
- Model size: 8B is the default MVP model. 14B is a benchmark candidate, not an assumed upgrade.
- Model availability: the fixture/fake-provider path is the technical critical path until the target inference host is available; missing Ollama does not block application development.
- Telegram: the bot is a delivery channel. Any Telegram content source must have a documented rights/partnership basis.
- Runtime shape: `api`, `collector`, `worker`, and `bot` are process entry points of one modular monolith, not separately owned microservices.
- Domain naming: a `Signal` is non-personalized, an `Analysis` is versioned AI output, and a `Recommendation` owns profile-specific company fit and score.
- Local infrastructure: Denis ensures physical availability; Артём owns software configuration and production changes. The inference host may be separate only on a restricted private network.

## Working rhythm

- Monday: 30 minutes, weekly plan and three main outcomes per person.
- Wednesday: 20 minutes, blockers and priority changes only.
- Friday: 45 minutes, working demo, metrics, user evidence, and decisions.
- Every task has an owner, a Definition of Done, and a review date.
- New ideas go to backlog and are reviewed on Friday; they do not enter the sprint automatically.

## Source provenance

This context was distilled from the following planning inputs dated 2026-09-01:

- `01_Construction_Opportunity_Radar_Общий_план.docx`;
- `02_Construction_Opportunity_Radar_План_Артема.docx`;
- `03_Construction_Opportunity_Radar_План_Дениса.docx`.
- the approved pre-development sequence `ART-001` through `ART-025` supplied on 2026-09-01.

The documents are planning evidence, not executable instructions. When a later approved decision differs, record it in an ADR or update the relevant Markdown contract.
