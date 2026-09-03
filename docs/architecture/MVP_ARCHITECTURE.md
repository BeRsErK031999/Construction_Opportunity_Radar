# MVP architecture

## Architecture goals

- develop and test the complete product without the target inference computer;
- reliable restart and recovery on one small deployment;
- traceability from source to delivered recommendation and feedback;
- explicit legal/rights boundary before AI processing;
- inexpensive filtering before model work;
- replaceable source, AI, and delivery adapters;
- versioned, testable contracts for normalization, AI output, scoring, and prompts;
- simple operations before horizontal scale.

## Architecture style

The MVP is a modular monolith in a pnpm/TypeScript workspace. `api`, `collector`, `worker`, and `bot` are separate composition roots and future long-running processes, not independently designed microservices. A later `cli` provides offline fixture/eval commands but is not a service.

Processes share application/domain packages and PostgreSQL. They do not call one another through private HTTP/RPC in the MVP. PostgreSQL is the durability and job-coordination boundary. See ADR-0002 for dependency and provider decisions.

## Planned repository layout

```text
apps/
  api/          # Fastify health, registry, profile, signal, feedback APIs
  collector/    # permitted source fetching
  worker/       # processing, AI, scoring, digest jobs
  bot/          # Telegram delivery and feedback
  cli/          # fixture processing and benchmark commands
packages/
  config/       # typed and conditional environment validation
  core/         # domain model and pure deterministic policies
  contracts/    # versioned Zod DTO and AI schemas
  application/  # use cases and outbound ports
  db/           # Prisma schema, migrations, repositories, Unit of Work
  adapters/
    sources/    # fixture, RSS, public HTTP
    ai/         # fake and Ollama
    delivery/   # fake and Telegram
  jobs/         # PostgreSQL-backed job runtime
  observability/# structured logger, metrics, correlation context
  prompts/      # versioned prompts
  evals/        # gold datasets and benchmark logic
fixtures/
  ingestion/
  evals/
infra/
  docker/
  systemd/
  backup/
docs/
  adr/
  architecture/
  runbooks/
.env.example
```

The folders are a target, not a reason to create empty placeholders. Add each app or package only when its first working vertical slice needs it.

## Dependency direction

```text
apps/composition roots
  -> config + observability + adapters + db + jobs
  -> application
application -> core + contracts
contracts -> core + Zod
db/adapters/jobs -> application ports + core/contracts
prompts -> contracts
evals -> application + contracts + AI port
core -> Node.js standard library only
```

Packages never import from `apps`; apps never import from other apps. Domain code has no Fastify, Prisma, grammY, Ollama, environment, or concrete-logger dependency.

## Canonical pipeline

```text
permitted sources
  -> Source Registry rights check
  -> SourceAdapter
  -> RawItem (immutable)
  -> NormalizedItem (versioned derivative)
  -> exact/near dedup and source cluster
  -> deterministic vertical/category/relevance rules
  -> Signal (non-personalized)
  -> AIProvider -> Analysis (zero or many versions)
  -> UserProfile + ScoringEngine
  -> Recommendation
  -> Digest -> DeliveryPort
  -> Feedback
```

The `ScoringEngine` can be implemented and tested before AI integration because it is a pure function. In the complete runtime flow, the personalized opportunity score is calculated from the profile and validated signal/analysis factors. A cheap pre-AI rule priority may decide whether analysis is worth running, but it is not presented as the final Opportunity Score.

## Components

### Source Registry and source adapters

`SourceAdapter.fetch()` returns a batch of raw-item candidates and fetch metadata; it does not write the database. MVP adapters support fixtures, RSS, public JSON/HTTP APIs, and simple HTML with stable selectors. Browser automation and OCR are deferred.

Every source records identity, URL/type, vertical hints, owner/contact when applicable, rights status, `ai_processing_allowed`, parser config, polling policy, reliability, and operational state.

Collectors must:

- preserve source URL, external ID, original URL, publication timestamp, raw text/payload, and fetch metadata;
- be idempotent by `source_id + external_id`, falling back to a content hash when external identity is absent;
- record last success/error, counts, and latency;
- prevent overlapping fetches for the same source;
- refuse AI enqueue when rights or `ai_processing_allowed` do not permit it;
- use timeout, bounded retry, rate limits, and an identifying user-agent for live HTTP.

`rss-http-v1` is the first live-source-capable adapter. Its production transport limits a response to 2 MiB, uses a 10-second request timeout, performs at most three attempts for network failures and selected transient HTTP statuses, applies exponential backoff plus `Retry-After`, and reserves requests per origin at least one second apart. RSS 2.0 and Atom mapping is versioned; parsed item payloads retain feed URL/format, external identity, raw publication value, original URL, title, and unnormalized item text. Transport, clock, and sleep are injected so all collector tests remain offline.

