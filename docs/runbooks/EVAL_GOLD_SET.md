# Eval gold set v1

## Назначение

`fixtures/evals/v1/dataset.json` — отдельный от ingestion fixtures версионированный набор для воспроизводимой оценки AI-пайплайна. Он не загружается в PostgreSQL и не используется как operational source. `packages/evals` загружает набор и валидирует его через строгий контракт `eval-gold/v1` из `packages/contracts`.

ART-019 создаёт техническую baseline-разметку для benchmark harness из ART-020. Сам по себе этот набор не подтверждает качество реальной модели и не закрывает Gate G1.

## Состав v1

Набор содержит ровно 200 русскоязычных синтетических материалов, созданных внутри проекта:

| Измерение | Состав |
| --- | ---: |
| Construction | 100 |
| HoReCa | 100 |
| Relevant | 160, по 80 на вертикаль |
| Negative / irrelevant | 40, по 20 на вертикаль |
| Calibration | 80, по 40 на вертикаль |
| Holdout | 120, по 60 на вертикаль |
| Размеченные facts | 360, от 1 до 2 на материал |

Каждый элемент содержит:

- исходные `title`, `text`, `originalUrl`, время и source provenance;
- `vertical`, `relevant`, `category` и более конкретный `eventType`;
- от одного до трёх `facts`, где `evidenceQuote` дословно встречается в source text;
- краткий `summary`;
- ожидаемое действие с `kind`, заголовком и объяснением;
- importance `0..100` с объяснением;
- split `CALIBRATION` или `HOLDOUT`.

Для negative-примеров обязательны `OTHER`, `IRRELEVANT_NOTICE`, действие `IGNORE` и importance ниже 40. Для relevant-примеров действие должно быть практическим, importance — не ниже 40, а category должна соответствовать вертикали.

## Provenance и ограничения

`annotationPolicy.status` равен `TECHNICAL_BASELINE`, а `provenance.contentOrigin` — `PROJECT_AUTHORED_SYNTHETIC`. Тексты и labels созданы проектом и не копируют live-источники или защищённый сторонний контент. URL под доменом `evals.radar.local` — стабильные фиктивные идентификаторы, а не доступные внешние страницы.

Это означает:

- набор безопасно хранить в Git и использовать офлайн;
- он проверяет контракт, pipeline и очевидные регрессии;
- шаблонные синтетические формулировки не доказывают качество на реальном рыночном распределении;
- статус нельзя описывать как human-adjudicated до независимой проверки разметки Артёмом и Денисом;
- результаты 8B/14B должны быть получены на одном неизменном dataset/prompt/schema и зафиксированы отдельно в ART-020.

Calibration split можно использовать для настройки prompt и deterministic rules. Holdout split нельзя читать или подгонять во время настройки конкретной версии; метрики по нему формируются только итоговым прогоном. Изменение текста или labels требует нового dataset/policy version либо явно проверяемого изменения v1 до начала внешних сравнений.

## Воспроизведение и проверка

Генератор детерминирован и не выполняет сетевые вызовы:

```powershell
pnpm evals:generate
pnpm evals:validate
pnpm exec vitest run packages/evals/test/eval-gold.test.ts
```

`evals:validate` печатает counts и SHA-256 семантического JSON. Для текущей версии hash равен `5457ac44d5fc1fff1b216d9aa0fb6a1a168e913b195811e5b633fc2d8238357a`.

Тесты подтверждают строгую схему, баланс, точную evidence-привязку, rejection неподтверждённого факта и отсутствие полного text overlap с `fixture-ingestion/v1`.

Протокол запуска и определения метрик находятся в [AI benchmark runbook](AI_BENCHMARK.md).
