# PATCH /users/:id/profile

Создаёт следующую append-only ревизию UserProfile. Требует Bearer token и `X-Radar-User-Id`, равный path `id`.

## Body

Хотя бы одно writable поле модели [UserProfile](../common/models.md): `companyType`, `companySize`, `verticals`, `regions`, `servicesAndProducts`, `targetClients`, `interestedEventTypes`, `ignoredEventTypes`, `keywords`, `excludedKeywords`, `projectValueRange`. Системные поля `id`, `userId`, `revision`, `createdAt`, `updatedAt` запрещены.

Массив или `projectValueRange`, переданный в body, заменяет значение целиком. `projectValueRange: null` очищает диапазон. После объединения проверяются непересечение positive/negative preferences и MVP vertical boundary.

## Результат

- `204` — новая ревизия сохранена;
- `403 FORBIDDEN` — чужой профиль или неактивный user;
- `404 NOT_FOUND` — профиль отсутствует;
- `422 VALIDATION_ERROR` — итоговый профиль нарушает доменный инвариант.