Collection and AI permission are deliberately separate. A disabled or `BLOCKED` source is not fetched. `REVIEW_REQUIRED` material may be preserved as raw evidence only in the controlled fixture/manual review flow; a live source still cannot be fetched. Review material is never returned as AI-processing-permitted until the registry has both an eligible rights status and a documented basis.

Telegram ingestion is not a special central path. A future permitted/partner Telegram source must implement the same source port and rights checks. Mass unauthorized scraping is out of scope.

### Raw preservation, normalization, and deduplication

`RawItem` is immutable evidence. Reprocessing never deletes or rewrites the received body/payload.

Normalization removes HTML/boilerplate, standardizes whitespace and dates, detects language metadata, and creates a canonical URL and normalized representation with a version. Empty/invalid input becomes an explicit `normalization_attempts` rejection, not a silently missing or partially valid normalized record.

Exact deduplication uses source external identity, canonical URL, and SHA-256 of normalized content. `deduplicator-v1` limits near-duplicate comparison to shared source vertical hints and a seven-day window, uses three-token overlap with a `0.95` threshold, and records representative/direct-match evidence, similarity, distance, and policy version. False-positive fixtures and before/after metrics protect recall; policy changes require a new version.

Several `RawItem`/`NormalizedItem` records may support one `Signal`; provenance from all supporting items remains queryable.

### Deterministic classification and filtering

Initial verticals are `CONSTRUCTION`, `HORECA`, and `OTHER`. Source metadata, dictionaries, region/category rules, and negative/ad patterns provide the baseline. Rules and taxonomy are versioned.

`classifier-v1` consumes one `deduplicator-v1` cluster at a time. Permission is checked before text rules: if the dedup representative is not AI-permitted, the earliest permitted member becomes the classification input; if no member is permitted, the outcome is `PERMISSION_DENIED` and no text is exposed as AI input. An eligible decision exposes only permitted cluster members, while the dedup table retains the full evidence graph.

The classifier combines one-point source vertical hints with explicit Construction/HoReCa dictionaries, then applies advertisement, explicit-negative, ambiguity, and opportunity-cue rules. Outcomes are `AI_ELIGIBLE`, `IRRELEVANT`, or `PERMISSION_DENIED`; every decision carries stable reason/rule IDs, vertical scores, `classifier-v1`, and `signal-taxonomy-v1`. Only `AI_ELIGIBLE` decisions become `CANDIDATE` signals. Signal identity includes the dedup representative and all three policy versions; matched rules and permitted provenance links are saved atomically.

The checked-in fixture corpus produces 150 classification decisions: 110 AI-eligible signals, 28 irrelevant clusters, and 12 clusters without permitted evidence. A repeat run creates no signals. Rule rejection and uncertainty remain measurable; fixture labels are not classifier input and the system does not maximize filtering before recall is understood.

### PostgreSQL jobs

The MVP uses a `processing_jobs` table with job type, versioned payload, entity/concurrency/idempotency keys, correlation ID, status, attempts, `scheduled_at`, `locked_at`, explicit lease expiry/owner, completion time, and last error. Workers use `FOR UPDATE SKIP LOCKED` transactional claiming, owner-checked lease renewal/completion, bounded exponential backoff, stale-lock recovery, active-job overlap protection, and terminal `FAILED` status. Fixed-interval schedules derive deterministic current-window idempotency keys; missed windows are not backfilled automatically. Redis is unnecessary until PostgreSQL is proven insufficient.

`ART-013` first proves the same application use cases through a synchronous offline orchestrator. `ART-018` adds durable triggering and scheduling without duplicating domain logic.

### AI provider and structured analysis

Application logic depends on:

```text
AIProvider
  analyzeSignal(request) -> validated SignalAnalysis or typed failure
  healthCheck() -> provider health
  modelInfo() -> provider/model capabilities and identity
```

`FakeAIProvider` is deterministic and remains the default in local development and CI. `OllamaAIProvider` implements the same port through the private Ollama API. Ollama may run on the same host or behind a restricted private transport; it is never publicly exposed.

The `ART-011` application boundary builds provider input only through `createAIAnalysisRequest`. It accepts domain Signal/NormalizedItem/Source values, requires a candidate or active Signal, exact evidence coverage, unique Signal-backed item/source pairs, and rechecks the source's current `ai_processing_allowed` policy before every provider call. The resulting immutable request exposes text, canonical URL, publication time, normalized/source IDs, and classification dimensions; rights basis, owner contact, and provider-specific settings do not cross the port.

