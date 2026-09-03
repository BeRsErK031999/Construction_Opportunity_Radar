# Наблюдаемость

Наблюдаемость MVP строится вокруг единого typed observer, structured JSON-логов и process-local счётчиков. Контракт покрывает фактические процессы API, Telegram-бота, job worker и offline CLI; отдельного collector-процесса в текущем срезе нет.

## Документы

- [Контракт логирования](logging/README.md) — уровни, события и документы процессов.
- [Общие поля](logging/common.md) — naming, correlation context, ошибки и запрещённые данные.
- [Операционный runbook](../runbooks/OBSERVABILITY.md) — счётчики, snapshot и локальная проверка.

## Границы ART-021

- Observer принадлежит application boundary и не зависит от Pino.
- Адаптер `@radar/observability` одновременно пишет события и увеличивает bounded-cardinality counters.
- Ошибка observer не меняет бизнес-исход и не запускает повторную доставку или AI-вызов.
- PostgreSQL остаётся источником истины; логи и counters не заменяют доменные записи.
- Grafana, Prometheus endpoint и внешний log backend в ART-021 не требуются.

## Открытые вопросы

- Выбрать exporter и retention после появления пилотной среды и требований к её инфраструктуре.
