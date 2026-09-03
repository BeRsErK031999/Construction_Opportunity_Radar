# Quality gates

Progress is controlled by evidence. A calendar date alone does not open the next stage.

## G1 — AI ready

Entry evidence:

- gold set contains 200 labeled materials: 100 Construction and 100 HoReCa;
- each item includes relevance, event type, one-to-three facts, short summary, and expected action;
- 8B and 14B run with the same prompt, schema, and test set;
- report includes JSON validity, event-type accuracy, relevance precision/recall, factuality, p50/p95 latency, tokens/sec, VRAM, and hallucination count;
- model selection is based on quality plus speed/capacity, not model name.

## G2 — pipeline ready

- collector uptime above 95%;
- obvious duplicates below 5% of output;
- AI JSON parse success above 98%;
- source URL, timestamp, and raw content are preserved;
- permissions are enforced before AI enqueue;
- collector and job processing survive restart without duplicate corruption.

## G3 — product ready

- high-score precision above 70% on reviewed cards;
- more than 60% of evaluated cards receive positive feedback;
- every card contains a source link;
- unsupported factual claims trend toward zero;
- at least 20% feedback coverage;
- facts and inferences are visibly distinguishable in stored data and explanations.

## G4 — commercial pilot ready

A new user can, without developer assistance:

1. start the bot;
2. choose verticals and regions;
3. create a simple company profile;
4. choose digest frequency;
5. receive and understand a digest;
6. open source provenance;
7. submit useful/not-useful feedback.

Operationally, the closed MVP has 20-50 target users, two cohorts, a baseline KPI report, weekly feedback review, and an explicit list of fixes versus backlog.

## G5 — scale ready

- queue processes 100+ sources within an agreed service window;
- daily backups exist and a weekly restore test succeeds;
- health checks and structured logs cover all runtime components;
- runbooks cover common recovery scenarios;
- disk, GPU, queue, source error, and delivery health are observable;
- a reboot restores services automatically or through one documented procedure.

## Definition of Done by change type

### Collector

- fixture-based parsing test;
- idempotency and duplicate test;
- timeout/error behavior and metrics;
- permission state documented and enforced;
- sample result traceable to its source.

### AI/prompt/schema

- prompt and schema versioned;
- structured validation test;
- relevant gold-set evaluation rerun;
- regression compared with previous version;
- failures and JSON repair rate measured.

### Scoring

- deterministic factors tested;
- score breakdown persisted and explainable;
- effective confidence reconciles model confidence with fact-source reliability;
- threshold or weight change supported by pilot/eval evidence;
- previous version remains identifiable.

### Bot/API

- happy path plus authorization/validation failures tested;
- secrets absent from source and logs;
- user-visible error is actionable;
- feedback/delivery state persists correctly.

### Operations

- health signal and structured logging added;
- startup, shutdown, retry, and recovery behavior verified;
- runbook updated for a new failure mode;
- restore or rollback path exists for stateful changes.

## Weekly review packet

Friday review should contain a working demo, metric deltas, top errors, source quality, queue/GPU observations, user feedback, outcome stories, blockers, and explicit decisions for the next week.