Provider failures use stable codes for invalid/oversized input, timeout, unavailability, rate limiting, invalid response, and internal failure, with an explicit retryability flag and safe messages. The fake adapter supports deterministic success, domain-valid failed Analysis, typed thrown failure, healthy/unhealthy state, and an advertised input-character bound. It performs no network call.

`ART-012` implements the transport boundary as strict `ai-analysis/v1`. `AIAnalysisResponseV1Schema` rejects unknown fields, surrounding-whitespace repair, invalid score/confidence ranges, oversized collections/text, fewer than two or more than five actions, duplicate identifiers, inference bases outside the response, and a declared source set that differs from fact provenance. `analysisFromAIResponseV1` then compares analysis/signal/correlation identity, provider/model and all versions/timestamps to the request, and rejects source IDs outside its permission-checked evidence. Only after both layers pass are string IDs converted to branded domain IDs. Any schema, identity, provenance, or final domain failure becomes a safe non-retryable failed Analysis with `AI_INVALID_RESPONSE`; untrusted output is never copied into the failure reason.

`ART-019` keeps AI evaluation outside the operational ingestion path. `fixtures/evals/v1` is a Git-versioned, project-authored synthetic technical baseline; `packages/evals` loads it through the strict `eval-gold/v1` contract. The contract enforces the 100/100 vertical balance, relevance and split counts, action/category consistency, and a verbatim source fragment for every expected fact. Calibration data may support prompt work; holdout data is reserved for final runs. Neither split is inserted into PostgreSQL or presented as live-source or human-adjudicated evidence.

`ART-020` adds an offline evaluator without a second AI domain. Eval items are converted through the same domain constructors and `createAIAnalysisRequest`; source vertical is the only label-derived provider hint, while category and relevance inputs stay neutral and expected labels remain evaluator-only. Returned successful Analysis values must pass `ai-analysis/v1`, request identity/version, and source-union checks before scoring. `ai-benchmark-report/v1` keeps response validity, provider failures, classification, conservative exact-evidence factuality, latency, and optional provider-supplied token/VRAM telemetry distinct. Dataset SHA and every behavior-affecting version are recorded so 8B/14B comparisons cannot silently use different inputs. Fake results prove orchestration only; external model runs remain necessary for Gate G1.

`ART-025` adds the target-host adapter without changing application or domain logic. Configuration is provider-discriminated: `fake` requires no Ollama values, while `ollama` requires an exact model and applies bounded input/output, timeout, deterministic context/seed, keep-alive and concurrency settings. Ollama calls are non-streaming structured `/api/chat`; `/api/tags` health requires the exact configured model and never pulls it. Loopback is the default; direct remote use requires explicit private HTTPS configuration, with a loopback tunnel preferred. The adapter delegates retry to durable jobs and passes token/generation metrics to the existing benchmark report. ADR-0006 and `docs/runbooks/OLLAMA_INTEGRATION.md` define the host contract; real 8B/14B and GPU evidence remain external.

`ART-021` keeps telemetry outside the domain model. Application and job runtime own small typed observer ports; `@radar/observability` is their composition adapter and may use Pino plus a process-local counter registry without becoming an application dependency. Calls are fail-open, so logging or counter failures cannot turn a saved analysis/delivery into a retry. Structured events carry `correlation_id` for entity chains, `source_id` for source summaries and `run_id` for batch summaries. Metric labels are restricted to finite outcome/stage/kind/job-type dictionaries; IDs, model/provider strings, URLs, payloads and user data remain log-only or omitted. PostgreSQL continues to own durable state, while `radar_metrics/v1` is a restart-scoped operational snapshot.

The versioned `SignalAnalysis` contract includes at least:

```text
headline
summary
whyImportant
eventType
facts[]
inferences[]
entities[]
risks[]
candidateActions[]
deadline
businessImpact
urgency
confidence
actionability
sourceIds[]
model
promptVersion
schemaVersion
analysisVersion
createdAt
```

Rules:

- facts and inferences remain separate;
- unknown values are `null` or `unknown`, never invented;
- every factual claim is attributable to source IDs;
- input/output bounds, timeout, retry, and concurrency are explicit;
- invalid output never becomes a successful `Analysis`;
- repair, if introduced, is measured and versioned rather than silently hiding failures;
- multiple analyses for a signal may coexist for reproducibility and benchmarks;
- logs include versions, latency, token counts when available, and safe diagnostics without secrets/private PII.

