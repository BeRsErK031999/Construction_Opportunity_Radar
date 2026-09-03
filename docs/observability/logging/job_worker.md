# Job worker: события

| Event | Level | Ключевые поля | Условие |
| --- | --- | --- | --- |
| `worker_started` | INFO | `worker_id` | worker loop запущен |
| `worker_stopping`, `worker_stopped` | INFO | `reason` | начало и конец graceful shutdown |
| `worker_shutdown_failed` | ERROR | `signal`, `err` | shutdown по сигналу завершился ошибкой |
| `job_started` | INFO | `correlation_id`, `job_id`, `job_type`, `entity_key`, `attempt` | durable job захвачен worker-ом |
| `job_succeeded` | INFO | `correlation_id`, `job_id`, `job_type`, `attempt` | job сохранён как `SUCCEEDED` |
| `job_retry_scheduled` | WARNING | `correlation_id`, `job_id`, `job_type`, `attempt`, `error_code`, `retryable` | сохранён bounded retry |
| `job_failed` | ERROR | те же | достигнут terminal failure |
| `stale_jobs_recovered` | WARNING | `requeued`, `failed` | lease просроченных jobs восстановлены |
| `job_schedules_evaluated` | INFO | `created`, `existing`, `not_started`, `overlap_blocked` | scheduler создал job или заблокировал overlap |
| `operational_metrics_snapshot` | INFO | `metrics` | финальный process-local snapshot при штатной остановке |

Runtime не логирует payload job и сохранённый error reason. `correlation_id` позволяет перейти к сущностям pipeline без включения содержимого источника.

## Открытые вопросы

- Зафиксировать production schedule и alert threshold для terminal failures в ART-024.
