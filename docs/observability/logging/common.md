# Общий logging-контракт

## Формат и обязательные поля

Каждая запись — один JSON-объект. Pino добавляет `time`, `level`, `service` и, если задано, `environment`. Прикладная запись добавляет:

| Поле | Когда обязательно | Назначение |
| --- | --- | --- |
| `event` | всегда для операционного события | стабильное имя в `snake_case` |
| `correlation_id` | когда событие относится к raw item, signal, analysis, recommendation, delivery или job | трассировка одного бизнес-сигнала |
| `source_id` | ingestion | источник без URL и raw payload |
| `run_id` | offline pipeline | связывает стадии одного запуска |
| `job_id`, `job_type` | job runtime | конкретное durable-задание и bounded type |
| `error_code` | ожидаемый или сохранённый failure | машинно-читаемая причина без пользовательского текста |

`correlation_id` переносится из сохранённой сущности. Для source-level summary, где одного correlation ID нет, используется `source_id`; для pipeline summary — `run_id`.

## Уровни

- `DEBUG` — подробная техническая диагностика, выключенная по умолчанию.
- `INFO` — lifecycle, успешные и idempotent outcomes, snapshot счётчиков.
- `WARNING` — ожидаемая деградация с сохранённым failure/retry outcome.
- `ERROR` — terminal failure на process/job boundary.
- `CRITICAL`/Pino `fatal` — процесс не может запуститься.

Одна ошибка логируется один раз на внешней границе. Expected failure передаётся через `error_code`; stack допустим для неожиданной ошибки на boundary и проходит credential sanitization.

## Запрещённые данные

Нельзя логировать raw text/payload, prompt или ответ модели целиком, Telegram user ID, feedback-текст, токены, cookies, authorization headers, пароли, API keys и database URL. Logger редактирует известные secret-пути в `camelCase`/`snake_case` и credentials внутри serialized error message/stack. API отключает стандартный raw-URL request log и пишет только route template, method, status и request ID. Redaction не заменяет правильный выбор полей.

Metric labels содержат только закрытые перечисления (`stage`, `status`, `outcome`, `kind`, `job_type`). Идентификаторы, provider/model и error message не попадают в labels.

## Открытые вопросы

- Установить срок хранения логов и список ролей с доступом перед пилотным deployment.
