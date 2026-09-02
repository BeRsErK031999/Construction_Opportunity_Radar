# Private API v1

## Назначение и границы

API вызывают доверенные локальные transport-адаптеры, включая будущий Telegram bot. PostgreSQL остаётся source of truth; HTTP-слой вызывает application use cases и не содержит бизнес-правил.

## Общие правила

- JSON request/response; неизвестные поля отклоняются.
- Идентификаторы и cursor — UUID.
- Время — ISO 8601 с timezone; ответы нормализуются в UTC.
- Списки ограничены `limit <= 100`.
- Все ответы содержат `X-Radar-API-Version: 1`.
- `/health` публичен и не проверяет PostgreSQL. Остальные endpoints требуют Bearer token.
- Лимиты строк, массивов и чисел закреплены Zod-схемами в `packages/contracts/src/api-v1.ts`.

## Ресурсы

`Signal` — глобальный классифицированный факт, но `/signals` возвращает персональную проекцию `SignalOpportunity`: Signal + успешный Analysis + Recommendation для последней ревизии профиля текущего пользователя + provenance. Поэтому `score` фильтрует Recommendation, а не глобальный Signal. После изменения профиля выдача остаётся пустой до построения Recommendation для новой ревизии; старые персональные оценки не подмешиваются.
