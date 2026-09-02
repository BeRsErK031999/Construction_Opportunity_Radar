# Construction Opportunity Radar

Персональный радар бизнес-возможностей для компаний. Сервис собирает разрешённые отраслевые сигналы, удаляет шум и дубли, структурирует факты локальной LLM, оценивает важность для профиля компании и доставляет короткий digest с конкретными действиями.

## Статус

`ART-004`–`ART-014` реализуют полный независимый от реальной модели контур: PostgreSQL persistence, идемпотентные fixtures, versioned normalization, exact/near deduplication, классификацию без AI, строгий `ai-analysis/v1`, validated `FakeAIProvider`, profile-specific Opportunity Score, сохранённые Recommendation и private Fastify API v1. API предоставляет permission-safe Source Registry, персональные SignalOpportunity, append-only профиль и идемпотентный feedback. Следующий critical-path пункт — `ART-015 Telegram UI`.

Первый продуктовый контур:

- вертикали: строительство и HoReCa;
- интерфейс: Telegram-бот;
- основной источник истины: PostgreSQL;
- AI: `FakeAIProvider` для разработки и CI; затем `OllamaAIProvider` с DeepSeek-R1 8B и обязательным benchmark против 14B;
- владелец продукта и разработки: Артём;
- источники, рынок и пилот: Денис.

## Быстрый вход в проект

1. [AGENTS.md](AGENTS.md) — постоянные правила работы Codex и команды.
2. [docs/PROJECT_CONTEXT.md](docs/PROJECT_CONTEXT.md) — краткая память проекта и текущие решения.
3. [docs/product/PRODUCT_BRIEF.md](docs/product/PRODUCT_BRIEF.md) — продуктовый контракт и границы MVP.
4. [docs/architecture/MVP_ARCHITECTURE.md](docs/architecture/MVP_ARCHITECTURE.md) — целевой pipeline, модули и данные.
5. [docs/architecture/PRE_DEVELOPMENT_AUDIT.md](docs/architecture/PRE_DEVELOPMENT_AUDIT.md) — результат ART-001, planned tree, зависимости, порты, env и тестовая стратегия.
6. [docs/architecture/DOMAIN_MODEL.md](docs/architecture/DOMAIN_MODEL.md) — словарь ART-003, инварианты и mapping к PostgreSQL.
7. [docs/runbooks/LOCAL_POSTGRESQL.md](docs/runbooks/LOCAL_POSTGRESQL.md) — запуск PostgreSQL, migrations, seed и integration tests.
8. [docs/runbooks/RSS_HTTP_ADAPTER.md](docs/runbooks/RSS_HTTP_ADAPTER.md) — безопасный контракт RSS/HTTP collector и условия live smoke.
9. [docs/runbooks/FIXTURE_CLASSIFICATION.md](docs/runbooks/FIXTURE_CLASSIFICATION.md) — правила classifier-v1, fixture-метрики и повторный запуск.
10. [docs/runbooks/OPPORTUNITY_SCORING.md](docs/runbooks/OPPORTUNITY_SCORING.md) — формула, company-fit rules, bands и guardrails scoring-v1.
11. [docs/runbooks/FAKE_AI_PROVIDER.md](docs/runbooks/FAKE_AI_PROVIDER.md) — provider-neutral AI contract, permission boundary, fake-режимы и failure taxonomy.
12. [docs/runbooks/STRUCTURED_AI_CONTRACT.md](docs/runbooks/STRUCTURED_AI_CONTRACT.md) — `ai-analysis/v1`, relational validation, identity/provenance checks и invalid-response outcome.
13. [docs/presentation/http/README.md](docs/presentation/http/README.md) — private HTTP API v1, endpoints, поля, auth, ошибки и pagination.
14. [ROADMAP.md](ROADMAP.md) — последовательность ART-задач до подключения inference-компьютера.
15. [docs/quality/QUALITY_GATES.md](docs/quality/QUALITY_GATES.md) — gates, KPI и Definition of Done.

Repo-scoped skills:

- `$construction-radar-product` — scope, приоритеты, роли, KPI и пилот;
- `$construction-radar-engineering` — реализация и ревью TypeScript/PostgreSQL/Ollama/Telegram-контура.

## Локальный запуск

Требования: Node.js `24.19.x` и pnpm `11.19.0`.

```powershell
pnpm install --frozen-lockfile
pnpm dev
```

По умолчанию API слушает только `127.0.0.1:3000`. Проверка:

```powershell
Invoke-RestMethod http://127.0.0.1:3000/health
```

Локальный `.env` необязателен для `/health`. Business endpoints требуют запущенную мигрированную PostgreSQL и `API_AUTH_TOKEN` длиной не менее 32 символов; доступные ключи перечислены без значений в `.env.example`. Telegram и Ollama для текущего API не нужны. Production-конфигурация дополнительно требует явный `DATABASE_URL` и разрешает только loopback bind до ART-022.

Production-like запуск собранного JavaScript:

```powershell
pnpm build
pnpm start
```

## Локальная база данных

PostgreSQL публикуется только на `127.0.0.1:54329`. Первый запуск persistence-контура:

```powershell
pnpm db:up
pnpm db:migrate:deploy
pnpm db:seed
pnpm test:integration
```

`db:seed` повторяем: на чистой базе создаёт 10 sources, 100 raw items и 0 signals, повторный запуск не добавляет дубли. Подробности и clean-reset — в [локальном runbook](docs/runbooks/LOCAL_POSTGRESQL.md).

Версионированный корпус `fixture-ingestion/v1` содержит 200 материалов для Construction, HoReCa и негативного класса OTHER, включая рекламу, exact- и near-дубли. После migrations загрузка выполняется одной повторяемой командой:

```powershell
pnpm fixtures:ingest
pnpm fixtures:normalize
pnpm fixtures:deduplicate
pnpm fixtures:classify
pnpm process:fixtures
```

Первые четыре команды позволяют запускать стадии отдельно. `process:fixtures` выполняет весь контур одной командой. На проверенном корпусе результат стабилен: 200 raw, 200 normalized, 150 кластеров, 110 разрешённых signals, 110 успешных fake analyses и 110 рекомендаций для двух fixture-профилей. Повторный полный запуск создаёт 0 строк и делает 0 provider calls. Подробности — в [runbook полного офлайн-конвейера](docs/runbooks/FULL_OFFLINE_PIPELINE.md).

## Проверки

```powershell
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm build
pnpm db:validate
```

## Ближайший технический результат

Реализовать `ART-015`: Telegram transport/UI с меню возможностей, дайджеста, сохранённых, интересов и помощи; карточка должна показывать score, объяснение, конкретные действия и source link, а adapter — тестироваться без реального bot token.

## Источники планирования

Контекст сформирован 1 сентября 2026 года из общего плана проекта, персонального плана Артёма и персонального плана Дениса. Исходные DOCX использованы как входные материалы; актуальные решения проекта должны фиксироваться в Markdown и ADR этого репозитория.
