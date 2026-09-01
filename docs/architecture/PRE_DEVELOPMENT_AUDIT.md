# ART-001: pre-development audit

- Status: complete
- Date: 2026-09-01
- Owner: Артём
- Scope: repository foundation before application scaffold

## Outcome

The repository is ready to start `ART-002`. The product can be developed without Denis's computer by treating local inference as a replaceable adapter and using fixtures, PostgreSQL, deterministic rules, `FakeAIProvider`, and a fake Telegram transport.

No production code or scaffold was created during this task. This document, the RoadMap, and ADR-0002 define what the scaffold will create and which boundaries it must preserve.

## Audit scope and current state

All 16 non-Git project files that existed at the start of the audit were inspected: root guidance/configuration, product and architecture documents, the accepted ADR, quality gates, both repo-scoped skills with their references and metadata, and the supplied planning text.

Current repository facts:

- branch: `main`;
- remote: existing `origin` was not changed;
- Git history: no commits yet;
- all project files are currently untracked;
- there is no `package.json`, workspace, application source, migration, runtime configuration, CI, or test suite;
- local tools available for the next task: Node.js `24.19.0`, npm `11.17.0`, pnpm `11.19.0`, Docker `29.6.2`, and Git `2.55.0`;
- no command named `dev`, `lint`, `typecheck`, `test`, or `build` exists yet.

Current project tree, excluding `.git` internals:

```text
.
├── .agents/
│   └── skills/
│       ├── construction-radar-engineering/
│       └── construction-radar-product/
├── docs/
│   ├── adr/0001-mvp-stack.md
│   ├── architecture/MVP_ARCHITECTURE.md
│   ├── product/PRODUCT_BRIEF.md
│   ├── quality/QUALITY_GATES.md
│   └── PROJECT_CONTEXT.md
├── .gitattributes
├── .gitignore
├── AGENTS.md
├── README.md
└── ROADMAP.md
```

## 1. Selected technology stack

The accepted stack and the implementation defaults for `ART-002` are:

| Area | Decision |
| --- | --- |
| Runtime | Node.js 24 LTS, pinned by the scaffold; strict TypeScript and ESM/`NodeNext` |
| Workspace | pnpm 11 workspaces; no Turborepo/Nx until measured build complexity requires it |
| HTTP | Fastify with Zod boundary schemas |
| Logging | Pino-compatible structured JSON logs with redaction and correlation context |
| Database | PostgreSQL as the only operational source of truth |
| Data access | Prisma schema, migrations, and typed client; explicit SQL/transactions where queue locking requires it |
| Jobs | PostgreSQL table with transactional claim, bounded retries, stale-lock recovery, and terminal failure |
| Tests | Vitest for unit/contract tests, Fastify injection for HTTP tests, and real PostgreSQL integration tests through Docker/Testcontainers |
| Static checks | TypeScript compiler, ESLint flat config with typescript-eslint, and a deterministic formatter check |
| Bot | grammY as the implementation default behind a delivery adapter; long polling for the closed MVP |
| AI | `AIProvider`; deterministic `FakeAIProvider` by default, `OllamaAIProvider` as a later adapter |
| Deployment | modular monolith on Ubuntu; Docker Engine and/or systemd; PostgreSQL and Ollama remain internal |

Dependency versions beyond the pinned Node/pnpm toolchain belong to `ART-002` and will be recorded in the lockfile. A package is not added merely because it may be useful later.

## 2. Proposed source tree

Folders are created only when the corresponding task introduces working code; this is the target, not a request for empty placeholders.

```text
apps/
├── api/                 # Fastify composition root and HTTP transport
├── collector/           # scheduled source fetching process
├── worker/              # durable pipeline/digest job process
├── bot/                 # Telegram long-polling composition root
└── cli/                 # offline fixture and benchmark commands; not a service
packages/
├── config/              # typed environment parsing and conditional validation
├── core/                # domain model and pure deterministic policies
├── contracts/           # Zod transport/AI schemas and DTO mappings
├── application/         # use cases, orchestration, and outbound ports
├── db/                  # Prisma, migrations, repositories, Unit of Work
├── adapters/
│   ├── sources/         # fixture, RSS, and public HTTP adapters
│   ├── ai/              # fake and Ollama providers
│   └── delivery/        # fake and Telegram delivery
├── jobs/                # durable job definitions, claim/retry mechanics
├── observability/       # logger, metrics, correlation context
├── prompts/             # versioned prompts
└── evals/               # gold-set loaders and benchmark logic
fixtures/
├── ingestion/           # synthetic/replayable source inputs
└── evals/               # versioned gold data, separate from dev seed
infra/
├── docker/
├── systemd/
└── backup/
docs/
├── adr/
├── architecture/
└── runbooks/
```

