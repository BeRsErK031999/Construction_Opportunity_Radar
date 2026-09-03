# Fixture classification

## Назначение

`classifier-v2` — активный дешёвый детерминированный фильтр между `deduplicator-v1` и `AIProvider`. Он не использует fixture labels и не вызывает AI. V2 сохраняет поведение v1 и добавляет распознавание русских форм завершённого строительства (`построен*`, `возведён*`, `введён*`, `сдан*`) с отдельными rule IDs. `classifier-v1` остаётся неизменным для исторической воспроизводимости. Категории не менялись, поэтому используется `signal-taxonomy-v1`.

## Порядок решения

1. Входом является один dedup-кластер, а не отдельный материал.
2. Из evidence выбираются только источники, для которых одновременно разрешены статус прав, `ai_processing_allowed` и operational state.
3. Если dedup representative разрешён, правила читают его; иначе выбирается самый ранний разрешённый member. При отсутствии разрешённого member возвращается `PERMISSION_DENIED` без AI input.
4. Source hint и текстовые словари дают детерминированные Construction/HoReCa scores. Равенство или отсутствие поддерживаемой вертикали дают `OTHER`.
5. Реклама, явно отрицательное сообщение, `OTHER` и материал без opportunity cue получают `IRRELEVANT` с reason/rule IDs.
6. Только `AI_ELIGIBLE` создаёт `CANDIDATE` signal. В signal сохраняются версии dedup/classifier/taxonomy, представитель кластера, rule IDs и только permitted provenance links.
7. Текущие API/bot read models выбирают только активную пару `classifier-v2` + `opportunity-score-v2`, поэтому исторические v1-рекомендации не смешиваются с текущим ranking.

Этот порядок не меняет raw/normalized evidence. Полный состав кластера остаётся в `deduplication_assignments`, даже если отдельный member не разрешён для AI.

## Локальный прогон

```powershell
pnpm db:up
pnpm db:migrate:deploy
pnpm fixtures:ingest
pnpm fixtures:normalize
pnpm fixtures:deduplicate
pnpm fixtures:classify
pnpm fixtures:classify
```

Ожидаемый первый итог для `fixture-ingestion/v1`:

```json
{"inputClusters":150,"aiEligible":110,"irrelevant":28,"permissionDenied":12,"created":110,"existing":0,"signals":110}
```

Повтор сохраняет те же decision counts и возвращает `created: 0`, `existing: 110`, `signals: 110`.

## Ограничения

- Это baseline для recall/precision измерений, а не обещание продуктового качества; manual/live review продолжает быть обязательным для Gate G3.
- Rule score определяет pre-AI relevance и не является персональным Opportunity Score из ART-010.
- Запрещённые evidence links не передаются AI. Перевод источника в разрешённое состояние требует нового versioned classification run, а не скрытого изменения старого signal.
- Сам fixture-прогон не закрывает Gate G2: для gate по-прежнему нужны измеренные live uptime, JSON success, duplicate rate и restart/recovery evidence.
- Переход v1 → v2 и pilot evidence описаны в [ADR-0007](../adr/0007-pilot-derived-confidence-guardrail.md).
