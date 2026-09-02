# Fixture classification

## Назначение

`classifier-v1` — дешёвый детерминированный фильтр между `deduplicator-v1` и будущим `AIProvider`. Он не использует fixture labels и не вызывает AI. Вертикали и категории зафиксированы в `signal-taxonomy-v1`; изменение словарей, весов или исходов требует новой версии classifier/taxonomy.

## Порядок решения

1. Входом является один dedup-кластер, а не отдельный материал.
2. Из evidence выбираются только источники, для которых одновременно разрешены статус прав, `ai_processing_allowed` и operational state.
3. Если dedup representative разрешён, правила читают его; иначе выбирается самый ранний разрешённый member. При отсутствии разрешённого member возвращается `PERMISSION_DENIED` без AI input.
4. Source hint и текстовые словари дают детерминированные Construction/HoReCa scores. Равенство или отсутствие поддерживаемой вертикали дают `OTHER`.
5. Реклама, явно отрицательное сообщение, `OTHER` и материал без opportunity cue получают `IRRELEVANT` с reason/rule IDs.
6. Только `AI_ELIGIBLE` создаёт `CANDIDATE` signal. В signal сохраняются версии dedup/classifier/taxonomy, представитель кластера, rule IDs и только permitted provenance links.

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

- Это baseline для recall/precision измерений, а не обещание продуктового качества; gold-set и benchmark относятся к ART-019/020.
- Rule score определяет pre-AI relevance и не является персональным Opportunity Score из ART-010.
- Запрещённые evidence links не передаются AI. Перевод источника в разрешённое состояние требует нового versioned classification run, а не скрытого изменения старого signal.
- Gate G2 этим прогоном не закрыт: остаются AI contract/provider, полный orchestrator, durable jobs и restart evidence.
