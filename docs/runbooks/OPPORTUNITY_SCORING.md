# Opportunity scoring v2

## Контракт

`opportunity-score-v2` — активная чистая детерминированная политика. Она не вызывает AI, не читает environment и не меняет веса по содержимому сигнала. Глобальный `Signal` не содержит `companyFit` или итоговый Opportunity Score: результат относится к конкретной ревизии `UserProfile` и сохраняется в `Recommendation`. Исходная v1 остаётся доступной только для воспроизведения исторических решений.

Формула:

```text
0.35 * Business Impact
+ 0.25 * Company Fit
+ 0.20 * Urgency
+ 0.10 * Confidence
+ 0.10 * Actionability
```

Каждый фактор лежит в `0..100`. `Analysis.confidence` лежит в `0..1` и преобразуется отдельной функцией умножением на 100. Итог округляется до двух знаков; contributions сохраняют четыре знака до итогового сложения, чтобы округление на границе band не меняло решение.

Bands используют включительную нижнюю границу:

| Band | Диапазон |
| --- | --- |
| `IGNORE` | `< 40` |
| `LOW` | `40..<55` |
| `MEDIUM` | `55..<70` |
| `HIGH` | `70..<85` |
| `CRITICAL` | `85..100` |

## Confidence guardrail v2

Модельная confidence не может быть выше надёжности supporting evidence. Для каждого fact берётся максимальная reliability среди цитируемых им источников, затем минимум по всем facts. Это означает: каждый опубликованный факт должен иметь хотя бы один достаточно надёжный источник.

```text
evidenceReliability = min(max(source reliability for each fact))
effectiveConfidence = min(Analysis.confidence * 100, evidenceReliability)
```

Именно `effectiveConfidence` сохраняется в `Recommendation.scoreBreakdown.confidence` и участвует в пятифакторной формуле. После вычисления raw weighted score применяется верхняя граница приоритета:

| Effective confidence | Максимальный total | Максимальный band |
| ---: | ---: | --- |
| `< 40` | `54` | `LOW` |
| `40..<60` | `69` | `MEDIUM` |
| `60..<80` | `84` | `HIGH` |
| `80..100` | `100` | `CRITICAL` |

Explanation сохраняет исходную model confidence, evidence reliability, effective confidence, raw weighted score и применённый cap. Весовая формула и исходные band thresholds не менялись; guardrail является отдельным versioned правилом v2.

## Company Fit v1

| Критерий | Вес | Match | Mismatch | Unknown |
| --- | ---: | ---: | ---: | ---: |
| Vertical | 30% | 100 | 0 | не применяется |
| Region | 25% | 100 | 0 | 50 |
| Event type | 20% | 100 | 25 | 50 |
| Offering/keyword/target client | 15% | 100 | 25 | 50 |
| Project value and currency | 10% | 100 | 0 | 50 |

Сравнение регистра и `ё/е` нормализуется. Для offering terms допускается прозрачное substring/prefix-сопоставление; результат содержит matched values и reason code каждого критерия.

`ignoredEventTypes` и `excludedKeywords` — явные отрицательные предпочтения. Их совпадение возвращает `EXCLUDED` без total score и band; такой результат нельзя передать в `createRecommendationFromScoreV2`.

## Проверка

```powershell
pnpm exec vitest run packages/core/test/scoring-v1.test.ts packages/core/test/scoring-v2.test.ts
pnpm typecheck
pnpm lint
```

Тесты фиксируют веса, арифметику, каждую границу band, invalid/NaN inputs, confidence conversion, source/fact reliability, каждый confidence cap, match/mismatch/unknown, разные результаты одного opportunity для двух профилей, exclusions, signal-analysis identity и mapping результата в Recommendation.

## Изменение политики

Текущие weights, thresholds и confidence caps — baseline до следующей pilot/eval calibration. Любое изменение требует измеримого основания, новой версии и сравнения с предыдущей; LLM не может менять их автоматически. Основание перехода v1 → v2 зафиксировано в [ADR-0007](../adr/0007-pilot-derived-confidence-guardrail.md).
