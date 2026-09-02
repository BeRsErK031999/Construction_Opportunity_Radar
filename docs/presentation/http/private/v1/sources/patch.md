# PATCH /sources/:id

Частично изменяет Source Registry. Требует Bearer token; user header не нужен.

## Path и body

`id` — UUID источника. Body содержит хотя бы одно writable поле [Source](../common/models.md); `null` допустим только у nullable полей. После объединения с текущим состоянием проверяются все доменные инварианты.

## Результат

- `204` — новая версия состояния сохранена;
- `404 NOT_FOUND` — источник отсутствует;
- `422 VALIDATION_ERROR` — итоговая комбинация полей нарушает permission/collection policy.

Например, нельзя оставить `aiProcessingAllowed=true` и одновременно установить `rightsStatus=REVIEW_REQUIRED`.
