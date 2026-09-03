# Manual Codex pilot — 2026-09-03

## Purpose

Exercise the current user path without Ollama: collect current materials, preserve provenance and rights, export only permitted AI candidates, return manual Codex output through `ai-analysis/v1`, score it for one Construction profile, render Telegram cards through fake delivery, and repeat the run unchanged.

This is engineering/product evidence for rule correction. It is not live Telegram, representative precision, or Gate G3 approval.

## Input

- 5 materials from 4 sources;
- 4 materials permitted for this internal AI review;
- 1 Moscow construction item with `REVIEW_REQUIRED / ai_processing_allowed=false`;
- one small Construction supplier/contractor profile covering Kirov, Kaliningrad and Kazakhstan.

## Finding and correction

| Case | Before | Active v2 result |
| --- | --- | --- |
| Kirovstat completed buildings (`построены`, `введён`) | `IRRELEVANT / UNSUPPORTED_OR_AMBIGUOUS_VERTICAL` | `AI_ELIGIBLE`; manual review produced `LOW 54.75` because the material is retrospective and has no procurement window |
| Unreviewed source, reliability `35/100`, AI confidence `46/100` | `HIGH 72.95` | effective confidence `35`; raw weighted score `71.85`; confidence guardrail produced `LOW 54` |
| Kaliningradstat, reliability `95/100`, AI confidence `91/100` | `HIGH 80.75` | unchanged `HIGH 80.75`; no guardrail cap |

The source-rights boundary remained unchanged: the review-required Moscow item produced `PERMISSION_DENIED` and never entered the AI request.

## Corrected run

```json
{
  "rawItems": 5,
  "normalizedItems": 5,
  "deduplicationClusters": 5,
  "aiEligible": 3,
  "irrelevant": 1,
  "permissionDenied": 1,
  "successfulAnalyses": 3,
  "recommendations": 3,
  "deliveries": 3
}
```

An unchanged repeat reused all five ingestion/normalization/deduplication records, all three signals/analyses/recommendations and all three deliveries. It made `0` provider calls and `0` fake transport sends.

## Full-fixture regression

On a clean isolated PostgreSQL database, the active policies retained the established 200-item baseline:

- 200 raw and normalized items;
- 150 deduplication clusters;
- 110 `classifier-v2` AI-eligible signals;
- 28 irrelevant and 12 permission-denied decisions;
- 110 successful analyses and `opportunity-score-v2` recommendations.

The second run created no rows and made no provider calls.

## Remaining limitations

- Source reliability values still require owner review and calibration; a one-off internal reuse basis is not production source approval.
- The pilot used manual Codex output and fake Telegram transport, not Ollama or the live Telegram API.
- Guardrail thresholds are a conservative baseline and require comparison against reviewed live cards before Gate G3.
