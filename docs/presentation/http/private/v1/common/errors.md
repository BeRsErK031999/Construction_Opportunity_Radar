# Ошибки

Все ошибки имеют один safe envelope:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed",
    "details": [{ "path": "limit", "message": "Too big" }],
    "requestId": "req-1"
  }
}
```

| HTTP | `code` | Когда |
| --- | --- | --- |
| 400 | `VALIDATION_ERROR` | Некорректные path/query/header/body или неизвестные поля |
| 401 | `UNAUTHORIZED` | Нет корректного Bearer token |
| 403 | `FORBIDDEN` | Доступ к чужому профилю или запрещённая операция пользователя |
| 404 | `NOT_FOUND` | Ресурс или персональная Recommendation не найдены |
| 409 | `CONFLICT` | Идентификатор уже связан с другим ресурсом/feedback |
| 413 | `PAYLOAD_TOO_LARGE` | Request body превышает настроенный предел |
| 422 | `VALIDATION_ERROR` | Transport валиден, но нарушен доменный инвариант |
| 429 | `RATE_LIMITED` | IP исчерпал текущий request budget; повторять после `Retry-After` |
| 503 | `API_NOT_CONFIGURED` | Нет server token или database repositories |
| 500 | `INTERNAL_ERROR` | Непредвиденная ошибка; внутренние детали доступны только в server log |

`details` всегда является массивом. Для Zod-ошибок он содержит путь поля; доменные ошибки могут возвращаться без field-level details.
