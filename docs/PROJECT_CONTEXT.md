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
- `ART-010 Opportunity scoring` is next. Company fit remains profile-specific and must not be added to the global signal.
- No approved live source has been called; no AI/delivery adapter or CI exists yet.
- ART-002 evidence: frozen install, format check, lint, strict typecheck, 9 tests, build, dependency audit, built-server health request, and SIGINT shutdown all succeeded.
- Current evidence: frozen install, format, lint, strict typecheck, 86 unit/contract tests, build, Prisma generation/validation, 9 PostgreSQL integration tests, dependency audit, and the local four-stage CLI flow succeed. The Docker-backed fixture run proves idempotent 200 raw -> 200 normalized -> 150 classified clusters -> 110 persisted signals.
- The ART-001–ART-008 implementation, including ART-006, is committed and pushed to `origin/main` through commit `464aa94`; ART-009 changes are local until an explicit commit/push request. No deploy, live source call, Telegram call, or Ollama call has been performed.

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
