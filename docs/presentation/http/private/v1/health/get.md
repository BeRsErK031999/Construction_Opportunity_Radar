# GET /health

Публичная минимальная liveness-проверка процесса. Не вызывает PostgreSQL и не означает readiness полного сервиса.

## Ответ `200`

| Поле | Тип | Смысл |
| --- | --- | --- |
| `service` | `"api"` | Процесс |
| `status` | `"ok"` | Процесс отвечает |
| `version` | string | Версия приложения |
| `timestamp` | datetime | Текущее server time |
| `uptimeSeconds` | number | Uptime процесса, неотрицательный |
