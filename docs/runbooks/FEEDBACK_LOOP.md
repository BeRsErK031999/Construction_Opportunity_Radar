# Feedback loop

## Назначение

`ART-016` превращает реакции на карточки в проверяемое product evidence. Feedback остаётся наблюдением пользователя: он не изменяет автоматически score, веса, prompt или статус Recommendation.

Поддерживаются пять действий:

- `USEFUL` — карточка полезна;
- `NOT_USEFUL` — карточка не полезна;
- `SAVED` — пользователь сохранил возможность;
- `ACTED` — возможность взяли в работу;
- `ALREADY_KNOWN` — пользователь уже знал о событии.

`USEFUL` и `NOT_USEFUL` взаимоисключаются. Остальные outcomes могут сосуществовать: например, пользователь мог уже знать о событии и всё равно взять его в работу.

## Запись и идемпотентность

HTTP принимает `{action, reason?}` через `POST /signals/:id/feedback` и требует UUID `Idempotency-Key`. Telegram callback передаёт action code и Delivery UUID; server-side feedback ID детерминированно строится из callback ID без сохранения исходного transport ID.

Identity Feedback — `(user, recommendation, action)`. Повтор и два конкурентных одинаковых callback-а возвращают первую append-only запись. Поэтому её `reason` и attribution не перезаписываются последующей попыткой; для другого пояснения в будущем потребуется отдельная comment/outcome-note модель. Противоположный sentiment возвращает явный conflict.

Если `delivery_id` задан, составной PostgreSQL FK требует совпадения Delivery, user и Recommendation. Прямой HTTP feedback оставляет Delivery пустым, но сохраняет user/recommendation/correlation chain.

## Персональная сводка

`GET /users/:id/feedback-summary?highScoreLimit=20` доступен только caller-у с тем же user ID и возвращает all-time read model:

- counts всех пяти actions;
- `direct` и `telegram` attribution;
- количество Recommendation с feedback;
- количество уникальных успешно доставленных Recommendation;
- feedback coverage;
- positive sentiment;
- ограниченный список `HIGH/CRITICAL + NOT_USEFUL` со score, headline, reason и trace IDs.

Формулы:

```text
feedbackCoveragePercent =
  unique SENT recommendations with any feedback
  / unique SENT recommendations * 100

positiveSentimentPercent =
  USEFUL / (USEFUL + NOT_USEFUL) * 100
```

Значения округляются до двух знаков. Coverage равен `0`, если успешных доставок нет; sentiment равен `null`, если нет `USEFUL/NOT_USEFUL`. HTTP feedback по Recommendation входит в coverage numerator только тогда, когда эта Recommendation действительно имеет успешный Delivery. Период/cohort в v1 отсутствует, чтобы не смешивать время доставки и более позднего действия.

## Проверка

```powershell
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm build
pnpm db:validate
```

Integration suite проверяет пять outcomes, optional reason, same-action race, opposite-sentiment conflict, read model и запрет несовместимой тройки Delivery/user/Recommendation на чистой PostgreSQL.

## Миграция и восстановление

Перед `20260902170000_enforce_feedback_delivery_context` потенциально несовместимые строки можно проверить read-only запросом:

```sql
SELECT f.id, f.delivery_id, f.user_id, f.recommendation_id
FROM feedback AS f
JOIN deliveries AS d ON d.id = f.delivery_id
WHERE f.delivery_id IS NOT NULL
  AND (f.user_id <> d.user_id OR f.recommendation_id <> d.recommendation_id);
```

Непустой результат требует ручной проверки provenance; такие строки нельзя автоматически удалять или перепривязывать. Migration deploy должен остановиться до исправления.

Для технического отката constraint без удаления Feedback/Delivery данных:

```sql
ALTER TABLE feedback DROP CONSTRAINT feedback_delivery_context_fkey;
DROP INDEX deliveries_feedback_context_key;
ALTER TABLE feedback
  ADD CONSTRAINT feedback_delivery_id_fkey
  FOREIGN KEY (delivery_id) REFERENCES deliveries(id)
  ON DELETE RESTRICT ON UPDATE CASCADE;
```

Это ослабляет целостность до состояния ART-015 и допустимо только как кратковременное восстановление с отдельной фиксацией причины.
