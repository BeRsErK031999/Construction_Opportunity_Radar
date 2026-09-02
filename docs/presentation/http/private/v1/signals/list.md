# GET /signals

Возвращает страницу персональных SignalOpportunity caller-а. Требует Bearer token и `X-Radar-User-Id`.

## Query

| Поле | Тип | Обязательность | Правило |
| --- | --- | --- | --- |
| `after` | UUID | нет | Cursor Recommendation |
| `limit` | integer | нет | `1..100`, default `20` |
| `vertical` | Vertical | нет | Фильтр Signal |
| `category` | string | нет | Точное совпадение категории Signal |
| `status` | SignalStatus | нет | Точное совпадение статуса Signal |
| `score` | number | нет | Минимальный `Recommendation.totalScore`, `0..100` |
| `dateFrom` | datetime | нет | `Signal.createdAt >= dateFrom` |
| `dateTo` | datetime | нет | `Signal.createdAt <= dateTo`; не раньше `dateFrom` |

## Ответ `200`

`{items: SignalOpportunity[], nextCursor: UUID|null}`. Facts, inferences, explainable score, actions и source links возвращаются вместе; модель описана в [общих моделях](../common/models.md).
