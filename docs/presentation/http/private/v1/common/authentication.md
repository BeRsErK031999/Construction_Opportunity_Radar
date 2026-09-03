# Аутентификация и авторизация

## Bearer token

Business endpoints принимают строго один заголовок `Authorization: Bearer <token>`. Отсутствующий, неверный или не относящийся к scope token даёт `401 UNAUTHORIZED` и `WWW-Authenticate: Bearer`. Если credential нужного scope не настроен на сервере, endpoint закрывается с `503 API_NOT_CONFIGURED`.

Используются два разных технических секрета:

- `API_ADMIN_AUTH_TOKEN` — только `GET|POST|PATCH /sources`;
- `API_AUTH_TOKEN` — персональные `/signals`, `/users` и feedback.

Production config требует оба token и запрещает одинаковые значения. Token — секрет между локальными процессами, а не пользовательская сессия. Он сравнивается через digest в constant time и редактируется в логах.

## Caller identity

Персональные операции требуют `X-Radar-User-Id: <uuid>`:

- `GET /signals`;
- `GET /signals/:id`;
- `GET|PATCH /users/:id/profile`;
- `GET /users/:id/feedback-summary`;
- `POST /signals/:id/feedback`.

Для профиля и feedback summary caller ID обязан совпадать с `:id`; иначе возвращается `403 FORBIDDEN`. Возможности и feedback всегда выбираются через Recommendation, принадлежащую профилю caller-а. Telegram identity и персональные данные наружу не возвращаются.

В MVP заголовок устанавливает доверенный локальный transport-адаптер после user-scope authentication. Владение техническим token позволяет заявить любой UUID, поэтому API остаётся loopback-only. Публичный bind требует отдельной end-user authentication scheme и нового security decision.

## Rate boundary

По умолчанию один нормализованный IP получает 60 запросов за 60 секунд, включая `/health`; превышение возвращает `429 RATE_LIMITED` и `Retry-After`. `trustProxy` выключен, поэтому клиент не может сменить bucket через forwarded headers. Limiter хранится в памяти одного процесса и не является multi-instance/DDoS boundary.