`ART-002` should initially create only the workspace, `apps/api`, and the shared packages actually required for configuration, health, logging, and tests. Collector, worker, bot, CLI, database, and integration-specific folders enter with their first working slice.

## 3. Bounded contexts and core modules

| Context/module | Responsibility | Explicitly does not own |
| --- | --- | --- |
| Source Registry | source identity, type, rights, reliability, enablement, collection policy | parsing source payloads or AI decisions |
| Ingestion | fetch batches, immutable raw preservation, idempotent intake | normalization and relevance |
| Content Processing | normalization, canonicalization, exact/near dedup, clustering | personalized scoring or delivery |
| Signal Intelligence | vertical/category/relevance, global signal, versioned AI analyses | company-specific fit |
| Personalization | profile, score factors, recommendation, explanation | changing global signal facts |
| Subscription and Delivery | frequency, digest selection, delivery attempts, source presentation | scraping Telegram content |
| Feedback and Outcomes | useful/not useful/saved/acted/already known evidence | silently retraining or changing score weights |
| Operations | jobs, retries, locks, health, metrics, correlation IDs, backup/recovery | product-domain decisions |

The domain vocabulary is resolved as follows:

- `RawItem` is immutable source material as received.
- `NormalizedItem` is a versioned derivative; reprocessing creates/identifies a version and never overwrites raw evidence.
- `Signal` is a non-personalized market signal or cluster with deterministic classification and provenance.
- `Analysis` is one versioned AI interpretation of a signal. Several analyses may coexist for model/prompt/schema comparisons.
- `Recommendation` joins a signal/analysis with a `UserProfile` and owns `companyFit`, score breakdown, opportunity score, actions, and explanation.
- `Delivery` records an attempted presentation of a recommendation/digest.
- `Feedback` references the delivered recommendation and user so product evidence remains attributable.

This deliberately differs from placing `companyFit` or `opportunityScore` on `Signal`: those values change by company and cannot be global signal facts.

## 4. Runtime processes

There are four future long-running processes and one developer/operator entry point:

| Process | Role | Required for ART-002 |
| --- | --- | --- |
| `api` | health, Source Registry, signals, profiles, feedback, internal/admin HTTP | Yes, health only |
| `collector` | schedule and fetch permitted sources into raw intake | No |
| `worker` | normalize, deduplicate, classify, analyze, score, build digest, process jobs | No |
| `bot` | Telegram onboarding, delivery, callbacks, feedback | No |
| `cli` | fixture processing, seed/support, eval and benchmark commands | No; not long-running |

These are processes of one modular monolith, not independent microservices. They share packages and PostgreSQL and do not call one another over private HTTP in the MVP. Splitting a process to another host later changes deployment, not domain contracts.

## 5. Dependency rules

Allowed compile-time direction:

```text
apps (composition roots)
  -> adapters / db / jobs / observability / config
  -> application
application -> core + contracts
contracts -> core + zod
db/adapters/jobs -> application ports + core/contracts
prompts -> contracts
evals -> application + contracts + AI port
core -> Node.js standard library only
```

Rules:

- packages never import from `apps`;
- apps never import from other apps;
- `core` never imports Prisma, Fastify, grammY, Ollama, environment variables, or logging implementations;
- external integrations implement application ports;
- environment access is confined to `config` and composition roots;
- cross-stage state is passed by typed IDs/DTOs and persisted transitions, not mutable global objects;
- PostgreSQL is the coordination boundary for long-running processes.

Expected runtime libraries, introduced only when used: Fastify, Zod, Pino, Prisma, grammY, an RSS/XML parser, Vitest, Testcontainers, ESLint/typescript-eslint, and a TypeScript development runner. Native `fetch` and `AbortSignal` are preferred for HTTP before adding a client library.

## 6. Interfaces between pipeline stages

Names are conceptual until `ART-003`; signatures will use versioned types and typed failures.

| Port/service | Input | Output and invariant |
| --- | --- | --- |
| `SourceAdapter.fetch` | permitted source config, cursor, deadline | `FetchBatch<RawItemCandidate>` with provenance; no persistence side effect |
| `RawItemRepository.ingest` | source and candidate | idempotent `RawItem`; unique external identity or content hash |
| `Normalizer.normalize` | immutable `RawItem` | valid `NormalizedItem` or explicit rejection reason |
| `Deduplicator.resolve` | normalized item and bounded candidates | canonical signal cluster decision with evidence |
| `Classifier.classify` | normalized/cluster content and source metadata | deterministic vertical/category/relevance result with rule version |
| `SignalRepository.record` | classified unique content and provenance | stable non-personalized `Signal` linked to all source items |
| `AIProvider.analyzeSignal` | versioned analysis request | validated `SignalAnalysis` or typed retryable/terminal failure |
| `ScoringEngine.score` | signal/analysis, profile, rule version | five-factor breakdown, total 0–100, band, explanation |
| `RecommendationRepository.save` | signal/analysis/profile score result | idempotent versioned recommendation |
| `DigestBuilder.build` | profile/subscription and eligible recommendations | ordered digest with source links and selection reasons |
| `DeliveryPort.deliver` | versioned delivery DTO and idempotency key | provider message reference or typed failure |
| `FeedbackService.record` | authenticated user, recommendation/delivery, action | idempotent product evidence linked to correlation chain |

