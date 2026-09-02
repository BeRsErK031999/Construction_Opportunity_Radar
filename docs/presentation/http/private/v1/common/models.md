# Модели API v1

## Source

| Поле | Тип | Nullable | Смысл и ограничения |
| --- | --- | --- | --- |
| `id` | UUID | нет | Идентификатор источника |
| `name` | string | нет | Название, `1..300` |
| `type` | enum | нет | `FIXTURE`, `RSS`, `PUBLIC_API`, `WEB`, `PARTNER_FEED`, `PARTNER_TELEGRAM`, `MANUAL` |
| `url` | HTTP(S) URL | нет | Адрес источника |
| `country` | string | нет | Страна, `1..100` |
| `regions` | string[] | нет | Уникальные регионы, минимум один |
| `verticals` | enum[] | нет | `CONSTRUCTION`, `HORECA`, `OTHER`; минимум один |
| `rightsStatus` | enum | нет | `OPEN_DATA`, `PUBLIC_API`, `PARTNER`, `CONSENT`, `REVIEW_REQUIRED`, `BLOCKED` |
| `rightsBasis` | string | да | Документированное основание, до 4000 |
| `ownerContact` | string | да | Контакт владельца, до 500 |
| `aiProcessingAllowed` | boolean | нет | Явное разрешение AI processing |
| `enabled` | boolean | нет | Источник включён |
| `reliabilityScore` | number | нет | `0..100` |
| `signalQualityNotes` | string | да | Заметки качества, до 4000 |
| `collectionPolicy.parserKind` | enum | нет | `FIXTURE_JSON`, `RSS`, `JSON_API`, `HTML`, `MANUAL` |
| `collectionPolicy.pollIntervalMinutes` | positive integer | да | `null` допустим только для `FIXTURE`/`MANUAL` |
| `lastSuccessAt` | datetime | да | Последний успешный сбор; response-only |
| `lastErrorAt` | datetime | да | Последняя ошибка сбора; response-only |
| `createdAt` | datetime | нет | Создание; response-only |
| `updatedAt` | datetime | нет | Последнее изменение; response-only |

Если `aiProcessingAllowed=true`, обязательны разрешённый `rightsStatus` и непустой `rightsBasis`. Для `PARTNER_TELEGRAM` допустимы только `PARTNER` или `CONSENT`.

## SignalOpportunity

| Область | Поле | Тип | Nullable | Смысл |
| --- | --- | --- | --- | --- |
| `signal` | `id` | UUID | нет | Глобальный Signal |
| `signal` | `vertical` | enum | нет | `CONSTRUCTION`, `HORECA`, `OTHER` |
| `signal` | `category` | string | нет | Версионируемая категория |
| `signal` | `relevanceScore` | number | нет | Глобальная релевантность `0..100` |
| `signal` | `classificationConfidence` | number | нет | Уверенность классификации `0..100` |
| `signal` | `status` | enum | нет | `CANDIDATE`, `ACTIVE`, `DISMISSED`, `SUPERSEDED` |
| `signal` | `createdAt`, `updatedAt` | datetime | нет | Времена Signal |
| `analysis` | `headline` | string | нет | Заголовок |
| `analysis` | `summary` | string | нет | Краткое содержание |
| `analysis` | `whyImportant` | string | нет | Значимость без смешения с фактами |
| `analysis` | `eventType` | string | нет | Тип события |
| `analysis` | `facts[]` | object[] | нет | `{id, statement, sourceIds[]}`; минимум один факт |
| `analysis` | `inferences[]` | object[] | нет | `{id, statement, basisFactIds[]}` |
| `analysis` | `risks[]` | string[] | нет | Риски и неопределённость |
| `analysis` | `deadline` | datetime | да | Известный срок |
| `analysis` | `confidence` | number | нет | `0..1` |
| `recommendation` | `id` | UUID | нет | Персональная Recommendation |
| `recommendation` | `totalScore` | number | нет | Opportunity Score `0..100` |
| `recommendation` | `band` | enum | нет | `LOW`, `MEDIUM`, `HIGH` |
| `recommendation` | `scoreBreakdown` | object | нет | `businessImpact`, `companyFit`, `urgency`, `confidence`, `actionability`, каждый `0..100` |
| `recommendation` | `explanation` | string | нет | Проверяемое объяснение оценки |
| `recommendation` | `recommendedActions[]` | object[] | нет | `{kind, priority, title, rationale}`, от 2 до 5 действий |
| `recommendation` | `scoringVersion` | string | нет | Версия детерминированных правил |
| `sources[]` | `sourceId` | UUID | нет | Источник доказательства |
| `sources[]` | `normalizedItemId` | UUID | нет | Нормализованный item |
| `sources[]` | `sourceName` | string | нет | Название источника |
| `sources[]` | `sourceUrl`, `canonicalUrl` | HTTP(S) URL | нет | Source и item links |
| `sources[]` | `publishedAt` | datetime | да | Время публикации источника |

## UserProfile

| Поле | Тип | Nullable | Смысл |
| --- | --- | --- | --- |
| `id`, `userId` | UUID | нет | Идентификаторы профиля и владельца |
| `revision` | positive integer | нет | Номер append-only ревизии |
| `companyType` | string | нет | Тип компании, `1..300` |
| `companySize` | enum | нет | `SELF_EMPLOYED`, `MICRO`, `SMALL`, `MEDIUM`, `LARGE` |
| `verticals` | enum[] | нет | Только `CONSTRUCTION` и/или `HORECA` до Gate G4 |
| `regions` | string[] | нет | Минимум один регион |
| `servicesAndProducts` | string[] | нет | Минимум один продукт/сервис |
| `targetClients` | string[] | нет | Целевые клиенты |
| `interestedEventTypes`, `ignoredEventTypes` | string[] | нет | Непересекающиеся типы событий |
| `keywords`, `excludedKeywords` | string[] | нет | Непересекающиеся ключевые слова |
| `projectValueRange` | object | да | `currency` ISO 4217, `minimum`/`maximum` non-negative number или `null`; хотя бы одна граница |
| `createdAt`, `updatedAt` | datetime | нет | Времена ревизии |

## Feedback request

| Поле | Тип | Обязательность | Смысл |
| --- | --- | --- | --- |
| `action` | enum | да | `USEFUL`, `NOT_USEFUL`, `SAVED`, `ACTED`, `ALREADY_KNOWN` |
| `reason` | string или null | нет | Причина, `1..2000` при непустом значении |
