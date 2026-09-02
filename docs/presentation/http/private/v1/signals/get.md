# GET /signals/:id

Возвращает персональную SignalOpportunity по UUID глобального Signal. Требует Bearer token и `X-Radar-User-Id`.

Ответ `200` соответствует модели [SignalOpportunity](../common/models.md). Если Signal существует, но Recommendation caller-а отсутствует, endpoint возвращает `404 NOT_FOUND`, не раскрывая наличие чужих рекомендаций.
