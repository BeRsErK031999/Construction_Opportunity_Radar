# Durable jobs and scheduler

## Назначение

`ART-018` переносит автоматический запуск pipeline и digest-операций в PostgreSQL-backed runtime без копирования application/domain logic. `packages/jobs` владеет job-контрактом, scheduler и worker loop; `PrismaProcessingJobRepository` владеет атомарными переходами состояния; `apps/worker` связывает repository, structured logger и семь переданных application-операций.

Поддерживаются job-типы:

- `fetchSources`;
- `normalize`;
- `deduplicate`;
- `classify`;
- `analyze`;
- `buildDigest`;
- `deliverDigest`.

Конкретные операции регистрируются через `createPipelineJobHandlers`. Runtime передаёт им versioned JSON payload и функцию продления lease, но не реализует внутри себя сбор, классификацию, AI, scoring или доставку. Поэтому синхронные use case из `ART-013` и digest/delivery use case из `ART-017` остаются единственными владельцами бизнес-правил.

## Состояния и гарантии

Новая таблица `processing_jobs` хранит type, entity/concurrency/idempotency keys, versioned JSON payload, correlation ID, schedule time, attempt budget, lease owner/timestamps и безопасную последнюю ошибку.

Жизненный цикл:

```text
SCHEDULED -> RUNNING -> SUCCEEDED
                  \-> SCHEDULED  (retryable, budget remains)
                  \-> FAILED     (non-retryable or budget exhausted)
```

- Unique `(job_type, idempotency_key)` делает повтор enqueue безопасным.
- Partial unique `(job_type, concurrency_key)` для `SCHEDULED/RUNNING` запрещает overlap одной операции над одной сущностью. После terminal outcome следующее окно может создать новый job.
- Claim выполняется одним `UPDATE` из `SELECT ... FOR UPDATE SKIP LOCKED`; параллельные worker-ы не получают одну строку.
- Attempt увеличивается в момент claim. Только текущий `lease_owner` может продлить lease, завершить или отклонить job, причём после expiry старый worker больше не считается владельцем.
- Retry использует bounded exponential delay `base * 2^(attempt-1)` с верхней границей. Неретраебельная ошибка сразу становится `FAILED`.
- Stale `RUNNING` после падения процесса атомарно возвращается в `SCHEDULED` с тем же bounded backoff либо становится `FAILED`, если attempt budget исчерпан.
- Handler обязан быть идемпотентным: lease обеспечивает координацию, но не отменяет внешний side effect, если процесс умер после него и до записи `SUCCEEDED`.

## Scheduler

Fixed-interval scheduler вычисляет текущее окно относительно `anchorAt` и формирует стабильный ключ `<scheduleKey>:<bucketStart>`. Повторный tick или restart в том же окне возвращает `EXISTING`, а не новую строку. Если предыдущий job того же type/concurrency key ещё активен, результат — `OVERLAP_BLOCKED`.

Scheduler сознательно не создаёт все пропущенные окна задним числом: после долгого простоя он ставит только текущее окно. Для источника `concurrencyKey` должен быть привязан к Source ID; для глобальной стадии — к версии pipeline; для digest — к User ID и виду периода.

Production schedules по умолчанию не включены. Их должен передать composition root вместе с разрешёнными source adapters, выбранным AI provider и delivery adapter. Это не позволяет пустой конфигурации случайно вызвать внешний источник, Ollama или Telegram.

## Конфигурация

Worker fail-fast требует `DATABASE_URL`. Остальные ключи имеют типизированные безопасные defaults:

| Ключ | Default | Назначение |
| --- | ---: | --- |
| `WORKER_ID` | `<hostname>-<pid>` | Владелец lease; можно задать стабильный instance ID |
| `JOB_POLL_INTERVAL_MS` | `1000` | Пауза idle loop |
| `JOB_LOCK_TIMEOUT_MS` | `60000` | Срок lease |
| `JOB_MAX_ATTEMPTS` | `5` | Default attempt budget расписания |
| `JOB_RETRY_BASE_MS` | `1000` | Начальный retry delay |
| `JOB_RETRY_MAX_MS` | `300000` | Верхняя граница delay |
| `JOB_STALE_RECOVERY_LIMIT` | `100` | Максимум stale rows за один cycle |

Payload, database URL и error stack в structured events не пишутся. Job events содержат только job/type/entity/attempt/correlation и стабильный error code.

## Проверка

```powershell
pnpm db:migrate:deploy
pnpm db:validate
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm build
```

Unit tests проверяют dispatch, typed retry, missing handler, bounded delay и scheduler bucket. PostgreSQL integration проверяет concurrent enqueue/claim, no-overlap, delayed retry, terminal failure, disconnect/restart, stale recovery и отсутствие duplicate job после повторного scheduler tick.

## Recovery

1. Проверить structured events `job.retry_scheduled`, `job.failed` и `jobs.stale_recovered` по `jobId`/`correlationId`.
2. Не менять `RUNNING` вручную до истечения `lease_expires_at`: активный handler может ещё работать.
3. После expiry запустить обычный worker cycle; recovery выполнится до нового claim.
4. `FAILED` сохранять как terminal evidence. Повторять работу новым job с новым idempotency key только после устранения причины и проверки идемпотентности application use case.

Forward fix предпочтительнее отката. Удаление `processing_jobs` уничтожает историю попыток и допускается только после остановки scheduler/worker и экспорта нужной диагностики; бизнес-таблицы source-to-delivery от этой таблицы не зависят.
