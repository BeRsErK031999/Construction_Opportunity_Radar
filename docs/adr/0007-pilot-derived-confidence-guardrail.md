# ADR-0007: Pilot-derived classification and confidence guardrails

- Status: Accepted
- Date: 2026-09-03
- Decision owners: Артём (product and engineering)

## Context

The first manual user-path pilot used five current materials from permitted or explicitly blocked sources and replaced Ollama with a file-based Codex review. It exposed two unsafe product outcomes:

1. a Kirovstat construction summary containing forms such as `построены`, `введён` and `сданы` was rejected as an ambiguous vertical;
2. an unreviewed source with reliability `35/100` received `HIGH 72.95`, because analysis confidence contributed only 10% and did not limit the final priority band.

Changing rule dictionaries or scoring behavior in place would make persisted decisions non-reproducible, so `classifier-v1` and `opportunity-score-v1` remain immutable historical policies.

## Decision

Adopt `classifier-v2` as the active pre-AI policy. It retains v1 behavior and adds stable Construction rule IDs for completed-building verb forms. `signal-taxonomy-v1` remains unchanged because no category changed.

Adopt `opportunity-score-v2` as the active personalized policy. The five weights and the ordinary band thresholds remain unchanged. Before weighting, v2 computes:

```text
evidence reliability = minimum across facts(
  maximum reliability among sources supporting that fact
)

effective confidence = min(analysis confidence, evidence reliability)
```

The persisted confidence factor is effective confidence. A deterministic post-formula guardrail limits both the total score and its band:

| Effective confidence | Maximum score | Maximum band |
| ---: | ---: | --- |
| `< 40` | `54` | `LOW` |
| `40..<60` | `69` | `MEDIUM` |
| `60..<80` | `84` | `HIGH` |
| `80..100` | `100` | `CRITICAL` |

The explanation persists analysis confidence, evidence reliability, effective confidence, the raw weighted total, the cap and the final total. This prevents a model from bypassing the policy by assigning large impact or fit values.

API and bot current-opportunity reads explicitly select `classifier-v2` plus `opportunity-score-v2`. Historical v1 rows remain available for audit, saved-card history and feedback attribution, but are not mixed into current rankings.

## Consequences

- Russian retrospective construction summaries reach AI review instead of being discarded solely because of inflection.
- Weakly supported material may still be shown as a verification lead, but cannot receive a high-priority label.
- Existing v1 decisions are not rewritten. A v2 reprocessing run creates separately traceable signals and recommendations.
- A source reliability change that should affect existing evidence requires a new versioned classification/scoring run; immutable prior recommendations are not silently recalculated.
- The guardrail thresholds are a pilot baseline and must be evaluated against reviewed live cards before Gate G3.

## Evidence

The corrected manual pilot produced three AI-eligible Construction signals from five items while preserving one permission denial and one irrelevant HoReCa summary. The official Kaliningradstat item remained `HIGH 80.75`; the retrospective Kirovstat item became `LOW 54.75`; the unreviewed `35/100` source moved from `HIGH 72.95` to `LOW 54`. An unchanged repeat created no rows, made no provider calls and sent no duplicate messages.
