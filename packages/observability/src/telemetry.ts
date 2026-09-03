import type { OperationalEvent, OperationalObserver } from "@radar/application";
import type { JobRuntimeEvent, JobRuntimeObserver } from "@radar/jobs";

import type { AppLogger } from "./logger.js";

export interface CounterSample {
  readonly labels: Readonly<Record<string, string>>;
  readonly name: string;
  readonly value: number;
}

export interface MetricsSnapshot {
  readonly counters: readonly CounterSample[];
  readonly version: "radar_metrics/v1";
}

export interface CounterRegistry {
  increment(name: string, labels?: Readonly<Record<string, string>>, value?: number): void;
  snapshot(): MetricsSnapshot;
}

const normalizedLabels = (
  labels: Readonly<Record<string, string>>,
): Readonly<Record<string, string>> =>
  Object.freeze(
    Object.fromEntries(
      Object.entries(labels)
        .map(
          ([key, value]) =>
            [key, value.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase()] as const,
        )
        .sort(([left], [right]) => left.localeCompare(right)),
    ),
  );

export class InMemoryCounterRegistry implements CounterRegistry {
  readonly #samples = new Map<string, CounterSample>();

  increment(name: string, labels: Readonly<Record<string, string>> = {}, value = 1): void {
    if (!/^[a-z][a-z0-9_]*$/.test(name)) {
      throw new RangeError("Metric name must use snake_case");
    }
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new RangeError("Counter increment must be a non-negative safe integer");
    }
    const stableLabels = normalizedLabels(labels);
    const key = JSON.stringify([name, stableLabels]);
    const current = this.#samples.get(key);
    this.#samples.set(
      key,
      Object.freeze({
        labels: stableLabels,
        name,
        value: (current?.value ?? 0) + value,
      }),
    );
  }

  snapshot(): MetricsSnapshot {
    return Object.freeze({
      counters: Object.freeze(
        [...this.#samples.values()].sort((left, right) => {
          const byName = left.name.localeCompare(right.name);
          return byName === 0
            ? JSON.stringify(left.labels).localeCompare(JSON.stringify(right.labels))
            : byName;
        }),
      ),
      version: "radar_metrics/v1",
    });
  }
}

export interface OperationalTelemetry extends OperationalObserver, JobRuntimeObserver {
  metricsSnapshot(): MetricsSnapshot;
}

export interface CreateOperationalTelemetryOptions {
  readonly logger: AppLogger;
  readonly metrics?: CounterRegistry;
}

const incrementIfPositive = (
  metrics: CounterRegistry,
  name: string,
  labels: Readonly<Record<string, string>>,
  value: number,
): void => {
  if (value > 0) {
    metrics.increment(name, labels, value);
  }
};

