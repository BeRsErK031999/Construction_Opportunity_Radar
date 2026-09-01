# AGENTS.md

## Mission

Build Construction Opportunity Radar: a trustworthy, explainable service that turns permitted external business signals into a short, personalized list of opportunities, risks, and concrete actions. Optimize for useful decisions, not volume of collected content or novelty of AI.

## Read before changing the project

1. Read `docs/PROJECT_CONTEXT.md`.
2. Read `docs/product/PRODUCT_BRIEF.md` for scope or UX work.
3. Read `docs/architecture/MVP_ARCHITECTURE.md` and the relevant ADR for technical work.
4. Read `ROADMAP.md` and `docs/quality/QUALITY_GATES.md` before choosing or closing a milestone.
5. Use `$construction-radar-product` for scope, prioritization, pilot, roles, or KPI work.
6. Use `$construction-radar-engineering` for implementation, architecture, data, AI pipeline, Telegram, deployment, testing, or code review.

## Team and ownership

- Артём is the product and engineering lead. He owns requirements, architecture, code, database, collectors, local LLM integration, Telegram bot, deployment, security, and technical quality.
- Денис owns source discovery and permissions, market feedback, audience, content, pilot recruitment, and physical availability of the inference computer. He does not change production services without coordination with Артём.
- Product promises must match working behavior and measured evidence.

## Product invariants

- MVP supports only Construction and HoReCa until Gate G4 is passed.
- PostgreSQL is the source of truth. TXT/JSON are exports or versioned eval fixtures, not operational storage.
- Every source has an explicit rights status. Content may enter AI processing only when `ai_processing_allowed` is true.
- Do not build mass unauthorized scraping of third-party Telegram channels. Telegram is primarily the delivery interface; Telegram sources require a documented permission or partnership basis.
- Preserve source URL, publication time, and raw text before AI processing.
- Apply normalization, deduplication, and cheap rules before invoking the LLM.
- AI output must satisfy a versioned `Analysis` contract. Keep facts separate from inference and attach source IDs and confidence.
- Scoring remains explainable and mostly deterministic. The model must not silently change factor weights.
- Do not fine-tune before prompt, rules, structured output, and evals show a stable measurable gap.
- Never expose Ollama, PostgreSQL, debug endpoints, tokens, passwords, or user PII publicly.

## Engineering direction

- Planned stack: Node.js 24 + strict TypeScript in a pnpm modular monolith, Fastify, PostgreSQL, Prisma, a PostgreSQL-backed job queue, grammY, replaceable `AIProvider` implementations, and later React + Vite for admin.
- Planned layout: `apps/{api,bot,collector,worker,cli}`, shared `packages/{config,core,contracts,application,db,adapters,jobs,observability,prompts,evals}`, `fixtures/`, `infra/{docker,systemd,backup}`, and `docs/{adr,architecture,runbooks}`. Create a folder only with its first working slice.
- Use deterministic `FakeAIProvider` and fake delivery in development/CI; Ollama and Telegram are adapters, not domain dependencies.
- Version prompts, taxonomy, JSON contracts, scoring rules, and database migrations like code.
- Prefer a small end-to-end vertical slice over isolated infrastructure or speculative abstractions.
- Keep collectors idempotent. One `external_id` or normalized `content_hash` must not create duplicate raw items.
- Bound retries, record terminal failure, and prevent concurrent fetches of the same source.
- Add correlation IDs across `source -> raw_item -> normalized_item -> signal -> analysis -> recommendation -> delivery -> feedback`.

## Change discipline

- Inspect existing files and `git status` before editing. Preserve user changes.
- Never commit secrets or full private user data. Keep `.env.example` value-free.
- Add or update tests for changed behavior: contract validation, collector fixtures, idempotency, deduplication, scoring, retries, and permission enforcement.
- Run the repository's actual lint, typecheck, test, and migration checks once their scripts exist; do not invent command names when the scaffold is absent.
- Update `ROADMAP.md`, `docs/PROJECT_CONTEXT.md`, or an ADR when scope, architecture, gates, or an irreversible decision changes.
- Do not commit, push, deploy, contact source owners, publish content, or change live services unless the user explicitly requests that external action.

## Definition of done

A task is done only when its observable behavior works, relevant tests pass, logs and failure paths are adequate, documentation reflects the change, no secrets are exposed, and the applicable quality gate has evidence rather than an assertion.
