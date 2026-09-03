# Статус RoadMap: что готово и что осталось

Дата среза: 2026-09-02. Основание: [RoadMap](../../ROADMAP.md), [контекст проекта](../PROJECT_CONTEXT.md), [product brief](PRODUCT_BRIEF.md), [quality gates](../quality/QUALITY_GATES.md), состояние `main` на коммите `464aa94` и текущая локальная рабочая копия.

## Краткий итог

Технический фундамент и офлайн-цепочка до детерминированной классификации готовы. Репозиторий принимает разрешённые fixture-материалы, сохраняет неизменяемый raw-контент в PostgreSQL, нормализует его, объединяет exact/near-дубли, классифицирует кластеры до обращения к AI и умеет безопасно разбирать RSS 2.0/Atom без обращения к неодобренным live-источникам.

Следующая точка critical path — `ART-010 Opportunity scoring`. `ART-009 Vertical classifier and relevance rules` уже закрыта полным PostgreSQL fixture-прогоном, но её изменения пока находятся только в локальной рабочей копии и не отправлены в `origin/main`.

| Состояние | Количество | Доля RoadMap | Что это означает |
| --- | ---: | ---: | --- |
| `DONE` | 9 из 25 | 36% | Закрыты ART-001–009; ART-009 пока не закоммичена |
| `NEXT` | 1 из 25 | 4% | ART-010 Opportunity scoring |
| `PLANNED` / `EXTERNAL` | 15 из 25 | 60% | ART-011–024 и внешняя ART-025 |

Всего до выполнения RoadMap остаётся закрыть 16 задач: одну следующую, 14 плановых и одну внешне зависимую.

## Что уже готово

### M0 — foundation завершён полностью: 5 из 5 задач

| Задача | Готовый результат | Подтверждение в репозитории |
| --- | --- | --- |
| **ART-001 Pre-development audit** | Зафиксированы стек, границы модульного монолита, canonical pipeline, порты, зависимости, риски и внешние блокировки. | [Pre-development audit](../architecture/PRE_DEVELOPMENT_AUDIT.md), [MVP architecture](../architecture/MVP_ARCHITECTURE.md), [ADR](../adr/) |
| **ART-002 Project scaffold** | Работают Node.js 24/pnpm workspace, Fastify health API, typed config, redacted structured logging, graceful shutdown и базовые проверки. | [package.json](../../package.json), [API app](../../apps/api/), [config](../../packages/config/), [observability](../../packages/observability/) |
| **ART-003 Domain model** | Реализованы основные доменные модели от `Source` до `Feedback`, идентификаторы, provenance, permission и version/time invariants. | [Domain model](../architecture/DOMAIN_MODEL.md), [core package](../../packages/core/) |
| **ART-004 PostgreSQL persistence** | Есть Prisma schema и migrations, repositories, localhost-only Docker Compose, детерминированный seed и Testcontainers integration suite. | [schema.prisma](../../packages/db/prisma/schema.prisma), [migrations](../../packages/db/prisma/migrations/), [docker-compose.yml](../../infra/docker/docker-compose.yml), [PostgreSQL runbook](../runbooks/LOCAL_POSTGRESQL.md) |
| **ART-005 Fixture source adapter** | Есть независимый от провайдера `SourceAdapter`, fixture adapter, ingestion use case, CLI-команда и версионированный корпус из 200 материалов. Повторная загрузка не создаёт raw-дубли, permission boundary сохраняется. | [source port](../../packages/application/src/ports/source-adapter.ts), [fixture adapter](../../packages/adapters/sources/src/fixture-source-adapter.ts), [ingestion CLI](../../apps/cli/src/ingest-fixtures.ts), [dataset v1](../../fixtures/ingestion/v1/dataset.json) |

Результат M0 достигнут: fixtures загружаются в PostgreSQL повторяемо, реальные источники и AI для этого не нужны.

### M1 — готово 4 из 5 задач

