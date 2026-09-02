# Domain model

Статус: базовая модель реализована в `ART-003`; operational outcomes нормализации, дедупликации и Telegram-доставки уточнены в `ART-007`–`ART-015`, 2026-09-02.

## Назначение и граница

`packages/core` содержит чистую предметную модель Radar. Она не читает environment, не пишет в PostgreSQL, не вызывает сеть, LLM или Telegram и не зависит от Fastify, Prisma, Zod и логирования. Модели создаются через фабрики, которые нормализуют простые значения, проверяют локальные инварианты и возвращают immutable-объекты.

Каноническая цепочка происхождения:

```text
Source
  -> RawItem
  -> NormalizedItem
  -> Signal
  -> Analysis
  -> Recommendation <- UserProfile <- User
  -> Delivery
  -> Feedback
```

`Signal` описывает общий неперсонализированный рыночный смысл. `Analysis` — одну воспроизводимую версию интерпретации сигнала. `Recommendation` — результат для конкретной ревизии профиля; только она владеет `companyFit`, итоговым score, band, объяснением и выбранными действиями.

## Общие правила

- Domain IDs — разные branded-типы: случайно передать `SourceId` вместо `SignalId` нельзя при компиляции.
- Все даты принимаются как строки, проверяются и канонизируются в UTC ISO 8601. Для изменяемых агрегатов `updatedAt >= createdAt`.
- Score лежит в диапазоне `0..100`; probability — `0..1`; версии непустые и ограничены по длине.
- Коллекции, payload и созданные модели заморожены. `RawItem.rawText` сохраняется дословно, включая внешние пробелы.
- Фабрики проверяют инварианты одного объекта. Ссылочную целостность между объектами обеспечивают application-операции и PostgreSQL foreign keys.
- Ошибка инварианта имеет стабильный `DomainInvariantError.code`; текст ошибки не является API-контрактом.
- Factory types — внутренний доверенный контракт. Внешние HTTP/provider payload сначала должны пройти versioned transport validation в `packages/contracts`.

## Модели и инварианты