### Profiles, scoring, and recommendations

Company Fit is deterministic where possible. The versioned score is:

```text
0.35 * BusinessImpact
+ 0.25 * CompanyFit
+ 0.20 * Urgency
+ 0.10 * Confidence
+ 0.10 * Actionability
```

Each factor and total are 0–100. Persist the factor breakdown, rule version, total, band, explanation, analysis version, and candidate actions. Weight/threshold changes require evidence and a new version; the model cannot change them.

`Signal` is global. `Recommendation` references one signal/analysis and one profile and owns `companyFit` and the final Opportunity Score, allowing two companies to receive different explainable rankings for the same signal.

`opportunity-score-v1` freezes weights at `35/25/20/10/10` and uses inclusive bands: `IGNORE < 40`, `LOW >= 40`, `MEDIUM >= 55`, `HIGH >= 70`, `CRITICAL >= 85`. Analysis confidence is a probability and is explicitly converted to the `0..100` scoring factor. Every factor contribution and the arithmetic explanation are returned with the version; `createRecommendationFromScoreV1` maps this exact result into the persisted Recommendation fields.

Company Fit v1 is a separate deterministic profile policy: vertical 30%, region 25%, event type 20%, offering/keyword/target-client terms 15%, and project value/currency 10%. Missing candidate evidence receives a visible neutral factor of 50 instead of being treated as a match. Region, event, offering, and value mismatches remain visible through stable reason codes. An explicitly ignored event or excluded keyword returns the business outcome `EXCLUDED`; no total/band is emitted and no Recommendation should be created. These baseline weights and thresholds are provisional until eval/pilot evidence justifies a new version.

### API

Fastify exposes health first, then signals, sources, profiles, and feedback. All input/output contracts are versioned/validated. Public exposure is not assumed: localhost/internal access is the default until authentication, authorization, and rate limiting are explicitly configured.

### Telegram delivery

Use grammY and long polling for the closed MVP behind semantic delivery ports. ART-015 implements private-chat access for pre-registered users, the exact five-item menu, current and saved opportunity cards, profile inspection, help, and card feedback. ART-017 makes the Digest menu build and deliver an idempotent current UTC daily top-5; weekly construction uses the same application boundary. Interactive onboarding/profile editing, frequency, durable retry, and scheduled delivery remain separate product steps.

Cards show score, why it matters, the first two-to-three prioritized practical actions, and the permitted source link. A `Delivery` is persisted as `PENDING` before transport and then as immutable `SENT` or `FAILED`; `(channel, interaction + recommendation)` makes replay idempotent. Callback payloads carry only a compact action and delivery UUID, then persist feedback with the user/recommendation/delivery/correlation chain. A fake delivery adapter supports local/CI tests without a token.

The bot is a delivery interface, not a reader for arbitrary third-party channels. Tokens remain only in secrets/env and never in Git or logs; no live Bot API call is part of the offline verification path.

`digest-v1` reads compact, persisted Recommendation data only. One immutable Digest is identified by user, kind, UTC period, and version; it records the profile revision and up to five ranked Recommendation links. Weekly summaries store stage activity counts and positive category deltas against the previous equal period. `DigestDelivery` is separate from card Delivery so digest idempotency cannot weaken the Delivery/user/Recommendation foreign key used by Feedback.

### Feedback and outcomes

Persist `USEFUL`, `NOT_USEFUL`, `SAVED`, `ACTED`, and `ALREADY_KNOWN` with user, recommendation/delivery, timestamp, optional reason, and correlation context. One action per user/recommendation is idempotent even when concurrent transport callback IDs differ; `USEFUL` and `NOT_USEFUL` are mutually exclusive.

ART-016 adds a caller-owned read model across direct HTTP and Telegram actions. Feedback coverage is distinct successfully delivered recommendations with any action divided by distinct successfully delivered recommendations; positive sentiment is `USEFUL / (USEFUL + NOT_USEFUL)`. Counts are all-time until a versioned period/cohort contract is justified. `HIGH`/`CRITICAL` recommendations marked `NOT_USEFUL` retain score, headline, reason, attribution, and IDs for review. These metrics inform measured rule/prompt changes but never silently change scoring weights or model behavior.

### Admin after closed MVP

React + Vite remains deferred until after the closed MVP unless database queries/internal endpoints cannot support safe operations. It is not part of the Denis-computer readiness path.

## Core data model