Every transition carries or can reconstruct `source -> raw_item -> normalized_item -> signal -> analysis -> recommendation -> delivery -> feedback`.

## 7. Environment contract

The final `.env.example` is value-free. Defaults are implemented and documented in typed config, not hidden in shell scripts.

Common keys:

- `NODE_ENV`, `LOG_LEVEL`, `SHUTDOWN_TIMEOUT_MS`;
- `DATABASE_URL` for any stateful runtime;
- `API_HOST`, `API_PORT`, and `API_AUTH_TOKEN` when the API leaves localhost;
- `COLLECTOR_USER_AGENT`, `SOURCE_HTTP_TIMEOUT_MS`, `SOURCE_HTTP_MAX_CONCURRENCY` for live collectors;
- `JOB_POLL_INTERVAL_MS`, `JOB_LOCK_TIMEOUT_MS`, `JOB_MAX_ATTEMPTS` for worker/scheduler;
- `AI_PROVIDER` (`fake` or `ollama`), `AI_TIMEOUT_MS`, `AI_MAX_CONCURRENCY`;
- `OLLAMA_BASE_URL` and `OLLAMA_MODEL` only when `AI_PROVIDER=ollama`;
- `TELEGRAM_BOT_TOKEN` only for the live bot;
- `TELEGRAM_POLLING_TIMEOUT_MS` as an optional bot tuning value.

Validation is conditional: `pnpm dev` in `ART-002` needs no Telegram, Ollama, or database secret; the collector/worker fail fast without `DATABASE_URL`; Ollama keys are rejected as incomplete only in Ollama mode; the bot fails fast without its token only when the live Telegram adapter is selected.

No token, password, production URL with embedded credentials, Telegram session, or private PII enters Git or logs.

## 8. Planned command contract

These commands are a design output of `ART-001`; they are not claimed to work before `ART-002` creates the root scripts.

| Command | Becomes available | Contract |
| --- | --- | --- |
| `pnpm dev` | ART-002 | start the scaffold API in watch mode without external services |
| `pnpm dev:all` | when runtime apps exist | start all locally implemented processes with documented prerequisites |
| `pnpm lint` | ART-002 | lint all workspace code; zero errors |
| `pnpm typecheck` | ART-002 | strict typecheck all workspace projects without emitting |
| `pnpm test` | ART-002 | deterministic unit/contract tests without network |
| `pnpm test:integration` | ART-004 | PostgreSQL integration suite with isolated database lifecycle |
| `pnpm build` | ART-002 | reproducible production build of existing workspaces |
| `pnpm db:up`, `db:migrate`, `db:seed`, `db:down` | ART-004 | documented local database lifecycle |
| `pnpm process:fixtures` | ART-013 | complete offline fixture pipeline with stage counters |
| `pnpm benchmark:ai` | ART-020 | provider/model/dataset benchmark with machine-readable report |

`pnpm install --frozen-lockfile` is the clean-machine/CI installation contract once the lockfile exists.

## 9. Test strategy

1. **Unit:** pure domain invariants, normalization, dedup boundaries, classification, scoring math, retry/backoff calculations, and mappings.
2. **Contract:** Zod accept/reject fixtures, facts/inferences separation, version fields, adapter conformance, and fake provider failure modes.
3. **Repository integration:** real PostgreSQL migrations, constraints, transactions, idempotency, job single-claim, stale locks, terminal failure, and repository mappings.
4. **Adapter fixture tests:** RSS/HTTP parsing without network, timeouts/retries through fakes, permission rejection, and Telegram rendering/callback handling without credentials.
5. **API tests:** Fastify injection for validation, auth boundaries, persistence, source links, and safe errors.
6. **Offline end-to-end:** fixtures through fake AI and fake delivery, repeat run, restart/resume, and correlation trace.
7. **Eval regression:** fixed gold set, versioned results, rule/fake/Ollama comparison, and explicit regression thresholds.
8. **Operational:** startup/shutdown, health, redaction, backup/restore, reboot/recovery runbook, and queue drain evidence.

