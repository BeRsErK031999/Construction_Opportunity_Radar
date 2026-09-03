# Offline CLI: события

`process:fixtures` пишет machine-readable итог и `radar_metrics/v1` в stdout, а structured events — в stderr. Это сохраняет возможность перенаправить JSON-результат в файл без смешения с логами.

| Event | Level | Ключевые поля | Условие |
| --- | --- | --- | --- |
| `raw_item_ingested` | INFO | `correlation_id`, `source_id`, `raw_item_id`, `outcome`, `ai_processing_allowed` | raw item создан или найден |
| `source_ingestion_completed` | INFO | `source_id`, `adapter`, counts | источник обработан |
| `source_ingestion_failed` | WARNING | `source_id`, `adapter`, `error_code` | ingestion отклонён или упал |
| `ai_analysis_completed` | INFO/WARNING | `correlation_id`, `signal_id`, `analysis_id`, `provider`, `model`, `status`, `error_code` | analysis сохранён или переиспользован |
| `pipeline_stage_completed` | INFO | `run_id`, `stage`, `input`, `created`, `existing`, `rejected` | одна стадия сведена в summary |
| `pipeline_run_completed` | INFO | `run_id` | все стадии и scoring завершены |
| `pipeline_run_failed` | WARNING | `run_id`, `error_code` | выполнение прервано; terminal error пишет process/job boundary |
| `offline_pipeline_failed` | ERROR | `err` | unexpected error достиг process boundary |

## Открытые вопросы

- Нужен ли отдельный run ID вместо стабильного fixture namespace для не-fixture batch запусков.