- `sources`: identity, routing, rights/AI permission, parser/schedule, reliability, operational status.
- `raw_items`: immutable source/external identity, URL, publication/receipt time, raw text/payload, content hash, correlation ID.
- `normalized_items`: valid raw-derived representation with normalizer version, title/text/language/date/entities, canonical URL, and normalized hash.
- `normalization_attempts`: versioned success/rejection outcome for every attempted raw item.
- `deduplication_assignments`: versioned representative and direct match evidence for every normalized item.
- `signals`: non-personalized classification/relevance/category/status, rule versions, timestamps.
- `signal_sources`: links a signal to all supporting raw/normalized items and dedup evidence.
- `analyses`: versioned structured AI output, facts/inferences/entities/actions, model/prompt/schema versions, status/error.
- `company_profiles`: company and interest dimensions used for fit.
- `recommendations`: signal/analysis/profile tuple, factor breakdown, total/band, explanation, actions, versions.
- `users`: Telegram identity and lifecycle status without unnecessary PII.
- `subscriptions`: topics, regions, frequency, delivery state.
- `deliveries`: individual Recommendation-card transport attempt, idempotency/provider reference, status/error.
- `digests`, `digest_items`, `digest_category_trends`: versioned daily/weekly snapshot, ranked Recommendation links, profile/period identity, weekly metrics and category deltas.
- `digest_deliveries`: one idempotent Telegram outcome per persisted Digest; scheduling and retry leases are added by ART-018.
- `feedback`: action/reason/outcome with user, recommendation/delivery, timestamps.
- `processing_jobs`: durable work, lease, retries, scheduling, and failure history.

Use foreign keys, unique constraints, and migrations to enforce invariants. JSON is appropriate for raw payloads and versioned structured value collections, but identifiers, permissions, statuses, timestamps, versions, and query-critical dimensions remain typed columns.

## Reliability and security

- ART-022 security baseline is defined by ADR-0004 and `docs/security/THREAT_MODEL.md`.
- ART-023 logical backup/restore baseline is defined by ADR-0005 and `docs/runbooks/BACKUP_RESTORE.md`.
- ART-024 CI separates dependency-free quality checks from migration-backed integration tests as documented in `docs/runbooks/CI.md`.
- ART-025 private inference controls are defined by ADR-0006 and `docs/runbooks/OLLAMA_INTEGRATION.md`.
- separate least-privilege database role per environment and restricted runtime credentials;
- PostgreSQL and Ollama stay on localhost or a private restricted network;
- typed config fails fast for the selected process/provider and does not demand unrelated credentials;
- authentication and rate limiting precede any public API/admin endpoint;
- daily backup and verified restore are required by hardening, not just a backup file;
- health covers running processes and selected dependencies without exposing secrets/debug data;
- monitoring covers disk, GPU when present, queue depth/wait, source errors, AI failures, and delivery failures;
- logs redact bot tokens, passwords, authorization headers, full private PII, and private source credentials;
- `.env`, Telegram sessions, keys, local model artifacts, and runtime data remain outside Git.

The private API keeps `trustProxy` disabled and loopback binding mandatory. Source Registry routes use a distinct admin service token; user-scoped routes use a separate local-process token plus the trusted caller UUID assertion. Every route has a process-local IPv6-normalizing rate limit and request-body bound. This is not an end-user/public authentication scheme or a distributed DDoS boundary.

The default HTTP transport resolves each outbound target, blocks non-public/reserved addresses and revalidates manually followed redirects. Because the connection layer performs a later resolution, deployment egress policy and approved-source origin review remain required against DNS rebinding. Runtime PostgreSQL credentials receive table DML and schema usage only; migrations use a separate owner credential.

Backups stream PostgreSQL custom format through authenticated AES-256-GCM encryption into environment-separated storage. Restore never overwrites the operational database: it creates a new target, validates schema and core counts, and requires an operator-controlled connection switch. The encryption key is held separately from the artifact; daily schedule, off-host copy and weekly restore history remain deployment evidence for Gate G5.

CI runs deterministic fake-provider and fake-delivery paths only. Its automatic GitHub token is restricted to read-only repository contents and no application runtime credentials are configured; the integration job receives only an ephemeral loopback `radar_test` URL and starts PostgreSQL as a workflow service. Local tests use Testcontainers unless that narrowly validated CI override is present.

## Observability chain

Propagate a correlation ID through:

```text
source
  -> raw_item
  -> normalized_item
  -> signal
  -> analysis
  -> recommendation
  -> delivery
  -> feedback
```

Stable event names and structured context must answer: what failed, for which source/item/user, at which stage, after how many attempts, with which contract/rule/model versions, and whether the failure is retryable or terminal.