export const createOperationalTelemetry = (
  options: CreateOperationalTelemetryOptions,
): OperationalTelemetry => {
  const metrics = options.metrics ?? new InMemoryCounterRegistry();

  return Object.freeze({
    metricsSnapshot: () => metrics.snapshot(),
    observe(event: OperationalEvent): void {
      switch (event.name) {
        case "raw_item_ingested":
          metrics.increment("radar_ingestion_items_total", {
            ai_processing: event.aiProcessingAllowed ? "allowed" : "denied",
            outcome: event.outcome,
          });
          options.logger.info(
            {
              ai_processing_allowed: event.aiProcessingAllowed,
              correlation_id: event.correlationId,
              event: event.name,
              outcome: event.outcome,
              raw_item_id: event.rawItemId,
              source_id: event.sourceId,
            },
            "Raw item ingestion completed",
          );
          return;
        case "source_ingestion_completed":
          metrics.increment("radar_ingestion_runs_total", { outcome: "succeeded" });
          options.logger.info(
            {
              adapter: event.adapter,
              candidates: event.candidates,
              created: event.created,
              event: event.name,
              existing: event.existing,
              fetches: event.fetches,
              source_id: event.sourceId,
            },
            "Source ingestion completed",
          );
          return;
        case "source_ingestion_failed":
          metrics.increment("radar_ingestion_runs_total", { outcome: "failed" });
          options.logger.warn(
            {
              adapter: event.adapter,
              error_code: event.errorCode,
              event: event.name,
              source_id: event.sourceId,
            },
            "Source ingestion failed",
          );
          return;
        case "ai_analysis_completed":
          metrics.increment("radar_ai_analyses_total", {
            provider_called: event.providerCalled ? "true" : "false",
            status: event.status,
          });
          (event.status === "FAILED" ? options.logger.warn : options.logger.info).call(
            options.logger,
            {
              analysis_id: event.analysisId,
              correlation_id: event.correlationId,
              created: event.created,
              error_code: event.failureCode,
              event: event.name,
              model: event.model,
              provider: event.provider,
              provider_called: event.providerCalled,
              signal_id: event.signalId,
              status: event.status,
            },
            "AI analysis completed",
          );
          return;
        case "delivery_completed":
          metrics.increment("radar_deliveries_total", {
            kind: event.kind,
            outcome: event.outcome,
            reused: event.reused ? "true" : "false",
          });
          (event.outcome === "FAILED" ? options.logger.warn : options.logger.info).call(
            options.logger,
            {
              correlation_id: event.correlationId,
              delivery_id: event.deliveryId,
              error_code: event.failureCode,
              event: event.name,
              kind: event.kind,
              opportunities: event.opportunities,
              outcome: event.outcome,
              reused: event.reused,
            },
            "Telegram delivery completed",
          );
          return;
        case "pipeline_stage_completed":
          metrics.increment("radar_pipeline_stage_runs_total", {
            outcome: "succeeded",
            stage: event.stage,
          });
          for (const [outcome, value] of [
            ["input", event.input],
            ["created", event.created],
            ["existing", event.existing],
            ["rejected", event.rejected],
          ] as const) {
            incrementIfPositive(
              metrics,
              "radar_pipeline_stage_items_total",
              { measure: outcome, stage: event.stage },
              value,
            );
          }
          options.logger.info(
            {
              created: event.created,
              event: event.name,
              existing: event.existing,
              input: event.input,
              rejected: event.rejected,
              run_id: event.runId,
              stage: event.stage,
            },
            "Pipeline stage completed",
          );
          return;
        case "pipeline_run_completed":
          metrics.increment("radar_pipeline_runs_total", { outcome: "succeeded" });
          options.logger.info({ event: event.name, run_id: event.runId }, "Pipeline run completed");
          return;
        case "pipeline_run_failed":
          metrics.increment("radar_pipeline_runs_total", { outcome: "failed" });
          options.logger.warn(
            { error_code: event.errorCode, event: event.name, run_id: event.runId },
            "Pipeline run failed",
          );
      }
    },
    observeJob(event: JobRuntimeEvent): void {
      switch (event.name) {
        case "job_started":
          metrics.increment("radar_jobs_started_total", { job_type: event.jobType });
          return;
        case "job_completed":
          metrics.increment("radar_jobs_completed_total", {
            job_type: event.jobType,
            outcome: event.outcome,
          });
          return;
        case "stale_jobs_recovered":
          incrementIfPositive(
            metrics,
            "radar_stale_jobs_recovered_total",
            { outcome: "requeued" },
            event.requeued,
          );
          incrementIfPositive(
            metrics,
            "radar_stale_jobs_recovered_total",
            { outcome: "failed" },
            event.failed,
          );
          return;
        case "job_schedules_evaluated":
          incrementIfPositive(
            metrics,
            "radar_jobs_scheduled_total",
            { outcome: "created" },
            event.created,
          );
          incrementIfPositive(
            metrics,
            "radar_jobs_scheduled_total",
            { outcome: "overlap_blocked" },
            event.overlapBlocked,
          );
      }
    },
  });
};
