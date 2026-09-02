# Пагинация

`GET /sources` и `GET /signals` используют bounded cursor pagination.

| Параметр | Тип | Обязательность | Правило |
| --- | --- | --- | --- |
| `after` | UUID | нет | Непрозрачный `nextCursor` предыдущего ответа |
| `limit` | integer | нет | По умолчанию `20`, диапазон `1..100` |

Ответ:

```json
{ "items": [], "nextCursor": null }
```

`nextCursor = null` означает конец выборки. Клиент не должен интерпретировать cursor или конструировать его самостоятельно.

Источники упорядочены по `id`. Персональные возможности упорядочены по `recommendation.totalScore DESC`, затем времени создания Recommendation `DESC`, затем `recommendation.id ASC`.
