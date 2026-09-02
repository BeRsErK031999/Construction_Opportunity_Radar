# GET /users/:id/profile

Возвращает последнюю ревизию UserProfile. Требует Bearer token и `X-Radar-User-Id`, равный path `id`.

- `200` — модель [UserProfile](../common/models.md);
- `403 FORBIDDEN` — caller пытается читать чужой профиль;
- `404 NOT_FOUND` — пользователь или профиль отсутствует.

Telegram user ID и иные transport identity не возвращаются.
