# ADR-0004: Private runtime security baseline

- Status: accepted
- Date: 2026-09-03
- Owner: Артём

## Context

ART-014–ART-021 produced a working private API, Telegram adapter, live-source-capable HTTP transport, PostgreSQL runtime and structured telemetry. Before production-like operation, those boundaries need explicit authentication scopes, resource limits, outbound-network policy, credential handling and a database role that is not the schema owner.

The API is an internal process boundary for the modular monolith. `X-Radar-User-Id` is asserted by a trusted local adapter and is not an end-user authentication scheme. Making this interface public would therefore widen the trust model beyond the current product contract.

## Decision

- Keep the API loopback-bound in production and keep Fastify `trustProxy` disabled. A future public gateway requires a separate authentication decision.
- Use two distinct constant-time-compared service credentials: `API_ADMIN_AUTH_TOKEN` for Source Registry mutation/read and `API_AUTH_TOKEN` for user-scoped signal/profile/feedback operations.
- Apply a bounded in-memory IP rate limiter to every route, including health, and cap JSON request bodies. Use `@fastify/rate-limit` `11.2.0` or newer within the pinned major because earlier releases are affected by the 2026 IPv6 rotation bypass advisory.
- Suppress Fastify's raw URL access logs and emit route-template-only completion events. Redact named secret fields and sanitize credentials embedded in serialized error messages/stacks.
- Permit live HTTP collection only through the bounded transport. It resolves and rejects local/private/reserved targets, credentials, non-default ports and revalidates every manually followed redirect.
- Separate schema-owner/migration credentials from `radar_runtime`. Runtime receives schema usage and table/sequence DML, but no schema creation, superuser, role, database, replication or row-security bypass capability.
- Scan tracked content and all reachable Git blobs for high-confidence secret formats and tracked secret files. Run the production dependency audit from the pinned lockfile.

## Consequences

The private service can be exercised locally with deterministic limits and negative tests without adding a public identity provider, Redis or a network security service. Source administration cannot be performed with the user-process token, and an application credential compromise does not grant database DDL.

The limiter is process-local and resets at restart. The trusted user header still allows impersonation by a holder of the internal user-process token. DNS validation cannot by itself eliminate resolver-to-connect rebinding because the built-in fetch implementation performs its own connection resolution. Production operation must therefore remain loopback/private, restrict egress at the host/firewall, approve source origins and protect service credentials. Multi-instance rate limiting, end-user tokens and public proxy trust are deferred until a measured requirement and a new decision.

Backup/restore, CI enforcement and Ollama-host controls are completed by ART-023, ART-024 and ADR-0006/ART-025 respectively; target-host operational evidence remains external.