| Задача | Готовый результат | Подтверждение в репозитории |
| --- | --- | --- |
| **ART-007 Normalization pipeline** | `normalizer-v1` очищает и канонизирует материал, сохраняет versioned success/rejection отдельно и не изменяет raw evidence. | [normalizer-v1](../../packages/core/src/normalization/normalizer-v1.ts), [application use case](../../packages/application/src/normalization/normalize-raw-item.ts), [normalization CLI](../../apps/cli/src/normalize-fixtures.ts) |
| **ART-008 Exact and near deduplication** | `deduplicator-v1` фиксирует exact/near evidence и идемпотентные assignments. Контрольный корпус даёт 200 assignments, 150 кластеров, 25 exact- и 25 near-дублей. | [deduplicator-v1](../../packages/core/src/deduplication/deduplicator-v1.ts), [application use case](../../packages/application/src/deduplication/deduplicate-normalized-items.ts), [deduplication CLI](../../apps/cli/src/deduplicate-fixtures.ts) |
| **ART-006 RSS/HTTP adapter** | `rss-http-v1` поддерживает RSS 2.0 и Atom, timeout, bounded retry, rate limit, identifying user-agent, ограничение ответа 2 MiB, provenance, permission boundary, метрики и safe errors. Все проверки адаптера выполняются на offline fixtures. | [RSS adapter](../../packages/adapters/sources/src/rss-http-source-adapter.ts), [HTTP transport](../../packages/adapters/sources/src/http-transport.ts), [adapter tests](../../packages/adapters/sources/test/rss-http-source-adapter.test.ts), [runbook](../runbooks/RSS_HTTP_ADAPTER.md) |
| **ART-009 Vertical classifier and relevance rules** | `classifier-v1` и `signal-taxonomy-v1` детерминированно фильтруют permission, рекламу, нерелевантные и неоднозначные кластеры. Из 150 кластеров получаются 110 AI-eligible signals, 28 irrelevant и 12 permission-denied; повтор создаёт 0 signals. | [classifier-v1](../../packages/core/src/classification/classifier-v1.ts), [classification use case](../../packages/application/src/classification/classify-deduplicated-clusters.ts), [classification CLI](../../apps/cli/src/classify-fixtures.ts), [classification repository](../../packages/db/src/repositories/classification-repository.ts), [runbook](../runbooks/FIXTURE_CLASSIFICATION.md) |

Результат M1 на текущий момент: полный fixture-корпус воспроизводимо проходит `raw -> normalized -> deduplicated -> classified`, raw и provenance сохраняются, запрещённые материалы не попадают в будущий AI-вход. Для завершения milestone остаётся ART-010.

## Что осталось по RoadMap

### Завершить M1

| Задача | Что должно появиться | Зачем это нужно |
| --- | --- | --- |
| **ART-010 Opportunity scoring** | Чистая versioned функция пяти факторов 0–100, breakdown, thresholds и unit tests. `companyFit` рассчитывается для профиля пользователя. | Делает приоритет рекомендации объяснимым и персональным. |

### M2 — независимый от модели pipeline: 0 из 3 задач

| Задача | Ожидаемый результат |
| --- | --- |
| **ART-011 AI provider abstraction** | Порт `AIProvider` и детерминированный `FakeAIProvider` с управляемыми ошибками. |
| **ART-012 Structured AI contract** | Versioned Zod schema, разделение facts/inferences, source IDs, confidence и негативные contract tests. |
| **ART-013 Full offline pipeline** | Одна идемпотентная команда `process:fixtures` проводит данные через rules, fake analysis и scoring и печатает счётчики стадий. |

Выход M2: воспроизводимый end-to-end pipeline с fake AI. Это необходимая, но ещё недостаточная часть Gate G2.

### M3 — API, Telegram и feedback loop: 0 из 5 задач

| Задача | Ожидаемый результат |
| --- | --- |
| **ART-014 Application API** | Sources, signals, user profile и feedback endpoints с validation, authorization boundary и safe errors. |
| **ART-015 Telegram UI** | Onboarding, профиль, интересы, digest, сохранённые и help; карточка со score, объяснением, действиями и source link. |
| **ART-016 Feedback loop** | Persisted `USEFUL`, `NOT_USEFUL`, `SAVED`, `ACTED`, `ALREADY_KNOWN` и защита от повторных callbacks. |
| **ART-017 Digest** | Детерминированные daily top-5 и weekly summary без дублирования delivery. |
| **ART-018 Durable jobs and scheduler** | PostgreSQL-backed jobs, transactional claim, no-overlap, bounded retries, stale-lock recovery, terminal failure и restart tests. |

Выход M3: полный пользовательский путь работает через fake Telegram transport. Live Telegram smoke остаётся отдельной внешней проверкой.

### M4 — evals, эксплуатация и интеграция: 0 из 7 задач

