import { describe, expect, it } from "vitest";

import { createLogger, createOperationalTelemetry, InMemoryCounterRegistry } from "../src/index.js";

describe("operational telemetry", () => {
  it("emits correlated structured events and bounded outcome counters", () => {
    const lines: string[] = [];
    const logger = createLogger({
      destination: { write: (message: string) => lines.push(message) },
      level: "info",
      service: "telemetry-test",
    });
    const telemetry = createOperationalTelemetry({ logger });

    telemetry.observe({
      aiProcessingAllowed: true,
      correlationId: "correlation-1",
      name: "raw_item_ingested",
      outcome: "CREATED",
      rawItemId: "raw-item-1",
      sourceId: "source-1",
    });
    telemetry.observe({
      analysisId: "analysis-1",
      correlationId: "correlation-1",
      created: true,
      failureCode: "AI_TIMEOUT",
      model: "model-1",
      name: "ai_analysis_completed",
      provider: "fake",
      providerCalled: true,
      signalId: "signal-1",
      status: "FAILED",
    });
    telemetry.observe({
      correlationId: "correlation-1",
      deliveryId: "delivery-1",
      failureCode: null,
      kind: "OPPORTUNITY",
      name: "delivery_completed",
      opportunities: 1,
      outcome: "SENT",
      reused: false,
    });
    telemetry.observe({
      created: 2,
      existing: 1,
      input: 4,
      name: "pipeline_stage_completed",
      rejected: 1,
      runId: "run-1",
      stage: "INGESTION",
    });
    telemetry.observe({ name: "pipeline_run_completed", runId: "run-1" });
    telemetry.observeJob({
      attempt: 1,
      correlationId: "correlation-1",
      errorCode: null,
      jobId: "job-1",
      jobType: "fetchSources",
      name: "job_completed",
      outcome: "SUCCEEDED",
    });

    expect(telemetry.metricsSnapshot().counters).toEqual(
      expect.arrayContaining([
        {
          labels: { ai_processing: "allowed", outcome: "created" },
          name: "radar_ingestion_items_total",
          value: 1,
        },
        {
          labels: { provider_called: "true", status: "failed" },
          name: "radar_ai_analyses_total",
          value: 1,
        },
        {
          labels: { kind: "opportunity", outcome: "sent", reused: "false" },
          name: "radar_deliveries_total",
          value: 1,
        },
        {
          labels: { outcome: "succeeded" },
          name: "radar_pipeline_runs_total",
          value: 1,
        },
        {
          labels: { job_type: "fetch_sources", outcome: "succeeded" },
          name: "radar_jobs_completed_total",
          value: 1,
        },
      ]),
    );
    const records = lines.map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          correlation_id: "correlation-1",
          event: "raw_item_ingested",
          raw_item_id: "raw-item-1",
          source_id: "source-1",
        }),
        expect.objectContaining({
          correlation_id: "correlation-1",
          error_code: "AI_TIMEOUT",
          event: "ai_analysis_completed",
        }),
      ]),
    );
    for (const sample of telemetry.metricsSnapshot().counters) {
      expect(sample.labels).not.toHaveProperty("correlation_id");
      expect(sample.labels).not.toHaveProperty("source_id");
    }
  });

  it("aggregates deterministic snapshots and rejects invalid counter mutations", () => {
    const metrics = new InMemoryCounterRegistry();
    metrics.increment("radar_runs_total", { outcome: "SUCCEEDED" });
    metrics.increment("radar_runs_total", { outcome: "SUCCEEDED" }, 2);

    expect(metrics.snapshot()).toEqual({
      counters: [{ labels: { outcome: "succeeded" }, name: "radar_runs_total", value: 3 }],
      version: "radar_metrics/v1",
    });
    expect(() => metrics.increment("bad.metric")).toThrow("snake_case");
    expect(() => metrics.increment("radar_runs_total", {}, -1)).toThrow("non-negative");
  });
});
