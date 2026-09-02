# RoadMap: разработка до подключения компьютера Дениса

Дата старта: 2026-09-01. План управляется зависимостями и evidence, а не календарём. Дата сама по себе не закрывает задачу и не открывает quality gate.

## Цель этапа

До доступа к inference-компьютеру собрать работающий source-agnostic Radar с `FakeAIProvider`:

```text
permitted source
  -> raw item
  -> normalization
  -> deduplication
  -> deterministic classification and relevance
  -> signal
  -> versioned AI analysis
  -> explainable score for a company profile
  -> recommendation and digest
  -> Telegram delivery
  -> feedback
```

Подключение Денисова компьютера заменяет только AI-adapter:

```text
FakeAIProvider -> OllamaAIProvider
```

PostgreSQL остаётся source of truth. Telegram — интерфейс доставки; источник Telegram допустим только при документированном разрешении или партнёрстве.

## Статусы

- `DONE` — Definition of Done подтверждён артефактами или проверками.
- `IN_PROGRESS` — реализация начата, но Definition of Done ещё не подтверждён полностью.
- `NEXT` — следующая задача технического critical path.
- `PLANNED` — готова к работе после зависимостей.
- `EXTERNAL` — программный контракт можно подготовить, но полная проверка зависит от внешнего доступа.

В каждый момент Артём ведёт только одну задачу critical path. Денис параллельно готовит разрешённые источники, разметку и пользователей, не меняя production-сервисы без координации.

## M0 — зафиксировать foundation

| Порядок | Задача                             | Результат и проверяемый выход                                                                                                                                                                                                                                                                                      | Зависимости      | Статус        |
| ------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------- | ------------- |
| 1       | **ART-001 Pre-development audit**  | Зафиксированы стек, модульные границы, процессы, порты, env-контракт, тестовая стратегия, блокировки и планируемые команды. Архитектура и RoadMap согласованы. Production-кода нет.                                                                                                                                | Нет              | `DONE`        |
| 2       | **ART-002 Project scaffold**       | pnpm workspace на Node.js 24; Fastify health endpoint, типизированная конфигурация, structured logging, graceful shutdown, smoke test и пустой `.env.example`. Команды `dev`, `lint`, `typecheck`, `test`, `build` реально выполняются без PostgreSQL, Telegram и AI.                                              | ART-001          | `DONE`        |
| 3       | **ART-003 Domain model**           | Чистая модель `Source`, `RawItem`, `NormalizedItem`, `Signal`, `Analysis`, `RecommendedAction`, `Recommendation`, `User`, `UserProfile`, `Feedback`; version/provenance/time invariants и persistence mapping описаны после домена; unit tests покрывают ключевые инварианты.                                      | ART-002          | `DONE`        |
| 4       | **ART-004 PostgreSQL persistence** | Docker Compose, Prisma migrations, repositories, integration tests и development seed. Чистый seed и повторный container-run подтверждают 10 sources, 100 raw items, 0 signals без дублей.                                                                                                                       | ART-003          | `DONE` |
| 5       | **ART-005 Fixture source adapter** | `SourceAdapter` и `FixtureSourceAdapter`; версионированный корпус из 200 Construction/HoReCa/OTHER материалов с рекламой, exact- и near-дублями. Два PostgreSQL-прогона дают 200/0 новых raw items; 24 review-required материала не проходят AI permission boundary.                                                    | ART-003, ART-004 | `DONE` |

Milestone M0: одна команда загружает fixtures в PostgreSQL повторяемо и не создаёт дубли. Реальные источники и модель не нужны.

## M1 — офлайн-цепочка качества данных

Сначала закрывается офлайн-цепочка из семидневного спринта. `ART-006` сознательно выполняется после неё: адаптер можно реализовать без выбранного production-источника, но внешний HTTP не должен блокировать проверку ядра.

| Порядок | Задача                                              | Результат и проверяемый выход                                                                                                                                                                                                                                             | Зависимости          | Статус    |
| ------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- | --------- |
| 6       | **ART-007 Normalization pipeline**                  | `normalizer-v1` очищает HTML/пробелы/повторяющиеся строки, нормализует даты и язык, строит canonical URL и SHA-256; success/rejection сохраняются отдельно и идемпотентно, raw content остаётся неизменным.                                                                 | ART-003–005          | `DONE` |
| 7       | **ART-008 Exact and near deduplication**            | `deduplicator-v1` фиксирует exact evidence по source identity/canonical URL/hash и near evidence по 3-token overlap в пределах вертикали и 7 дней. Проверенный fixture-run: 200 assignments, 150 кластеров, 25 exact и 25 near; повторный запуск создаёт 0 записей.          | ART-007              | `DONE` |
| 8       | **ART-006 RSS/HTTP adapter**                        | `rss-http-v1` читает RSS 2.0/Atom через bounded HTTP transport: timeout, max 3 attempts, exponential backoff, retryable statuses, per-origin rate limit, identifying user-agent и 2 MiB response bound. Offline fixtures подтверждают provenance, idempotency, permission boundary, метрики и safe errors; live smoke не выполнялся без одобренного источника. | ART-005, ART-007–008 | `DONE` |
| 9       | **ART-009 Vertical classifier and relevance rules** | `classifier-v1` и `signal-taxonomy-v1` детерминированно классифицируют только dedup-кластеры с разрешённым evidence. Проверенный fixture-run: 150 решений, 110 AI-eligible signals, 28 irrelevant и 12 permission-denied; повторный запуск создаёт 0 signals, rule IDs и provenance сохраняются. | ART-007–008          | `DONE` |
| 10      | **ART-010 Opportunity scoring**                     | `opportunity-score-v1` считает фиксированную формулу пяти факторов, contributions и bands; profile-specific company fit объясняется пятью критериями, unknown остаётся нейтральным, ignored event/excluded term дают `EXCLUDED` без рекомендации. Confidence `0..1` преобразуется явно; 9 unit tests проверяют веса, границы, разные профили и mapping в Recommendation. | ART-003, ART-009     | `DONE` |

