# POST /signals/:id/feedback

Сохраняет feedback caller-а для его Recommendation по UUID Signal. Требует Bearer token, `X-Radar-User-Id` и `Idempotency-Key: <uuid>`.

## Body

Модель `{action, reason?}` описана в [общих моделях](../common/models.md). Feedback связывается с user, Recommendation и correlation ID на сервере; клиент их не передаёт.

## Результат

- `201 {"id":"<idempotency-key>"}` — feedback создан;
- `200 {"id":"<uuid>"}` — та же операция уже была сохранена;
- `404 NOT_FOUND` — у caller-а нет Recommendation для Signal;
- `409 CONFLICT` — ключ уже использован для другого действия или уже записана противоположная sentiment-оценка.

Для пары user + Recommendation допускается не более одной sentiment-оценки из `USEFUL`/`NOT_USEFUL`. Повтор после сетевого timeout безопасен с тем же `Idempotency-Key`.
