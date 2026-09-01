# ADR-0002: Modular monolith and provider-independent development

- Status: accepted
- Date: 2026-09-01
- Owners: Артём (technical), Денис (external inputs and hardware availability)

## Context

The MVP must be developed before the target inference computer, real model, production Telegram token, and final permitted source set are available. The planned repository has multiple runtime entry points, which could be misread as a decision to build networked microservices. The planning inputs also use both `event/recommendation` and `signal/analysis` terminology and place some company-specific score fields on a global signal.

A boundary is needed that lets the team build and test the full product now, replace external providers later, and preserve source provenance and personalized explainability.

## Decision

### Deployment and code shape

- Build one modular TypeScript monolith in a pnpm workspace.
- Use separate composition roots for `api`, `collector`, `worker`, and `bot`, plus a non-service `cli` entry point when offline commands are introduced.
- Share domain, application, persistence, adapter, and observability packages.
- Do not introduce private HTTP/RPC between these processes in the MVP. PostgreSQL holds durable shared state and jobs.
- Create packages and apps only with their first working vertical slice; do not scaffold empty services.

### Dependency direction

- Domain code is pure and does not depend on Fastify, Prisma, grammY, Ollama, environment variables, or concrete loggers.
- Application use cases depend on domain types and declare outbound ports.
- PostgreSQL, source adapters, AI providers, and delivery transports implement those ports.
- Runtime apps are composition roots and do not import from one another.

### Canonical data chain

```text
Source
  -> RawItem
  -> NormalizedItem
  -> Signal
  -> Analysis (zero or many versioned AI results)
  -> Recommendation (profile-specific score and actions)
  -> Delivery
  -> Feedback
```

- `Signal` is non-personalized and preserves links to all supporting source items.
- `Analysis` records model, prompt, schema, analysis version, facts, inferences, confidence, and source IDs.
- `Recommendation` owns `companyFit`, the five-factor score breakdown, total score, band, explanation, and recommended actions for one profile.
- Raw source evidence is immutable. Normalization and analysis are repeatable/versioned derivatives.

### Replaceable providers

- Business logic depends on `AIProvider`, not Ollama or a model name.
- `FakeAIProvider` is the default development and CI implementation.
- `OllamaAIProvider` is introduced behind the same port and selected through typed configuration.
- Ollama may run on the application host or Denis's restricted private host; it is never exposed on the public Internet.
- AI output is accepted only after versioned runtime validation; provider failure never becomes a successful analysis.
- Telegram delivery follows the same pattern: a fake transport supports tests, and grammY is the default live adapter.
- Telegram source ingestion, if ever approved, is a source adapter and is not part of the bot/delivery component.

## Consequences

Benefits:

- the complete product flow can be developed without Denis's computer or live credentials;
- offline tests are deterministic and do not invoke external networks or models;
- replacing fake AI with Ollama changes composition/configuration rather than domain logic;
- multiple entry points can be operated independently without the complexity of microservices;
- personalized scoring remains explainable and cannot contaminate global source facts;
- model/prompt comparisons retain historical analyses instead of overwriting them.

Costs and risks:

- package dependency rules must be enforced in reviews and, later, lint/build checks;
- multiple processes sharing PostgreSQL require careful transaction, locking, and migration discipline;
- fake providers prove orchestration and contracts but do not prove real-model quality or performance;
- a single repository and schema require coordinated deployments while the team remains small.

## Rejected alternatives

- **Wait for the inference computer:** delays all non-model product learning without reducing integration risk.
- **Call Ollama directly from domain/application logic:** couples use cases and tests to one provider and target host.
- **Networked microservices per pipeline stage:** adds deployment, discovery, failure, and observability overhead before scale evidence.
- **Store company fit and opportunity score on Signal:** produces contradictory global values for different companies.
- **Use Telegram as the central source architecture:** conflicts with the source-agnostic product and permission boundary.

## Revisit when

- measured queue/database contention violates Gate G5;
- one process needs independent scaling or isolation that cannot be achieved with the current deployment;
- a provider requires a materially different domain contract rather than an adapter mapping;
- multi-host operation requires a network boundary with explicit reliability and security semantics.