Milestone M1 достигнут: 200 fixtures проходят `raw -> normalized -> deduplicated -> classified`, статистика воспроизводима, raw сохраняется, AI не вызывается; Opportunity Score и Company Fit проверяются как чистые versioned policies до подключения AI provider.

## M2 — независимый от модели pipeline

| Порядок | Задача                              | Результат и проверяемый выход                                                                                                                                                                            | Зависимости      | Статус    |
| ------- | ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- | --------- |
| 11      | **ART-011 AI provider abstraction** | Provider-independent `AIProvider` предоставляет `analyzeSignal`, `healthCheck`, `modelInfo` и стабильную failure taxonomy. Application builder повторно проверяет статус Signal, полное evidence и актуальное разрешение источников; `FakeAIProvider` детерминированно возвращает domain-valid Analysis, typed failure/exception и bounded input без Ollama. 10 тестов покрывают boundary и режимы fake. | ART-003, ART-010 | `DONE` |
| 12      | **ART-012 Structured AI contract**  | Strict versioned Zod-схема `ai-analysis/v1` разделяет facts/inferences, проверяет source union, basis IDs, bounds, confidence и полный identity/version envelope. Mapper дополнительно сверяет request identity и permission-checked provenance; любой schema/identity/provenance/domain drift создаёт `FAILED / AI_INVALID_RESPONSE` без raw payload. 10 новых positive/negative tests закрывают контракт и FakeAIProvider validation path. | ART-003, ART-011 | `DONE` |
| 13      | **ART-013 Full offline pipeline**   | Синхронный application orchestrator и команда `process:fixtures` проводят материал через persistence, rules, validated fake analysis и deterministic scoring. Проверенный PostgreSQL run: 200 raw → 200 normalized → 150 clusters → 110 signals → 110 analyses → 110 recommendations; повтор с другим временем запуска создаёт 0 строк и делает 0 provider calls. | ART-004–012      | `DONE` |

Milestone M2 достигнут: воспроизводимый end-to-end run с `AI provider: fake` сохраняет versioned Analysis и profile-specific Recommendation, а повторный запуск использует persistence identity без повторного AI-вызова. Gate G2 ещё не считается пройденным без эксплуатационных метрик и restart evidence.

## M3 — API, Telegram и feedback loop

| Порядок | Задача                                 | Результат и проверяемый выход                                                                                                                                                                                 | Зависимости               | Статус    |
| ------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- | --------- |
| 14      | **ART-014 Application API**            | Private Fastify API v1 реализует health, sources, персональные signals, append-only user profile и идемпотентный feedback. Strict Zod validation, bounded cursor filters, Bearer/caller boundary, safe errors и PostgreSQL repositories покрыты 12 новыми contract/HTTP tests и сквозным integration-сценарием; Source Registry сохраняет permission invariants. | ART-004, ART-013          | `DONE` |
| 15      | **ART-015 Telegram UI**                | Меню возможностей, дайджеста, сохранённых, интересов и помощи; карточка показывает score, объяснение, действия и source link. Transport adapter тестируется без реального токена.                             | ART-014                   | `NEXT` |
| 16      | **ART-016 Feedback loop**              | Persisted actions `USEFUL`, `NOT_USEFUL`, `SAVED`, `ACTED`, `ALREADY_KNOWN` с user/recommendation/correlation context и защитой от повторной callback-доставки.                                               | ART-014–015               | `PLANNED` |
| 17      | **ART-017 Digest**                     | Daily top-5 и weekly summary строятся из compact recommendations, не raw news; порядок детерминирован, источники трассируются, повторная сборка не дублирует delivery.                                        | ART-010, ART-014–016      | `PLANNED` |
| 18      | **ART-018 Durable jobs and scheduler** | Jobs `fetchSources`, `normalize`, `deduplicate`, `classify`, `analyze`, `buildDigest`, `deliverDigest`; transactional claim, no overlap, retry budget, stale-lock recovery, terminal failure и restart tests. | ART-004, ART-013, ART-017 | `PLANNED` |