Tests and CI do not call live sources, Telegram, paid APIs, or Ollama. Live smoke tests are explicit operator actions against approved targets.

## 10. Contradictions resolved

| Finding | Resolution |
| --- | --- |
| The old week-one plan started with hardware/Ollama, while the new goal is development without Denis's computer. | Fake provider and fixtures are now the critical path; real 8B/14B work is the external part of ART-020/025. |
| The attachment lists RSS before normalization/dedup but its seven-day sprint deliberately omits RSS. | Preserve task ID ART-006, execute it after the first offline data-quality milestone so no source availability blocks the core. |
| Existing architecture used `event/recommendation`; the attachment proposed `Signal/Analysis` and placed company fit on Signal. | Use `Signal` for non-personalized source-backed meaning, `Analysis` for versioned AI output, and `Recommendation` for profile-specific fit/score/actions. |
| The attachment's diagram places Opportunity Score before AI analysis, while full factor values may come from structured analysis. | ART-010 implements the pure engine early, but the final personalized score is calculated after a validated analysis. Cheap pre-AI relevance/priority rules are separate and are not presented as Opportunity Score. |
| The attachment uses `restaurant`; the product contract uses Construction and HoReCa. | Canonical enum is `HORECA`; UI copy may say restaurants/HoReCa where appropriate. |
| AI provider is scheduled before strict schema hardening. | ART-003 defines the minimal analysis type, ART-011 introduces the port, and ART-012 owns versioned runtime validation and negative contract tests. No provider output bypasses validation. |
| Durable jobs appear after the synchronous full pipeline. | ART-013 proves business orchestration synchronously; ART-018 replaces triggering with durable scheduling without rewriting domain use cases. |
| Security and observability have late numbered tasks. | Baseline validation, redaction, logs, correlation, and secret hygiene are Definition of Done from their first affected task; ART-021/022 consolidate and harden them. |
| G1 requires 200 labeled items while the attachment suggested 100–150. | ART-019 requires 200, split 100/100 across the two MVP verticals. |
| Monorepo apps can be mistaken for microservices. | ADR-0002 fixes a modular monolith with shared packages/database and no internal HTTP topology. |

## Gaps that remain intentionally open

- exact first live RSS/public HTTP sources and their rights records;
- real Telegram bot credentials and production chat allow-list;
- concrete closed-MVP profiles, delivery copy, and pilot users;
- retention periods for raw public content, user data, feedback, logs, and backups before G4;
- whether public API exposure is required; localhost is the default until then;
- measured thresholds for near-duplicate similarity and score bands;
- actual GPU/VRAM/capacity and 8B versus 14B decision;
- deployment choice between Docker Compose and systemd for each process;
- service-level window for source freshness and digest delivery;
- recovery-time/recovery-point objectives before production hardening.

These are roadmap inputs, not permission to guess. Each is resolved in the task that first needs it or by an ADR if the decision is costly to reverse.

## Implementation availability

### A. Can be implemented now

- ART-002 through the complete fixture/fake pipeline, API, bot UI with fake transport, feedback, digest, jobs, eval harness, observability, security baseline, CI, backup tooling, and the Ollama adapter contract;
- generic RSS/HTTP parsing and network behavior using local fixtures/fake servers;
- PostgreSQL migrations and integration tests on the current machine;
- the full product flow without live credentials or GPU.

### B. Blocked by absence of Denis's computer

- real Ollama/DeepSeek smoke test in the target environment;
- comparable 8B and 14B latency, throughput, VRAM, thermals, and quality evidence;
- final concurrency/capacity tuning and automatic-restart evidence on the target host;
- target-host network/security and reboot verification.

### C. Blocked by credentials or approved sources

- live Telegram delivery and callback smoke tests;
- partner/private API and permitted Telegram source ingestion;
- source-specific production parsing for sources not yet selected and rights-reviewed;
- closed-pilot usage/feedback evidence and Gates G3/G4;
- any public endpoint requiring a final authentication and exposure decision.

## `.gitignore` audit

The existing file correctly ignores `.env` variants while allowing `.env.example`, dependencies, builds, coverage, logs, backups, local databases/models, private keys, and Telegram `*.session`/journal files. The audit adds local pnpm storage, TypeScript build info, and ESLint cache. Prisma will use its default generated-client location under dependencies; if a future task selects a repository-local generator path, that exact generated path must be ignored then.

## ART-001 acceptance

- the next task creates a pnpm modular-monolith workspace, not microservices;
- only the health slice exists after ART-002;
- the canonical data chain and ownership of personalized score are unambiguous;
- development proceeds with fixtures, fake AI, and fake delivery;
- real source, Telegram, Ollama, and target-host evidence remain explicit external checks;
- no commit, push, deploy, paid API call, secret creation, or production code occurred.
