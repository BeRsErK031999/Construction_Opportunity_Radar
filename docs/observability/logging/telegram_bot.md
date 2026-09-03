# Telegram-бот: события

| Event | Level | Ключевые поля | Условие |
| --- | --- | --- | --- |
| `telegram_started` | INFO | — | long polling запущен |
| `telegram_stopping` | INFO | `signal` | начат graceful shutdown |
| `telegram_stopped` | INFO | — | polling и DB client закрыты |
| `telegram_update_failed` | ERROR | `update_id`, `err` | unexpected error достиг grammY boundary |
| `telegram_stop_failed` | ERROR | `err` | остановка grammY завершилась ошибкой |
| `telegram_start_failed` | CRITICAL | `err` | bootstrap не смог запустить бот |
| `delivery_completed` | INFO/WARNING | `correlation_id`, `delivery_id`, `kind`, `outcome`, `reused`, `opportunities`, `error_code` | digest/card завершён как `SENT`, `FAILED`, `PENDING` или `SKIPPED` |
| `operational_metrics_snapshot` | INFO | `metrics` | финальный process-local snapshot при штатной остановке |

`telegramUserId`, chat ID и текст сообщения не входят в событие доставки. Повтор Telegram update сохраняет исходный outcome и отмечается `reused=true`, а не считается вторым transport-вызовом.

## Открытые вопросы

- Определить alert threshold для доли `FAILED` после накопления пилотной baseline.
