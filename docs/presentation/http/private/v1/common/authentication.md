# Аутентификация и авторизация

## Bearer token

Все business endpoints требуют заголовок `Authorization: Bearer <API_AUTH_TOKEN>`. Отсутствующий или неверный token даёт `401 UNAUTHORIZED` и `WWW-Authenticate: Bearer`. Если token не настроен на сервере, endpoint закрывается с `503 API_NOT_CONFIGURED`.

Token — технический секрет между локальными процессами, а не пользовательская сессия. Он сравнивается без утечки исходного значения и редактируется в логах.

## Caller identity

Персональные операции требуют `X-Radar-User-Id: <uuid>`:

- `GET /signals`;
- `GET /signals/:id`;
- `GET|PATCH /users/:id/profile`;
- `POST /signals/:id/feedback`.

Для профиля caller ID обязан совпадать с `:id`; иначе возвращается `403 FORBIDDEN`. Возможности и feedback всегда выбираются через Recommendation, принадлежащую профилю caller-а. Telegram identity и персональные данные наружу не возвращаются.

В MVP заголовок устанавливает доверенный локальный transport-адаптер. До публичного bind необходима отдельная пользовательская authentication scheme из ART-022.
