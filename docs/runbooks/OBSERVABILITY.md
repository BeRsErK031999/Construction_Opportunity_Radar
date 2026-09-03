# Operational telemetry

## Что реализовано

`@radar/application` публикует typed outcomes через необязательный `OperationalObserver`. `@radar/jobs` использует отдельный typed job observer. `@radar/observability` реализует оба порта: пишет JSON-события и увеличивает in-memory counters. Observer fail-open и не меняет идемпотентность, persistence или retry outcome.

Каждый snapshot имеет версию `radar_metrics/v1` и отсортированный массив counters. Значения накопительные от старта процесса. Snapshot не является operational storage: после рестарта он начинается заново, а durable business/job state восстанавливается из PostgreSQL.

## Счётчики

| Counter | Labels | Смысл |
| --- | --- | --- |
| `radar_ingestion_items_total` | `ai_processing`, `outcome` | созданные и найденные raw items |
| `radar_ingestion_runs_total` | `outcome` | завершённые/неуспешные source runs |
| `radar_ai_analyses_total` | `provider_called`, `status` | сохранённые или переиспользованные AI outcomes |
| `radar_deliveries_total` | `kind`, `outcome`, `reused` | digest/opportunity state и признак idempotent replay |
| `radar_pipeline_stage_runs_total` | `stage`, `outcome` | завершения стадий pipeline |
| `radar_pipeline_stage_items_total` | `stage`, `measure` | input/created/existing/rejected по стадиям; measures могут пересекаться |
| `radar_pipeline_runs_total` | `outcome` | полные pipeline runs |
| `radar_jobs_started_total` | `job_type` | захваченные jobs |
| `radar_jobs_completed_total` | `job_type`, `outcome` | success/retry/terminal job outcomes |
| `radar_stale_jobs_recovered_total` | `outcome` | requeued/failed stale jobs |
| `radar_jobs_scheduled_total` | `outcome` | created/overlap-blocked schedule outcomes |

Labels имеют ограниченный словарь. ID, URL, model/provider, source name и error text остаются вне labels, чтобы не создавать неограниченную cardinality.

## Локальная проверка

После запуска PostgreSQL и migrations:

```powershell
pnpm process:fixtures 1> pipeline-result.json 2> pipeline-events.jsonl
Get-Content pipeline-result.json | ConvertFrom-Json | Select-Object -ExpandProperty metrics
Get-Content pipeline-events.jsonl | ForEach-Object { $_ | ConvertFrom-Json } | Group-Object event
```

Повторный запуск должен дать ingestion/analysis outcomes `existing`/`provider_called=false`, не создавая новые доменные строки. Bot и worker пишут `operational_metrics_snapshot` при штатной остановке. Для диагностики одного сигнала фильтруйте JSONL по `correlation_id`; source summary — по `source_id`, batch summary — по `run_id`.

## Ограничения и следующий шаг

ART-021 не добавляет network endpoint, Grafana или внешний backend. До production deployment нужно выбрать exporter, retention, alert thresholds и доступ к логам. Эти решения не блокируют ART-022 security hardening.
