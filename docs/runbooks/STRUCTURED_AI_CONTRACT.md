# Structured AI contract v1

## Purpose

`ai-analysis/v1` is the only successful AI transport envelope accepted by the current pipeline. It keeps source-backed facts separate from derived inferences and prevents arbitrary provider output from becoming a successful domain `Analysis`.

This contract validates structure and provenance relationships. It does not establish that a model statement is factually true; factual quality is measured later against the gold set in `ART-019`–`ART-020` and reviewed in Gate G3.

## Ownership and flow

The Zod schema lives in `packages/contracts`. Provider adapters in `packages/adapters/ai` own the context-aware mapping:

```text
unknown provider output
  -> AIAnalysisResponseV1Schema
  -> request identity and permitted-source comparison
  -> core Analysis factories
  -> SUCCEEDED Analysis

any failed step
  -> FAILED / AI_INVALID_RESPONSE
```

The failure uses identity and version values from the trusted request/provider context. Raw model output and validation details are not copied into `failureReason`.

## Successful envelope

The top-level object is strict and contains:

- `status: SUCCEEDED` and `schemaVersion: ai-analysis/v1`;
- analysis, signal, and correlation IDs;
- provider, model, prompt, schema, and analysis versions;
- created time and optional deadline;
- headline, summary, why-important text, event type, entities, and risks;
- business impact, urgency, confidence, and actionability;
- two to five typed candidate actions;
- at least one fact, zero or more inferences, and the exact union of fact source IDs.

Unknown object fields are rejected at the envelope, fact, inference, and action levels. Strings, arrays, identifiers, scores, confidence, action priority, and timestamps have explicit bounds. Strings with surrounding whitespace are rejected instead of being silently repaired.

## Relational invariants

- fact and inference identifiers are unique;
- every fact has one or more unique source IDs;
- every inference has one or more unique `basisFactIds` that exist in the same response;
- inferences cannot carry `sourceIds`, and facts cannot carry `basisFactIds`;
- top-level `sourceIds` exactly equals the union of source IDs used by facts;
- entities and risks are unique without regard to case;
- adapter mapping rejects any source ID outside the permission-checked request evidence;
- response analysis/signal/correlation IDs, provider/model, timestamp, and all versions must exactly match trusted context.

Only after these checks does the mapper create branded identifiers and call the core domain factory. A domain invariant failure is handled as another invalid response.

## Unknown values

Use `null` for a deadline that is not known. For a categorical value that must be represented, use an explicit versioned taxonomy value such as `UNKNOWN` rather than inventing a fact. Facts remain mandatory because an analysis without attributable evidence cannot be successful.

## Verification

```powershell
pnpm exec vitest run packages/contracts/test/ai-analysis-v1.test.ts packages/adapters/ai/test/ai-analysis-response-v1.test.ts packages/adapters/ai/test/fake-ai-provider.test.ts
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

The tests include unknown fields, fact/inference responsibility mixing, missing inference bases, mismatched source unions, wrong schema version, invalid confidence, action-count bounds, duplicate semantic values, request identity drift, provenance escape, and safe failed-analysis mapping. No Ollama or network access is involved.
