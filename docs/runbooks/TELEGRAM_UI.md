# Telegram UI

## Назначение и границы

`ART-015` добавляет отдельный grammY-процесс для закрытого MVP. Бот работает только в private chat и показывает уже созданные персональные Recommendation из PostgreSQL; он не собирает контент Telegram и не вызывает AI.

Главное меню зафиксировано продуктовым контрактом:

- `🔥 Новые возможности`;
- `📊 Дайджест`;
- `⭐ Сохраненные`;
- `⚙️ Мои интересы`;
- `ℹ️ Помощь`.

Карточка содержит Opportunity Score, вертикаль, summary, объяснение важности, первые два-три приоритетных рекомендуемых действия и ссылку на разрешённый первоисточник. Inline-кнопки сохраняют `USEFUL`, `NOT_USEFUL` или `SAVED`. Автоматический digest, настройка частоты и изменение профиля через Telegram не имитируются: UI прямо сообщает, что эти функции ещё не включены.

## Delivery и idempotency

Для каждой пары `interaction + recommendation` application-слой:

1. проверяет активного пользователя по Telegram user ID;
2. создаёт `Delivery/PENDING` до transport-вызова;
3. передаёт адаптеру semantic card, а не готовый Telegram payload;
4. фиксирует единственный terminal outcome `SENT` с provider message ID либо `FAILED` с безопасными code/reason;
5. при повторе identity возвращает существующий Delivery без повторной отправки.

Callback data содержит только код действия и UUID Delivery и укладывается в ограничение Telegram. Feedback ссылается на user, recommendation, delivery и correlation ID. Callback чужого пользователя и callback для неуспешной доставки выглядят как недоступная карточка; неожиданный сбой получает краткий пользовательский ответ и safe structured log.

## Offline-проверка без токена

Основной Definition of Done не обращается к Telegram:

```powershell
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm build
pnpm db:validate
```

`FakeDeliveryAdapter` проверяет application orchestration и replay. Инъецированный `TelegramMessageClient` проверяет HTML escaping, длину текста, клавиатуру, callback payload и mapping ответа без сети. PostgreSQL integration test подтверждает `PENDING -> SENT`, отсутствие повторной отправки, feedback по Delivery и выдачу сохранённой карточки.

## Подготовка локальной базы

```powershell
pnpm db:up
pnpm db:migrate:deploy
pnpm process:fixtures
```

Fixture pipeline создаёт две тестовые учётные записи и Recommendation, но их `telegram_user_id` — стабильные fixture-идентификаторы. Для live smoke администратор должен отдельно связать одну тестовую запись с числовым Telegram user ID тестировщика. Не добавляйте этот ID, имя, телефон или другие PII в fixtures и Git.

## Конфигурация и запуск

Сохраните только на локальной машине в ignored `.env`:

```dotenv
TELEGRAM_BOT_TOKEN=<token-from-BotFather>
TELEGRAM_POLLING_TIMEOUT_SECONDS=30
DATABASE_URL=postgresql://radar:radar_local@127.0.0.1:54329/radar
```

Токен обязателен только для bot-процесса, валидируется при старте и редактируется логгером. Не передавайте его в commit, issue, лог или командную строку.

Development-запуск:

```powershell
pnpm bot:dev
```

Production-like локальный запуск:

```powershell
pnpm build
pnpm bot:start
```

Процесс использует long polling, регистрирует `/start`, `/opportunities`, `/help`, обрабатывает только message/callback updates и по `SIGINT`/`SIGTERM` останавливает bot polling перед отключением Prisma.

## Разрешённый live smoke

Live smoke выполняется только по отдельному запросу владельца и при наличии тестового bot token:

1. убедиться, что PostgreSQL слушает только localhost и migrations применены;
2. связать свой Telegram user ID с отдельным тестовым профилем;
3. запустить bot-процесс и открыть `/start` в private chat;
4. проверить все пять пунктов меню и одну карточку;
5. нажать `Полезно`, повторить callback и убедиться, что feedback не дублируется;
6. проверить `Сохраненные`, source URL и отсутствие token/user ID в logs;
7. остановить процесс через `Ctrl+C`.

Без этих credentials offline suite остаётся достаточным доказательством `ART-015`, но не доказательством live Telegram-доставки и не основанием считать Gate G4 пройденным.

## Failure recovery

- Transport error сохраняет `FAILED`; пользователю предлагается повторить запрос позже.
- Повтор того же interaction не переотправляет terminal Delivery. Новый пользовательский запрос создаёт новую interaction identity.
- `PENDING`, оставшийся после аварии процесса, не отправляется автоматически. Lease/retry/stale recovery принадлежат `ART-018 Durable jobs and scheduler`.
- Если профиль отсутствует или отключён, бот не раскрывает данные и предлагает обратиться к администратору закрытого MVP.
