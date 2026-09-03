# AI benchmark v1

## Назначение

`benchmark:ai` запускает один выбранный `AIProvider` на неизменном `eval-gold/v1` и печатает строгий JSON-отчёт `ai-benchmark-report/v1`. Команда нужна для воспроизводимого сравнения provider/model при одинаковых dataset hash, split, prompt version, analysis version и structured schema.

ART-020 подтверждает работу harness на `FakeAIProvider`. Он не подтверждает качество DeepSeek, скорость GPU или прохождение Gate G1: реальные одинаковые прогоны 8B и 14B остаются внешним evidence после подключения Ollama adapter и inference-host.

## Запуск

Полный локальный прогон без сети, PostgreSQL и Ollama:

```powershell
pnpm benchmark:ai --provider fake --model fixture-analysis-v1 --dataset fixtures/evals/v1/dataset.json --split all
```

Поддерживаемые параметры:

- `--provider`: сейчас только `fake`; неизвестный provider завершает команду с ошибкой;
- `--model`: ожидаемая model identity, для fake по умолчанию `fixture-analysis-v1`;
- `--dataset`: путь к JSON; по умолчанию versioned `fixtures/evals/v1/dataset.json`;
- `--split`: `all`, `calibration` или `holdout`;
- `--prompt-version`: version identity, по умолчанию `benchmark-prompt/v1`;
- `--vram-peak-mib`: необязательное положительное число только для независимо измеренного peak VRAM.

JSON пишется в stdout. Configuration/dataset errors пишутся в stderr и дают ненулевой exit code. Отчёт не сохраняется автоматически и не изменяет PostgreSQL.

## Input boundary

Каждый eval item преобразуется через те же domain constructors и `createAIAnalysisRequest`, что и рабочий pipeline. Source помечен как разрешённый project-owned fixture, source URL/text/time сохраняются, а structured result повторно проверяется через `ai-analysis/v1` и request identity.

Ожидаемые labels не передаются provider-у:

- source vertical используется как допустимая production-подсказка и не оценивается benchmark-ом;
- input category всегда `UNCLASSIFIED`;
- classification confidence и relevance score всегда нейтральные `50`;
- expected event type, relevance, facts, action и importance остаются только на стороне evaluator.

Relevance prediction определяется из результата: `eventType = IRRELEVANT_NOTICE` означает negative, любое другое значение — relevant.

## Метрики отчёта

### Validity

- `succeeded`: ответы, прошедшие `ai-analysis/v1`, identity/version и source-union checks;
- `invalidResponses`: returned/thrown `AI_INVALID_RESPONSE` и malformed successful Analysis;
- `providerFailures`: timeout, unavailable, rate limit, input или internal failures;
- `validRate = succeeded / (succeeded + invalidResponses)`; transport failures не маскируются как invalid JSON;
- `coverage = succeeded / attempted`; поэтому недоступный provider не может показать высокий coverage.

### Classification

`eventType.accuracy` — exact match без учёта регистра и внешних пробелов среди valid answers. Relevance содержит confusion matrix, precision, recall, F1 и accuracy. `unscored` показывает items без valid answer; такие items не подмешиваются в confusion matrix, а их потеря видна в coverage.

### Factuality

- expected fact считается найденным, если generated fact содержит его exact `evidenceQuote` или является его фрагментом;
- generated fact считается source-supported, только если его нормализованный statement дословно входит в evidence text с указанным `sourceId`;
- `unsupportedGeneratedFacts` и `hallucinationCount` равны числу generated facts без такой опоры;
- `expectedFactRecall` и `generatedFactSupportRate` считаются отдельно.

Проверка консервативна: она надёжно ловит неподтверждённый текст, но не является полноценной семантической оценкой перефразированных утверждений. Поэтому нулевой hallucination count на synthetic set не доказывает factuality на live-данных.

### Performance и resources

Latency измеряется monotonic clock для каждой попытки; отчёт содержит mean, min/max и nearest-rank p50/p95. Token values и output tokens/sec берутся только из явно переданной provider telemetry — harness их не оценивает по символам. Поэтому fake честно возвращает `tokens.availability = UNAVAILABLE`.

`resources.vramPeakMiB` равен `null`, пока peak VRAM не измерен внешним инструментом. Значение с `MEASURED` можно приложить через `--vram-peak-mib`; нельзя подставлять паспортный объём GPU вместо фактического peak конкретного прогона.

## Проверенная fake baseline

Полный `eval-gold/v1` даёт стабильную функциональную baseline:

- 200 attempted / 200 valid, coverage и validRate `1.0`;
- relevance precision `0.8`, recall `1.0`, потому что fake считает все items relevant;
- event-type accuracy `0`, потому что fake повторяет нейтральный `UNCLASSIFIED`, а labels ему не передаются;
- 360/360 expected facts покрыты полным source text fake-провайдера;
- 200/200 generated facts имеют exact source support, hallucination count `0`;
- token и VRAM telemetry недоступны.

Эти числа проверяют evaluator и отсутствие label leakage. Их нельзя использовать как аргумент выбора модели.

## Правило внешнего сравнения

Для 8B и 14B должны совпадать dataset SHA-256, selected split, prompt version, structured schema version и analysis version. В отчёт добавляются реальные token counts, generation duration и измеренный peak VRAM. Выбор модели опирается одновременно на validity, event/relevance quality, factual errors, latency и capacity; имя или размер модели сами по себе не являются evidence.
