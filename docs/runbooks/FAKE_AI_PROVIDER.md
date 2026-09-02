# Fake AI provider

## Purpose

`ART-011` establishes the AI boundary without depending on Ollama, a model, credentials, or a network. Application code depends on the `AIProvider` port; `FakeAIProvider` is a deterministic adapter for local development, CI, and the future offline orchestrator.

The fake proves composition and failure handling. It does not prove model quality, prompt quality, JSON parsing, latency, or inference-host availability.

## Application boundary

Build provider input with `createAIAnalysisRequest`. The builder rejects the request before AI when:

- Signal status is neither `CANDIDATE` nor `ACTIVE`;
- evidence is empty or contains duplicate normalized-item/source pairs;
- an item or source is outside the Signal provenance;
- evidence does not cover every normalized item and source retained by the Signal;
- a source is disabled, lacks `aiProcessingAllowed`, or no longer has an eligible rights status.

This repeats the permission decision at AI enqueue time, so a permission revoked after classification cannot silently reach a provider. The frozen output contains only the Signal dimensions and source-backed normalized content required for analysis. Source owner/contact and rights-basis metadata are not sent through the port.

## Port contract

`AIProvider` is owned by `packages/application` and has no Ollama-specific settings:

```text
analyzeSignal(request) -> Analysis or typed provider exception
healthCheck() -> HEALTHY | UNHEALTHY with safe failure metadata
modelInfo() -> provider/model, capabilities, maxInputCharacters
```

The port returns domain `Analysis`. Since `ART-012`, `FakeAIProvider` first generates an `ai-analysis/v1` response and passes it through the shared schema, request-identity, provenance, and domain mapper. The fake therefore exercises the same validation boundary intended for the later Ollama adapter.

## Deterministic fake modes

- Default `SUCCESS`: the same request returns the same fact/inference IDs and Analysis payload. Each fact is an excerpt of supplied evidence and retains its source ID.
- `FAILED_ANALYSIS`: returns a valid `Analysis` with status `FAILED`, configured stable code, and retryability.
- `INVALID_RESPONSE`: generates a response that violates `ai-analysis/v1`; the mapper returns `FAILED / AI_INVALID_RESPONSE`.
- `THROW`: rejects with a safe `AIProviderError` for transport/runtime failure tests.
- `healthStatus: UNHEALTHY`: reports `AI_UNAVAILABLE` without contacting anything.
- `maxInputCharacters`: advertises and enforces a deterministic combined title/text bound.

The fake error message is selected from a fixed map and never includes evidence text, URLs, credentials, or a raw upstream response.

## Failure taxonomy

| Code | Typical meaning | Default retry guidance |
| --- | --- | --- |
| `AI_INPUT_TOO_LARGE` | Request exceeds provider input limit | no |
| `AI_INVALID_REQUEST` | Internal provider request invariant failed | no |
| `AI_INVALID_RESPONSE` | Provider output cannot become a valid contract | no, unless policy says otherwise |
| `AI_RATE_LIMITED` | Provider rejected current rate | yes |
| `AI_TIMEOUT` | Bounded provider request expired | yes |
| `AI_UNAVAILABLE` | Selected provider/model is unavailable | yes |
| `AI_INTERNAL_ERROR` | Safe wrapper for an unexpected adapter failure | explicit per failure |

The adapter carries `retryable`; workers must use that field with a bounded retry budget rather than infer policy from text.

## Verification

```powershell
pnpm exec vitest run packages/application/test/create-ai-analysis-request.test.ts packages/adapters/ai/test/fake-ai-provider.test.ts
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

These checks require neither PostgreSQL nor Ollama. PostgreSQL integration tests remain part of the repository-wide quality check because the end-to-end pipeline uses PostgreSQL as the source of truth.
