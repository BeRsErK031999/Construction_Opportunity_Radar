# Digest v1

## Назначение и границы

`ART-017` превращает уже сохранённые персональные `Recommendation` в компактный неизменяемый снимок. Raw text и raw payload в сборку и delivery-контракт не передаются. Каждый пункт остаётся трассируемым через `DigestItem -> Recommendation -> Signal/Analysis -> Source` и содержит ссылку на первоисточник.

Версия правила — `digest-v1`:

- `DAILY` охватывает текущие UTC-сутки и содержит не более пяти рекомендаций;
- `WEEKLY` охватывает UTC-неделю с понедельника и дополнительно содержит счётчики обработки и рост категорий;
- автоматический запуск, retry, stale-lock recovery и расписание относятся к `ART-018`.

Пункт Telegram-меню `📊 Дайджест` сейчас собирает и доставляет daily-снимок по запросу. Weekly-сборка доступна тому же application use case и проверена offline/integration-тестами; пользовательская настройка частоты появится вместе с onboarding/scheduler.

## Детерминированный отбор

Кандидаты берутся только из Recommendation последней ревизии профиля, чьи Signal созданы в полуоткрытом периоде `[period_start, period_end)` и имеют статус `CANDIDATE` или `ACTIVE`. Несколько Recommendation одного Signal сворачиваются до одной по порядку:

1. `total_score DESC`;
2. `recommendation.created_at DESC`;
3. `recommendation.id ASC`.

Первые пять становятся `DigestItem` с непрерывными rank `1..5`. Digest хранит ID и ревизию профиля, период, версию, correlation ID и выбранные Recommendation; последующее изменение данных не переписывает уже собранный снимок.

## Weekly summary

Счётчики относятся ко времени завершения соответствующего этапа внутри UTC-недели:

- `processed` — RawItem по `received_at`;
- `unique` — representative-записи DeduplicationAssignment по `created_at`;
- `relevant` — `CANDIDATE/ACTIVE` Signal по `created_at`;
- `opportunities` — уникальные персональные Signal с Recommendation текущей ревизии профиля;
- `highPriority` — персональные Recommendation с band `HIGH` или `CRITICAL`.

Эти показатели описывают активность этапов, а не одну синхронную cohort-воронку: материал, принятый в конце недели, может пройти следующий этап уже в следующем периоде. Растущие категории сравнивают количество персональных возможностей с предыдущим равным периодом; показываются только положительные delta, максимум пять, с детерминированной сортировкой `delta DESC`, `current_count DESC`, `category ASC`.

## Idempotency и delivery

Identity снимка:

```text
(user_id, kind, period_start, period_end, digest_version)
```

Повторная сборка возвращает первую сохранённую версию. `digest_deliveries` отдельно хранит `PENDING -> SENT|FAILED`; unique `(channel, digest_id)` не позволяет повторному запросу отправить тот же снимок второй раз. Пустой daily не сохраняется и не отправляется, поэтому новые Recommendation того же дня остаются доступными следующему запросу; weekly сохраняется и может быть отправлен даже без рекомендаций, потому что содержит activity summary. `FAILED` остаётся terminal evidence; его безопасный автоматический retry будет реализован через durable job в `ART-018`.

Telegram-адаптер формирует одно HTML-сообщение до 4096 символов. Каждый пункт показывает rank, score, категорию, headline, первое практическое действие и HTML-escaped source URL. Fake-адаптер выполняет тот же semantic port без сети и токена.

## Проверка

```powershell
pnpm db:generate
pnpm db:validate
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm build
```

Integration suite на чистой PostgreSQL подтверждает daily top-5, weekly `processed=200 / unique=150 / relevant=110`, сохранённые source links, повторную сборку без нового Digest и повторную доставку без второго transport-вызова.

## Миграция и восстановление

Миграция `20260902190000_add_digests` только добавляет enum и четыре таблицы: `digests`, `digest_items`, `digest_category_trends`, `digest_deliveries`. Следующая `20260902193000_enforce_digest_profile_context` усиливает FK: сохранённая ревизия профиля обязана принадлежать тому же user, что и Digest. Перед deploy достаточно стандартного backup из будущего `ART-023`; существующие pipeline/Delivery/Feedback строки не меняются.

После применения проверить:

```sql
SELECT kind, COUNT(*) FROM digests GROUP BY kind ORDER BY kind;
SELECT status, COUNT(*) FROM digest_deliveries GROUP BY status ORDER BY status;
```

Forward fix предпочтительнее отката. Удаление этих таблиц уничтожит только вновь собранные digest-снимки и их delivery evidence, поэтому допустимо лишь после экспорта/backup и остановки bot/worker. Existing Recommendation, Delivery карточек и Feedback при этом не затрагиваются.
