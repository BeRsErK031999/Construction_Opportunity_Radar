# ADR-0001: MVP stack and deployment shape

- Status: accepted
- Date: 2026-09-01
- Amended: 2026-09-01 by ADR-0002 (provider boundary and private inference host)
- Owners: Артём (technical), Денис (hardware availability)

## Context

Two people must ship a closed MVP in eight weeks and a commercial pilot in twelve. Inference should run locally on one available computer, operating cost should stay low, and the system must survive restarts without manual database repair. Adding separate infrastructure services too early would increase operational burden.

## Decision

- Use a Node.js monorepo with strict TypeScript.
- Use Fastify for HTTP APIs and Zod for shared runtime contracts.
- Use PostgreSQL as the system of record and Prisma for schema/migrations and typed access.
- Use a PostgreSQL-backed durable job table instead of Redis for MVP.
- Use Ollama on localhost when co-located, or on Denis's restricted private host; never expose it publicly. DeepSeek-R1 8B remains the baseline model, and 14B must be benchmarked on the same 200-item gold set before changing.
- Use grammY behind a delivery adapter with Telegram long polling for the closed MVP.
- Target Ubuntu with Docker Engine and/or systemd on the dedicated computer.
- Defer React + Vite admin until the closed MVP unless operations are unsafe without it.

## Consequences

Benefits:

- one application language across services and bot;
- fewer infrastructure dependencies;
- durable state and retries in PostgreSQL;
- local inference without per-token API charges;
- simple closed-MVP networking with no public webhook requirement.

Costs and risks:

- queue throughput is limited by PostgreSQL and the local GPU;
- Prisma does not replace careful transaction and locking design;
- local inference still consumes electricity, GPU time, and operational attention;
- grammY remains an adapter detail; revisit only if a measured delivery requirement cannot be met without changing the application port.

## Revisit when

- queue wait or database contention violates Gate G5;
- API inference becomes cheaper or more reliable for the measured workload;
- public delivery requires webhooks or multi-host deployment;
- the admin workload cannot be operated safely without a UI.
