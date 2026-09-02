# GET /sources

Возвращает страницу Source Registry. Требует Bearer token; user header не нужен.

## Query

| Поле | Тип | Обязательность | Правило |
| --- | --- | --- | --- |
| `after` | UUID | нет | Cursor |
| `limit` | integer | нет | `1..100`, default `20` |
| `enabled` | `true` или `false` | нет | Фильтр включения |
| `aiProcessingAllowed` | `true` или `false` | нет | Фильтр AI permission |
| `rightsStatus` | RightsStatus | нет | Точное совпадение |
| `vertical` | Vertical | нет | Источник содержит vertical |

## Ответ `200`

`{items: Source[], nextCursor: UUID|null}`. Модель Source описана в [общих моделях](../common/models.md).