| Задача | Ожидаемый результат |
| --- | --- |
| **ART-019 Eval dataset** | Отдельный gold set из 200 размеченных материалов: 100 Construction и 100 HoReCa. |
| **ART-020 AI benchmark harness** | `benchmark:ai` с JSON validity, classification/factuality metrics, p50/p95 latency, tokens и failures. |
| **ART-021 Observability** | Сквозные structured events, correlation IDs и pipeline/AI/delivery metrics. |
| **ART-022 Security hardening** | Secret scan, least privilege, auth/rate limits, log redaction, dependency audit и threat baseline. |
| **ART-023 Backup and restore** | Рабочие backup/restore-команды, ограниченное хранение и проверенный restore runbook. |
| **ART-024 CI** | GitHub Actions: frozen install, lint, typecheck, unit/integration tests и build без production credentials. |
| **ART-025 Denis-PC/Ollama integration contract** | `OllamaAIProvider`, conditional config, timeouts/concurrency, healthcheck и network/security runbook; реальный smoke зависит от доступа к компьютеру Дениса. |

## Статус quality gates

Ни один gate пока не пройден полностью. Наличие отдельных артефактов не заменяет требуемые метрики и эксплуатационное evidence.

| Gate | Статус | Что уже есть | Чего не хватает для прохождения |
| --- | --- | --- | --- |
| **G1 AI ready** | Не пройден | Fixture-корпус и будущая provider boundary предусмотрены архитектурой. | Отдельный размеченный gold set, benchmark harness и одинаковые реальные прогоны 8B/14B. |
| **G2 Pipeline ready** | Не пройден, foundation частично готов | Raw provenance, permission enforcement, normalization, deduplication и deterministic classification подтверждены offline и в PostgreSQL. | ART-010–013 и ART-018, uptime, JSON success, restart/recovery и полные pipeline metrics. |
| **G3 Product ready** | Не пройден | Product contract, domain entities и формула scoring зафиксированы. | Scoring, structured AI output, карточки, digest, feedback и review реальных рекомендаций по KPI. |
| **G4 Commercial pilot ready** | Не пройден | Целевые вертикали, роли и сценарий пилота определены. | Самостоятельный Telegram-путь, 20–50 пользователей в двух когортах, baseline KPI report и weekly feedback review. |
| **G5 Scale ready** | Не пройден | Базовые health/logging и PostgreSQL foundation существуют. | Очередь на 100+ источников, полная наблюдаемость, backup/restore, recovery runbooks и reboot evidence. |

## Внешние результаты, которые ещё нужно подтвердить

Эти результаты принадлежат параллельному треку Дениса. В репозитории пока нет evidence, достаточного для закрытия связанных gates:

- реестр 20–40 стабильных разрешённых источников с owner/contact, `rights_status` и `ai_processing_allowed`;
- отдельный 200-item gold set, размеченный совместно с Артёмом;
- проверенные формулировки типичных профилей Construction и HoReCa;
- кандидаты закрытого MVP, интервью, objections и willingness-to-pay evidence;
- физическая доступность inference-компьютера для 8B/14B benchmark и Ollama smoke.

Эти входы не блокируют fixture/FakeAI-разработку, но блокируют G1, G3, G4 и внешнюю часть G5.

## Рекомендуемый ближайший порядок

1. Реализовать ART-010, чтобы завершить детерминированную часть M1.
2. Выполнить ART-011 и ART-012, затем собрать ART-013 как первую полную offline vertical slice.
3. Перейти к пользовательскому контуру ART-014–018.
4. Параллельно готовить gold set, разрешённые источники, профили и участников пилота, не расширяя MVP за Construction и HoReCa.
5. После полного offline/user flow закрывать ART-019–025 и подтверждать gates измерениями.

## Проверки на дату среза

На текущей рабочей копии успешно выполнены:

- `pnpm format:check`;
- `pnpm lint`;
- `pnpm typecheck`;
- `pnpm test` — 19 файлов, 86 тестов;
- `pnpm build`;
- `pnpm db:validate`;
- `pnpm test:integration` — 1 файл, 9 PostgreSQL integration tests.

Live-вызовы одобренных источников, Telegram и Ollama не выполнялись. Это соответствует текущему этапу и не должно интерпретироваться как evidence их работоспособности.

## Правило обновления документа

Обновлять этот срез после закрытия каждой ART-задачи или при изменении scope, dependencies либо gate evidence. Статус `DONE` ставить только после выполнения Definition of Done, прохождения применимых проверок и фиксации наблюдаемого результата. Сам RoadMap остаётся источником утверждённой последовательности, а этот документ — понятным отчётом о фактическом прогрессе.
