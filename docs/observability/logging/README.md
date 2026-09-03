# Контракт логирования

API, Telegram-бот, job worker и `process:fixtures` используют JSON-логи Pino через `@radar/observability`. Событие задаётся стабильным `event` в `snake_case`; дополнительные поля тоже используют `snake_case`.

## Процессы

- [HTTP API](http_api.md)
- [Telegram-бот](telegram_bot.md)
- [Job worker](job_worker.md)
- [Offline CLI](offline_cli.md)

Общие поля, уровни, redaction и error boundary описаны в [common.md](common.md).

## Совместимость

Имена событий — операционный контракт. Их переименование требует одновременного обновления runbook, тестов и сохранённых запросов к логам. Доменные DTO могут сохранять `camelCase`; это не меняет формат полей логов.

## Открытые вопросы

- Нужен ли отдельный `event_version` после подключения централизованного log backend.
