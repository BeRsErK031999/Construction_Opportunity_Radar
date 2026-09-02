# POST /sources

Создаёт запись Source Registry. Требует Bearer token; user header не нужен.

## Body

Все writable поля модели [Source](../common/models.md) обязательны. Response-only поля `id`, `createdAt`, `updatedAt`, `lastSuccessAt`, `lastErrorAt` запрещены. Неизвестные поля запрещены.

## Результат

- `201 {"id":"<uuid>"}` — источник создан;
- `409 CONFLICT` — сгенерированный ID уже занят;
- `422 VALIDATION_ERROR` — нарушено правило прав, Telegram permission или collection policy.

Операция не включает источник в AI processing, если доменная комбинация `aiProcessingAllowed`, `rightsStatus` и `rightsBasis` недопустима.
