# Product brief

## Problem

Companies face many fragmented signals: new projects, tenders, supplier changes, regulations, openings, leases, equipment purchases, incidents, prices, and market movements. Monitoring consumes time, while raw news feeds create noise and rarely explain what action a specific company should take.

## Product promise

Deliver a small number of evidence-backed, personalized opportunity or risk cards. Each card contains:

- a concise title and two-to-four-line summary;
- why the event matters to the user's company profile;
- an explainable opportunity score and confidence;
- two to five practical next actions;
- links to the original sources;
- feedback controls: useful, not useful, save, done.

## Initial users

Recruit people who must monitor a market and make decisions: owners, sales leaders, buyers, project/construction company managers, restaurateurs, and HoReCa marketing managers. The closed MVP target is 20-50 active users in two cohorts.

## Scope of MVP

### In scope

- official websites, RSS, public APIs, open datasets, partner feeds, and owned or explicitly permitted Telegram sources;
- Source Registry with rights and AI-processing status;
- scheduled collection into PostgreSQL with source metadata;
- normalization, language/date cleanup, exact and bounded fuzzy deduplication;
- cheap vertical/region/keyword rules before LLM processing;
- versioned structured analysis through an `AIProvider`, using local Ollama for the target deployment;
- company profile, explainable opportunity scoring, digest generation;
- Telegram onboarding, profile, frequency, digest, sources, help, and feedback;
- eval dataset, quality metrics, logs, backups, health checks, and recovery runbook.

### Out of scope until evidence justifies it

- broad multi-vertical expansion;
- full CRM/ERP, billing, mobile app, vector database, or customer web portal;
- mass unauthorized scraping or bypassing platform restrictions;
- fully autonomous high-impact decisions;
- fine-tuning before prompt/rule/eval improvements reach a stable plateau.

## Source policy

Every source record must include at least:

- `name`, `url`, `type`, `vertical`, `country`, `region`;
- owner or contact when applicable;
- `rights_status`: `OPEN_DATA`, `PUBLIC_API`, `PARTNER`, `CONSENT`, `REVIEW_REQUIRED`, or `BLOCKED`;
- `ai_processing_allowed` as an explicit boolean;
- parser type, polling interval, reliability, signal-quality notes, last success and last error.

A collector may preserve metadata for a source under review, but content must not enter the AI pipeline until processing is allowed.

## Personalization and scoring

Company Profile v1 captures company type, verticals, regions, services/products, target clients, project-size range, interested event types, and ignored event types.

Initial score:

```text
Opportunity Score =
  0.35 * Business Impact +
  0.25 * Company Fit +
  0.20 * Urgency +
  0.10 * Confidence +
  0.10 * Actionability
```

Business Impact may use event type, scale, value, reach, and deal/risk likelihood. Company Fit should be deterministic where possible. Urgency uses deadlines, tender windows, effective dates, and age. Confidence combines source reliability, corroborating facts, and extraction confidence. Actionability requires a clear actor, event, timing, and at least one concrete action.

Score thresholds are calibrated on the pilot. Weight changes require evidence and a versioned decision; the LLM cannot change them autonomously.

## Success by the end of week 8

- collector uptime above 95%;
- structured JSON success above 98%;
- obvious duplicates below 5% of delivered cards;
- high-score precision above 70% on reviewed items;
- more than 60% of reviewed cards receive positive feedback;
- 100% of cards link to a source;
- unsupported factual claims trend toward zero;
- feedback coverage above 20%;
- users complete onboarding, receive a digest, open a source, and submit feedback without developer assistance.

## Commercial learning

Before the first external pilot, capture interviews, objections, willingness to pay for a concrete outcome, and at least three-to-five outcome stories. Audience size alone is not product success; the strongest evidence is a useful signal followed by a real user action.
