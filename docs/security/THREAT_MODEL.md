# Threat baseline

## Scope and assets

This baseline covers the closed-MVP modular monolith: private Fastify API, Telegram bot, worker/jobs, PostgreSQL, permitted-source HTTP collection, logs and local configuration. Ollama host integration is not present yet and is covered by ART-025.

Protected assets are source permissions and raw evidence, user/profile/feedback data, recommendations, service and Telegram credentials, database migration/runtime credentials, integrity of versioned analysis/scoring, and service availability.

## Trust boundaries

```text
trusted local adapter
  -> loopback API (user/admin service token + request limits)
  -> application ports
  -> PostgreSQL (runtime DML role; separate owner/migrator)

approved public source
  -> outbound HTTP network policy
  -> immutable raw evidence

Telegram Bot API
  <-> private-chat, pre-registered-user bot adapter
```

The API trusts `X-Radar-User-Id` only after the user-process Bearer token succeeds. It is a service-to-service caller assertion, not proof of an end user's identity. PostgreSQL and future Ollama endpoints are never public.

## Threats, controls and residual risk

| Threat | Current control | Residual risk / required operation |
| --- | --- | --- |
| Stolen or guessed API credential | 32–512 character tokens, strict Bearer syntax, constant-time digest comparison, distinct admin/user scopes, per-IP limiter | Internal user-token holder can assert any user UUID; keep API loopback-only and rotate on suspected exposure |
| IDOR/cross-user read or write | Caller UUID checked in application queries; Recommendation/profile ownership verified | Depends on trusted local adapter assertion; public end-user auth is not implemented |
| Request flooding or oversized body | `@fastify/rate-limit` 11.2.0 with IPv6 `/64` normalization, 60 requests/minute default, 64 KiB body default, bounded schemas | In-memory buckets reset on restart and are per-process; public/multi-instance deployment needs a shared edge limiter |
| Secret or PII disclosure in Git/logs | `.gitignore`, value-free `.env.example`, tracked/history scan, field redaction, serialized-error sanitization, route-template-only access events | Control access and retention for log files; high-confidence scanner is not a provider-side revocation service |
| SSRF through a registered source or redirect | Admin-scoped Source Registry, rights boundary, HTTP(S) only, no URL credentials, default ports only, DNS/IP private/reserved block, manual redirect revalidation | DNS rebind remains possible between validation and connect; production host must enforce egress allow rules and source-origin review |
| Database takeover from runtime compromise | Loopback port, separate `radar_runtime`, no DDL/superuser/create-role/create-db/replication/bypass-RLS, statement/lock/idle transaction timeouts | Runtime role has CRUD across application tables; schema owner credential must be unavailable to services |
| Unauthorized Telegram interaction | Bot token format validation, private-chat boundary, pre-registered user lookup, compact callback IDs, ownership checks | Live Telegram smoke and token rotation evidence require real credentials; no token belongs in command history |
| Supply-chain compromise | Exact dependency versions, frozen lockfile, production dependency audit | ART-024 must enforce checks in CI; dependency audit cannot detect every malicious package |
| State loss or destructive operator action | PostgreSQL source of truth, restrictive deletes/FKs, documented non-destructive stop | Verified backup/restore and retention are ART-023; this risk remains open |
| AI prompt/data exfiltration | Permission recheck before provider call, sanitized provider request, fake provider by default | Real Ollama network and model controls remain ART-025 |

## Security invariants

- Source text enters AI only when current `ai_processing_allowed` is true.
- Service processes use `DATABASE_URL` for the runtime role; migrations use `MIGRATION_DATABASE_URL` or the local owner default.
- `API_AUTH_TOKEN` and `API_ADMIN_AUTH_TOKEN` must differ and are required in production.
- The private API remains loopback-bound; forwarded client-IP headers are not trusted.
- No token, password, private key, authorization/cookie header, raw payload or full private PII is an intended log field.
- A live source must pass rights review and outbound network policy; a successful DNS lookup is not permission evidence.

## Review triggers

Review this model before public API exposure, a reverse proxy with `trustProxy`, multi-host/multi-instance deployment, credential-bearing sources, Ollama network access, new verticals, or a new store for rate-limit/log/backup data. Review immediately after a leaked credential, unexpected outbound connection, authorization failure pattern, dependency advisory or restore failure.