| Модель              | Ответственность                                                | Ключевые инварианты                                                                                                                                                                                                                                                                                                                               |
| ------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Source`            | Политика разрешённого источника, сбор и routing                | Disabled/`BLOCKED` источник не собирается; `REVIEW_REQUIRED` допускается только в контролируемом fixture/manual flow и не проходит AI boundary; AI разрешён только для `OPEN_DATA`, `PUBLIC_API`, `PARTNER`, `CONSENT` с документированным basis; Telegram-источник требует `PARTNER`/`CONSENT`; live-источник имеет положительный poll interval. |
| `RawItem`           | Неизменённое доказательство, полученное от источника           | Raw text/payload не нормализуются; URL, время и SHA-256 валидны; две identity-опоры: `(sourceId, externalId)` при наличии и всегда `(sourceId, contentHash)`.                                                                                                                                                                                     |
| `NormalizedItem`    | Версионированная производная raw-материала                     | Уникальность `(rawItemId, normalizerVersion)`; canonical URL, BCP 47 language и normalized hash валидны; дубли entities запрещены без учёта регистра.                                                                                                                                                                                             |
| `Signal`            | Неперсонализированный классифицированный сигнал или кластер    | Есть хотя бы один разрешённый normalized item и source; dedup representative/version, category, taxonomy/classifier version и matched rule IDs явны; только `SUPERSEDED` ссылается на другой signal; company fit отсутствует.                                                                                                                     |
| `Analysis`          | Успешная или неуспешная версия AI-интерпретации                | Identity включает signal/provider/model/prompt/schema/analysis versions; успешный результат содержит хотя бы один source-backed fact; inference ссылается только на facts этого analysis; source IDs выводятся из facts; failure не содержит успешный payload.                                                                                    |
| `RecommendedAction` | Типизированное практическое действие                           | Kind явный, priority `1..5`, title и rationale непустые. В analysis это candidate action, в recommendation — выбранное действие для профиля.                                                                                                                                                                                                      |
| `User`              | Минимальная Telegram identity и lifecycle                      | Нет имени, телефона и другой необязательной PII; revision положительна; timestamps упорядочены.                                                                                                                                                                                                                                                   |
| `UserProfile`       | Данные компании и интересы для deterministic fit               | До G4 только Construction/HoReCa; regions и services/products непустые; positive/negative keywords и event types не пересекаются; monetary range неотрицательный и упорядоченный.                                                                                                                                                                 |
| `Recommendation`    | Персональная оценка одного signal/analysis для ревизии profile | Все пять факторов и total в `0..100`; scoring version явна; от двух до пяти уникальных действий; provenance не пуст; identity включает profile revision.                                                                                                                                                                                          |
| `Delivery`          | Попытка доставить Recommendation пользователю                  | Канал, вид, user/recommendation/correlation и idempotency key обязательны; `PENDING` не имеет outcome, `SENT` хранит provider message ID, `FAILED` — только безопасные code/reason; terminal outcome неизменяем.                                                                                                                                  |
| `Feedback`          | Одно attributable действие пользователя                        | Только `USEFUL`, `NOT_USEFUL`, `SAVED`, `ACTED`, `ALREADY_KNOWN`; всегда есть user/recommendation/correlation, delivery опциональна; повторы определяются по user/recommendation/action.                                                                                                                                                          |

`Analysis.confidence` — вероятность `0..1` из structured AI contract. `opportunity-score-v1` явно преобразует её в `Recommendation.scoreBreakdown.confidence` диапазона `0..100`; модель не управляет весами, thresholds или арифметикой.

## Persistence mapping для ART-004

Domain остаётся независимым от способа хранения. В PostgreSQL имена становятся `snake_case`; opaque domain IDs планируется хранить как UUID, external/provider IDs — как text, timestamps — как `timestamptz`, JSON-коллекции — как `jsonb`. Prisma mapping не должен менять публичные domain-типы.

| Domain                    | PostgreSQL representation                                                                                                                                                 | Обязательные ограничения и индексы                                                                                                                                                                                                                                       |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `Source`                  | `sources`; policy раскладывается в `parser_kind`, `poll_interval_minutes`                                                                                                 | PK `id`; enum/check для type/rights/parser; check score и poll interval; check AI permission/basis; index `(enabled, rights_status, ai_processing_allowed)`.                                                                                                             |
| `RawItem`                 | `raw_items`; `raw_payload jsonb`, `raw_text text`                                                                                                                         | PK `id`; FK source; unique `(source_id, external_id)` для non-null; unique `(source_id, content_hash)`; index publication/receipt time; raw-поля не обновлять repository-методом.                                                                                        |
| `NormalizedItem`          | `normalized_items`; entities `jsonb`                                                                                                                                      | PK `id`; FK raw item; unique `(raw_item_id, normalizer_version)`; index normalized hash, canonical URL и publication time.                                                                                                                                               |
| `NormalizationAttempt`    | `normalization_attempts`; status и success/rejection payload хранятся взаимоисключающе                                                                                    | Unique `(raw_item_id, normalizer_version)`; success ссылается на normalized item той же raw/version identity; rejection содержит явные code/detail и не создаёт частично валидный `NormalizedItem`.                                                                      |
| `DeduplicationAssignment` | `deduplication_assignments`; один versioned assignment на normalized item, representative и direct match evidence                                                         | PK `(normalized_item_id, deduplicator_version)`; FK member/representative/matched item; similarity `0..1`, неотрицательное time distance; representative обязан ссылаться сам на себя.                                                                                   |
| `Signal`                  | `signals` плюс `signal_evidence(signal_id, normalized_item_id, source_id)`                                                                                                | PK signal; unique classification identity по dedup representative/version и classifier/taxonomy versions; matched rule IDs непусты; evidence links уникальны и ссылаются только на permitted normalized/source; checks scores/status и superseded relation.              |
| `Analysis`                | `analyses`; facts/inferences/entities/risks/actions как versioned `jsonb`, scalar versions/status/error отдельными колонками; `analysis_sources` для queryable provenance | PK `id`; FK signal; unique `(signal_id, provider, model, prompt_version, schema_version, analysis_version)`; check success/failure payload exclusivity; unique provenance links.                                                                                         |
| `User`                    | `users`                                                                                                                                                                   | PK `id`; unique Telegram user ID; enum status; check revision; не добавлять необязательную PII.                                                                                                                                                                          |
| `UserProfile`             | append-only `company_profile_revisions` с composite key `(id, revision)`                                                                                                  | FK user; positive revision; одна current revision определяется максимальной revision либо отдельным pointer; JSON/array для малых interest-наборов, GIN только после измерения запросов.                                                                                 |
| `Recommendation`          | `recommendations`; breakdown — отдельные numeric columns, actions `jsonb`; `recommendation_sources` для provenance                                                        | PK `id`; FK signal, analysis и composite FK profile/revision; unique identity tuple с `scoring_version`; checks `0..100`; unique source links.                                                                                                                           |
| `Delivery`                | `deliveries`; transport identity и outcome хранятся отдельно от Recommendation                                                                                            | PK `id`; FK user/recommendation; unique `(channel, idempotency_key)` и `(channel, user_id, provider_message_id)`, потому что Telegram message ID локален для чата; check взаимоисключающих `PENDING`/`SENT`/`FAILED` outcome; индексы user/status/time и recommendation. |
| `Feedback`                | `feedback` как append-only actions                                                                                                                                        | PK `id`; FK user/recommendation/delivery; unique `(user_id, recommendation_id, action)`; partial unique sentiment key не допускает одновременно `USEFUL` и `NOT_USEFUL`; index created time.                                                                             |

### Транзакционные границы

- Ingestion атомарно проверяет обе identity-опоры RawItem. Конфликт возвращает уже существующий item и не перезаписывает raw evidence.
- Normalization атомарно сохраняет успешный `NormalizedItem` вместе с attempt; повтор той же raw/version identity возвращает существующий совместимый outcome, а несовместимый требует новой версии.
- Deduplication сохраняет полный набор assignments с versioned evidence; повтор совместимого результата идемпотентен, а изменение evidence под той же версией считается identity conflict.
- Classification проверяет permission ещё раз на application-boundary; только `AI_ELIGIBLE` signal и его permitted provenance links создаются в одной транзакции. Совместимый повтор возвращает существующий signal, несовместимое содержимое под тем же deterministic ID считается identity conflict.
- Analysis и его queryable source links сохраняются вместе; невалидный provider output создаёт только typed failure.
- Recommendation фиксирует конкретную profile revision и scoring version, поэтому последующее изменение профиля не меняет историческое объяснение.
- Delivery создаётся в `PENDING` до transport-вызова и атомарно переходит только в один terminal outcome. Повтор interaction/recommendation identity возвращает существующую запись и не отправляет карточку повторно.
- Feedback insert идемпотентен по identity key; конфликт sentiment обрабатывается явной application-командой, а не тихим overwrite.

## Отложено намеренно

- Application repository ports принадлежат use cases; Prisma repositories реализуют их в `packages/db`, не раскрывая generated-типы наружу.
- Полноценная оркестрация стадий и durable job для classification остаются в `ART-013`/`ART-018`; текущая CLI-команда проверяет те же application/domain boundaries синхронно.
- Сохранение Recommendation через application repository и полный analysis/profile orchestration выполняются в `ART-013`; `ART-010` уже выдаёт валидированный breakdown, version, total, band и explanation для существующей persistence-модели.
- Provider port, permission-safe request builder и failure taxonomy реализованы в `ART-011`; strict `ai-analysis/v1` и mapping невалидного ответа в failed Analysis реализованы в `ART-012`. Persistence/orchestration этих результатов остаются в `ART-013`.
- `Subscription`, сборка digest, расписание и recovery зависших delivery получают собственные модели и orchestration в `ART-017`–`ART-018`.