Milestone M3: пользовательский путь работает с fake Telegram transport; live Telegram smoke относится к внешней проверке credentials.

## M4 — evals, эксплуатация и контракт интеграции

| Порядок | Задача                                           | Результат и проверяемый выход                                                                                                                                                                                                     | Зависимости                   | Статус     |
| ------- | ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- | ---------- |
| 19      | **ART-019 Eval dataset**                         | 200 размеченных материалов, по 100 Construction и HoReCa, с relevance, category/event type, facts, expected action и importance. Fixtures и gold set разделены.                                                                   | ART-003, ART-005, ART-009–012 | `PLANNED`  |
| 20      | **ART-020 AI benchmark harness**                 | Команда `benchmark:ai` принимает provider/model/dataset и выдаёт JSON validity, classification metrics, factual errors, p50/p95 latency, tokens и failures. На fake provider работает сейчас; 8B/14B comparison — внешний прогон. | ART-011–012, ART-019          | `PLANNED`  |
| 21      | **ART-021 Observability**                        | Единые structured events, correlation IDs и счётчики ingestion/pipeline/AI/delivery. Задача агрегирует уже добавляемую по ходу наблюдаемость; Grafana не обязательна.                                                             | ART-002, ART-013, ART-018     | `PLANNED`  |
| 22      | **ART-022 Security hardening**                   | Повторный secret scan, least privilege, auth/rate limits, log redaction, dependency audit и documented threat baseline. Безопасные `.gitignore` и env-validation вводятся раньше, в ART-002.                                      | ART-014–015, ART-021          | `PLANNED`  |
| 23      | **ART-023 Backup and restore**                   | Команды PostgreSQL backup/restore, зашифрованное/ограниченное хранение по среде и фактически проверенный restore с runbook.                                                                                                       | ART-004, ART-018, ART-022     | `PLANNED`  |
| 24      | **ART-024 CI**                                   | GitHub Actions выполняет frozen install, lint, typecheck, unit/integration test и build. DeepSeek, Telegram и production credentials отсутствуют; PostgreSQL поднимается только как test service.                                 | ART-002–023                   | `PLANNED`  |
| 25      | **ART-025 Denis-PC/Ollama integration contract** | `OllamaAIProvider`, conditional env validation, timeouts/concurrency, healthcheck и network/security runbook готовы без обязательной доступности Ollama. Реальный smoke и benchmark отмечены отдельно.                            | ART-011–012, ART-020–022      | `EXTERNAL` |

Milestone M4: кодовая база готова к подключению inference-host. Gate G1 требует реальных одинаковых прогонов 8B и 14B; Gate G5 требует эксплуатационных данных, backup/restore и reboot evidence.

## Первые семь рабочих дней Артёма

1. ART-001: аудит и фиксация архитектуры.
2. ART-002: scaffold, config, logging, health и lifecycle.
3. ART-003: чистая domain model.
4. ART-004: PostgreSQL, migrations и repositories.
5. ART-005: fixture ingestion и 100–200 материалов.
6. ART-007: normalization без потери raw.
7. ART-008: exact/near dedup и тесты первой цепочки.

Итог недели: система читает fixtures, сохраняет raw, нормализует, устраняет дубли и показывает проверяемую статистику. `ART-006` следует сразу после этого milestone.

## Связь с quality gates

- **G1 AI ready:** ART-019, ART-020 и внешний 8B/14B benchmark на компьютере Дениса.
- **G2 pipeline ready:** ART-005–013, ART-018 и наблюдаемые restart/permission/dedup/JSON metrics.
- **G3 product ready:** ART-010, ART-012, ART-016–017 плюс review реальных карточек.
- **G4 commercial pilot ready:** live onboarding/delivery/feedback для 20–50 пользователей и baseline KPI report.
- **G5 scale ready:** ART-018, ART-021–025 плюс подтверждённые backup/restore, reboot и source-window metrics.

## Внешние параллельные результаты Дениса

- реестр разрешённых источников с owner/contact, rights status и `ai_processing_allowed`;
- 200-item gold set совместно с Артёмом;
- формулировки типичных профилей Construction и HoReCa;
- кандидаты закрытого MVP и интервью;
- физическая доступность inference-компьютера для внешней части ART-020/025.

Эти входы не блокируют разработку fake/fixture-контура, но блокируют утверждение соответствующих gates.

## Заблокировано до отдельного решения или evidence

- production-установка DeepSeek, выбор окончательного quant, CUDA tuning и перенос на компьютер Дениса;
- fine-tuning/LoRA, vector database, Kubernetes и разделение на микросервисы;
- отдельный frontend, mobile, billing и CRM/ERP;
- массовый сбор Telegram, обход ограничений платформы и подключение источников без прав;
- масштабирование к 100+ источникам до прохождения quality gates.

После каждой ART-задачи: перечислить изменённые файлы и решения, выполнить существующие проверки, показать `git diff --stat` и `git status`, зафиксировать ограничения и назвать следующую задачу. Commit, push, deploy и внешние контакты выполняются только по отдельному запросу пользователя.
