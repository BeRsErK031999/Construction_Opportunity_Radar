# Construction Opportunity Radar

Персональный радар бизнес-возможностей для компаний. Сервис собирает разрешённые отраслевые сигналы, удаляет шум и дубли, структурирует факты локальной LLM, оценивает важность для профиля компании и доставляет короткий digest с конкретными действиями.

## Статус

`ART-004`–`ART-008` закрывают первую офлайн-цепочку данных: PostgreSQL persistence, идемпотентный импорт 200 fixtures, versioned normalization без изменения raw evidence и exact/near deduplication. `ART-006` добавляет offline-tested RSS 2.0/Atom collector с bounded HTTP, retry/rate-limit, provenance и permission boundary. Следующий critical-path пункт — `ART-009 Vertical classifier and relevance rules`.

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
9. [ROADMAP.md](ROADMAP.md) — последовательность ART-задач до подключения inference-компьютера.
10. [docs/quality/QUALITY_GATES.md](docs/quality/QUALITY_GATES.md) — gates, KPI и Definition of Done.

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

Локальный `.env` необязателен. Доступные ключи перечислены без значений в `.env.example`; пустые значения используют безопасные defaults. PostgreSQL, Telegram и Ollama для текущих API/core-проверок не нужны.

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
```

На проверенном корпусе итог дедупликации стабилен: 200 assignments, 150 кластеров, 25 exact- и 25 near-дублей. Evidence каждого решения хранится отдельно с версией `deduplicator-v1`; AI при этом не вызывается.

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

Реализовать `ART-009`: детерминированный versioned classifier/relevance baseline для `CONSTRUCTION`, `HORECA`, `OTHER`, который работает только с уникальными permitted-кандидатами и не вызывает AI.

## Источники планирования

Контекст сформирован 1 сентября 2026 года из общего плана проекта, персонального плана Артёма и персонального плана Дениса. Исходные DOCX использованы как входные материалы; актуальные решения проекта должны фиксироваться в Markdown и ADR этого репозитория.
