import { FakeAIProvider } from "@radar/ai-adapters";
import { AIBenchmarkReportV1Schema } from "@radar/contracts";
import { describe, expect, it } from "vitest";

import {
  createEvalBenchmarkRequest,
  loadEvalGoldDataset,
  runAIBenchmark,
  type AIBenchmarkExecutor,
} from "../src/index.js";

const evalDatasetPath = new URL("../../../fixtures/evals/v1/dataset.json", import.meta.url);
const startedAt = new Date("2026-09-10T10:00:00.000Z");
const completedAt = new Date("2026-09-10T10:00:03.000Z");

const testTiming = () => {
  let clockCalls = 0;
  let monotonic = 0;
  return {
    clock: () => {
      clockCalls += 1;
      return clockCalls === 1 ? startedAt : completedAt;
    },
    monotonicNow: () => {
      monotonic += 5;
      return monotonic;
    },
  };
};

describe("AI benchmark v1", () => {
  it("maps eval evidence without leaking expected event or relevance labels", async () => {
    const dataset = await loadEvalGoldDataset(evalDatasetPath);
    const item = dataset.items[0];
    if (item === undefined) {
      throw new Error("Eval fixture must contain an item");
    }

    const request = createEvalBenchmarkRequest(item);

    expect(request.signal).toMatchObject({
      category: "UNCLASSIFIED",
      classificationConfidence: 50,
      relevanceScore: 50,
      vertical: "CONSTRUCTION",
    });
    expect(request.evidence).toHaveLength(1);
    expect(request.evidence[0]).toMatchObject({
      sourceId: item.source.sourceId,
      text: item.source.text,
      title: item.source.title,
    });
  });

  it("reports deterministic fake-provider validity, classification, factuality, and latency", async () => {
    const dataset = await loadEvalGoldDataset(evalDatasetPath);
    const report = await runAIBenchmark({
      dataset,
      provider: new FakeAIProvider(),
      ...testTiming(),
    });

    expect(AIBenchmarkReportV1Schema.safeParse(report).success).toBe(true);
    expect(report.run).toEqual({
      analysisVersion: "benchmark-analysis/v1",
      datasetId: "construction-opportunity-radar-eval-gold-v1",
      datasetSchemaVersion: "eval-gold/v1",
      datasetSha256: "5457ac44d5fc1fff1b216d9aa0fb6a1a168e913b195811e5b633fc2d8238357a",
      items: 200,
      model: "fixture-analysis-v1",
      promptVersion: "benchmark-prompt/v1",
      provider: "fake",
      selectedSplit: "ALL",
      structuredAnalysisSchemaVersion: "ai-analysis/v1",
    });
    expect(report.validity).toEqual({
      attempted: 200,
      coverage: 1,
      invalidResponses: 0,
      providerFailures: 0,
      succeeded: 200,
      validRate: 1,
    });
    expect(report.classification).toEqual({
      eventType: { accuracy: 0, correct: 0, evaluated: 200, unscored: 0 },
      relevance: {
        accuracy: 0.8,
        evaluated: 200,
        f1: 0.888889,
        falseNegative: 0,
        falsePositive: 40,
        precision: 0.8,
        recall: 1,
        trueNegative: 0,
        truePositive: 160,
        unscored: 0,
      },
    });
    expect(report.factuality).toEqual({
      evaluatedExpectedFacts: 360,
      expectedFactRecall: 1,
      expectedFacts: 360,
      generatedFactSupportRate: 1,
      generatedFacts: 200,
      hallucinationCount: 0,
      matchedExpectedFacts: 360,
      supportedGeneratedFacts: 200,
      unsupportedGeneratedFacts: 0,
    });
    expect(report.resources).toEqual({
      vramAvailability: "UNAVAILABLE",
      vramPeakMiB: null,
    });
    expect(report.latencyMs).toEqual({
      maximum: 5,
      mean: 5,
      minimum: 5,
      p50: 5,
      p95: 5,
      samples: 200,
    });
    expect(report.tokens).toEqual({
      availability: "UNAVAILABLE",
      generationDurationMs: null,
      inputTokens: null,
      outputTokens: null,
      outputTokensPerSecond: null,
      samplesWithUsage: 0,
      totalTokens: null,
    });
    expect(report.failures).toEqual([]);

    const inconsistentReport = structuredClone(report);
    inconsistentReport.factuality.hallucinationCount = 1;
    expect(AIBenchmarkReportV1Schema.safeParse(inconsistentReport).success).toBe(false);
  });

  it("separates invalid structured responses from provider failures", async () => {
    const dataset = await loadEvalGoldDataset(evalDatasetPath);
    const invalidReport = await runAIBenchmark({
      dataset,
      provider: new FakeAIProvider({ behavior: { mode: "INVALID_RESPONSE" } }),
      selectedSplit: "CALIBRATION",
      ...testTiming(),
    });
    const timeoutReport = await runAIBenchmark({
      dataset,
      provider: new FakeAIProvider({
        behavior: { code: "AI_TIMEOUT", mode: "THROW", retryable: true },
      }),
      selectedSplit: "CALIBRATION",
      ...testTiming(),
    });

    expect(invalidReport.validity).toEqual({
      attempted: 80,
      coverage: 0,
      invalidResponses: 80,
      providerFailures: 0,
      succeeded: 0,
      validRate: 0,
    });
    expect(invalidReport.failures[0]).toEqual({
      code: "AI_INVALID_RESPONSE",
      itemId: "eval-construction-001",
      kind: "FAILED_ANALYSIS",
      retryable: false,
    });
    expect(timeoutReport.validity).toEqual({
      attempted: 80,
      coverage: 0,
      invalidResponses: 0,
      providerFailures: 80,
      succeeded: 0,
      validRate: null,
    });
    expect(timeoutReport.failures[0]).toEqual({
      code: "AI_TIMEOUT",
      itemId: "eval-construction-001",
      kind: "THROWN",
      retryable: true,
    });
  });

  it("aggregates optional provider token telemetry without estimating missing tokens", async () => {
    const dataset = await loadEvalGoldDataset(evalDatasetPath);
    const executor: AIBenchmarkExecutor = async (provider, request) => ({
      analysis: await provider.analyzeSignal(request),
      tokenUsage: { generationDurationMs: 2, inputTokens: 10, outputTokens: 5 },
    });

    const report = await runAIBenchmark({
      dataset,
      executor,
      provider: new FakeAIProvider(),
      selectedSplit: "CALIBRATION",
      vramPeakMiB: 8_192.5,
      ...testTiming(),
    });

    expect(report.tokens).toEqual({
      availability: "COMPLETE",
      generationDurationMs: 160,
      inputTokens: 800,
      outputTokens: 400,
      outputTokensPerSecond: 2_500,
      samplesWithUsage: 80,
      totalTokens: 1_200,
    });
    expect(report.resources).toEqual({
      vramAvailability: "MEASURED",
      vramPeakMiB: 8_192.5,
    });
  });
});
