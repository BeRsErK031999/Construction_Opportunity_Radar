# GET /users/:id/feedback-summary

Возвращает all-time FeedbackSummary пользователя. Требует Bearer token и `X-Radar-User-Id`, равный path `id`.

## Query

| Параметр         | Тип     | Default | Ограничение | Смысл                                           |
| ---------------- | ------- | ------- | ----------- | ----------------------------------------------- |
| `highScoreLimit` | integer | `20`    | `1..100`    | Максимум элементов `HIGH/CRITICAL + NOT_USEFUL` |

Неизвестные параметры отклоняются.

## Результат

- `200` — модель [FeedbackSummary](../common/models.md);
- `400 VALIDATION_ERROR` — невалидный UUID или query;
- `403 FORBIDDEN` — caller пытается читать чужую сводку.

Coverage считает уникальные успешно доставленные Recommendation, а не количество повторных Delivery. HTTP feedback без Delivery входит в action/sentiment counts как `direct`; в coverage numerator он попадёт, только если та же Recommendation действительно была успешно доставлена пользователю.
