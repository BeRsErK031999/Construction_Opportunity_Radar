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

The MVP uses a `processing_jobs` table with job type, entity/idempotency key, status, attempts, `scheduled_at`, `locked_at`, lease owner, and last error. Workers use transactional claiming, bounded exponential backoff, stale-lock recovery, and terminal `FAILED` status. Redis is unnecessary until PostgreSQL is proven insufficient.

`ART-013` first proves the same application use cases through a synchronous offline orchestrator. `ART-018` adds durable triggering and scheduling without duplicating domain logic.

### AI provider and structured analysis

Application logic depends on:

```text
AIProvider
  analyzeSignal(request) -> validated SignalAnalysis or typed failure
  healthCheck() -> provider health
  modelInfo() -> provider/model capabilities and identity
```

`FakeAIProvider` is deterministic and is used in local development and CI. `OllamaAIProvider` is a later adapter. Ollama may run on the same host or a restricted private host; it is never publicly exposed.

The `ART-011` application boundary builds provider input only through `createAIAnalysisRequest`. It accepts domain Signal/NormalizedItem/Source values, requires a candidate or active Signal, exact evidence coverage, unique Signal-backed item/source pairs, and rechecks the source's current `ai_processing_allowed` policy before every provider call. The resulting immutable request exposes text, canonical URL, publication time, normalized/source IDs, and classification dimensions; rights basis, owner contact, and provider-specific settings do not cross the port.

Provider failures use stable codes for invalid/oversized input, timeout, unavailability, rate limiting, invalid response, and internal failure, with an explicit retryability flag and safe messages. The fake adapter supports deterministic success, domain-valid failed Analysis, typed thrown failure, healthy/unhealthy state, and an advertised input-character bound. It performs no network call.

`ART-012` implements the transport boundary as strict `ai-analysis/v1`. `AIAnalysisResponseV1Schema` rejects unknown fields, surrounding-whitespace repair, invalid score/confidence ranges, oversized collections/text, fewer than two or more than five actions, duplicate identifiers, inference bases outside the response, and a declared source set that differs from fact provenance. `analysisFromAIResponseV1` then compares analysis/signal/correlation identity, provider/model and all versions/timestamps to the request, and rejects source IDs outside its permission-checked evidence. Only after both layers pass are string IDs converted to branded domain IDs. Any schema, identity, provenance, or final domain failure becomes a safe non-retryable failed Analysis with `AI_INVALID_RESPONSE`; untrusted output is never copied into the failure reason.

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

Use grammY and long polling for the closed MVP behind `DeliveryPort`. ART-015 implements private-chat access for pre-registered users, the exact five-item menu, current and saved opportunity cards, profile inspection, help, and card feedback. Interactive onboarding/profile editing, frequency, and scheduled digest remain separate product steps.

Cards show score, why it matters, the first two-to-three prioritized practical actions, and the permitted source link. A `Delivery` is persisted as `PENDING` before transport and then as immutable `SENT` or `FAILED`; `(channel, interaction + recommendation)` makes replay idempotent. Callback payloads carry only a compact action and delivery UUID, then persist feedback with the user/recommendation/delivery/correlation chain. A fake delivery adapter supports local/CI tests without a token.

The bot is a delivery interface, not a reader for arbitrary third-party channels. Tokens remain only in secrets/env and never in Git or logs; no live Bot API call is part of the offline verification path.

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
- `deliveries`: digest/recommendation transport attempt, idempotency/provider reference, status/error.
- `feedback`: action/reason/outcome with user, recommendation/delivery, timestamps.
- `processing_jobs`: durable work, lease, retries, scheduling, and failure history.

Use foreign keys, unique constraints, and migrations to enforce invariants. JSON is appropriate for raw payloads and versioned structured value collections, but identifiers, permissions, statuses, timestamps, versions, and query-critical dimensions remain typed columns.

## Reliability and security

- separate least-privilege database role per environment and restricted runtime credentials;
- PostgreSQL and Ollama stay on localhost or a private restricted network;
- typed config fails fast for the selected process/provider and does not demand unrelated credentials;
- authentication and rate limiting precede any public API/admin endpoint;
- daily backup and verified restore are required by hardening, not just a backup file;
- health covers running processes and selected dependencies without exposing secrets/debug data;
- monitoring covers disk, GPU when present, queue depth/wait, source errors, AI failures, and delivery failures;
- logs redact bot tokens, passwords, authorization headers, full private PII, and private source credentials;
- `.env`, Telegram sessions, keys, local model artifacts, and runtime data remain outside Git.

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
