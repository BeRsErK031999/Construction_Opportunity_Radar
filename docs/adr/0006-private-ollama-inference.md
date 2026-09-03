# ADR-0006: Private Ollama inference boundary

- Status: accepted
- Date: 2026-09-03
- Owners: Артём (software and model decision), Денис (physical host availability)

## Context

The provider-independent pipeline, strict `ai-analysis/v1` response, 200-item eval set and benchmark harness already work with `FakeAIProvider`. ART-025 must make the same boundary usable with Ollama without making CI, local development or unrelated processes depend on a running model. Ollama's native local API is not an end-user authentication boundary, so transport placement is part of the security decision.

## Decision

- Keep `AI_PROVIDER=fake` as the default. Validate Ollama settings only when `AI_PROVIDER=ollama` is explicitly selected.
- Use a credential-free loopback origin (`http://127.0.0.1:11434`) by default. Prefer co-location or a loopback SSH tunnel. A direct remote origin requires an explicit opt-in, a syntactically private host, and HTTPS; host firewall/egress policy remains authoritative.
- Do not auto-pull or auto-upgrade models. `healthCheck()` calls `GET /api/tags` and is healthy only when the exact configured model is present.
- Send `POST /api/chat` with `stream=false`, `think=false`, the exported JSON Schema, deterministic temperature/seed/context settings and an explicit keep-alive. Evidence is marked as untrusted data in the system instruction.
- Reuse `analysisFromAIResponseV1` for schema, identity, provenance and domain validation. Invalid model output becomes `FAILED / AI_INVALID_RESPONSE`; it is never repaired silently or persisted as success.
- Bound input characters, response bytes, request and health timeouts, and in-process concurrency. Reject redirects so a configured private origin cannot forward evidence elsewhere. The adapter performs no retry; the durable job runtime owns bounded retry and terminal failure.
- Expose Ollama token counts and generation duration to the existing benchmark executor. VRAM remains externally measured because the API response does not establish host-wide peak GPU memory.
- Provide `pnpm ai:health` and enable `pnpm benchmark:ai --provider ollama --model <tag>` without changing the fake default or CI.

## Consequences

The repository can verify configuration, request shape, structured validation, failure mapping, health and concurrency without Ollama or network access. A target-host operator can then run the same versioned benchmark against 8B and 14B. Missing host access, model files or GPU telemetry no longer block local implementation, but they still block Gate G1 evidence.

The syntactic private-host check cannot prove DNS resolution or network isolation. Direct remote HTTPS therefore also requires a host firewall allowlist, certificate verification and restricted egress. Ollama must never be bound to a public interface without an authenticated private gateway; the preferred remote pattern is a loopback tunnel.

## Revisit when

- measured concurrency or queue wait violates the agreed processing window;
- a model needs different generation settings or a new structured contract;
- a public or multi-tenant inference service is proposed;
- production evidence favors a different provider after the same eval and security requirements are applied.
