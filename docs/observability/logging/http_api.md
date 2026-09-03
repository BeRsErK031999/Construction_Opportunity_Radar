# HTTP API: события

| Event | Level | Ключевые поля | Условие |
| --- | --- | --- | --- |
| `api_started` | INFO | `address` | Fastify начал принимать локальные соединения |
| `api_stopping` | INFO | `reason` | начат graceful shutdown |
| `api_stopped` | INFO | `reason` | HTTP server и ресурсы закрыты |
| `api_request_failed` | ERROR | `request_id`, `err` | unexpected error достиг request boundary |
| `api_start_cleanup_failed` | ERROR | `err` | cleanup после неуспешного старта завершился ошибкой |
| `api_shutdown_failed` | ERROR | `signal`, `err` | shutdown по сигналу завершился ошибкой |
| `api_start_failed` | CRITICAL | `err` | bootstrap не смог запустить API |

Ожидаемые HTTP 4xx ответы не логируются как server failure. В `err` нельзя добавлять request body, auth header или database URL.

## Открытые вопросы

- Добавлять ли latency buckets после появления измеримого SLO API.
