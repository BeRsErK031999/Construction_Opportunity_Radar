import {
  AIProviderError,
  executeAIAnalysis,
  type AIAnalysisRequest,
  type AIProvider,
  type AnalysisIdentity,
  type AnalysisRepository,
  type OperationalEvent,
} from "../src/index.js";
import {
  analysisId,
  correlationId,
  createFailedAnalysis,
  isoDateTime,
  score,
  signalId,
  version,
  type Analysis,
} from "@radar/core";
import { describe, expect, it, vi } from "vitest";

const timestamp = "2026-09-10T00:00:00.000Z";
const modelInfo = Object.freeze({
  capabilities: Object.freeze(["STRUCTURED_ANALYSIS"] as const),
  maxInputCharacters: 1_000,
  model: "fixture-analysis-v1",
  provider: "fake",
});
const request: AIAnalysisRequest = Object.freeze({
  analysisId: analysisId("analysis-1"),
  analysisVersion: version("analysis-v1", "analysisVersion"),
  createdAt: isoDateTime(timestamp, "createdAt"),
  evidence: Object.freeze([]),
  promptVersion: version("prompt-v1", "promptVersion"),
  schemaVersion: version("ai-analysis/v1", "schemaVersion"),
  signal: Object.freeze({
    category: "CONSTRUCTION_TENDER",
    classificationConfidence: score(90, "classificationConfidence"),
    correlationId: correlationId("correlation-1"),
    id: signalId("signal-1"),
    normalizedItemIds: Object.freeze([]),
    relevanceScore: score(80, "relevanceScore"),
    sourceIds: Object.freeze([]),
    vertical: "CONSTRUCTION",
  }),
});

class InMemoryAnalysisRepository implements AnalysisRepository {
  analysis: Analysis | null = null;

  count(): Promise<number> {
    return Promise.resolve(this.analysis === null ? 0 : 1);
  }

  findByIdentity(identity: AnalysisIdentity): Promise<Analysis | null> {
    void identity;
    return Promise.resolve(this.analysis);
  }

  save(analysis: Analysis): Promise<{ readonly analysis: Analysis; readonly created: boolean }> {
    const created = this.analysis === null;
    this.analysis ??= analysis;
    return Promise.resolve(Object.freeze({ analysis: this.analysis, created }));
  }
}

describe("executeAIAnalysis", () => {
  it("persists a safe provider failure and skips the provider on an idempotent repeat", async () => {
    const analyzeSignal = vi.fn<AIProvider["analyzeSignal"]>(() =>
      Promise.reject(new AIProviderError("AI_TIMEOUT", true)),
    );
    const provider: AIProvider = {
      analyzeSignal,
      healthCheck: () =>
        Promise.resolve({
          failureCode: null,
          model: "fixture-analysis-v1",
          provider: "fake",
          retryable: false,
          status: "HEALTHY",
        }),
      modelInfo: () => Promise.resolve(modelInfo),
    };
    const repository = new InMemoryAnalysisRepository();
    const events: OperationalEvent[] = [];
    const observer = { observe: (event: OperationalEvent) => events.push(event) };

    const first = await executeAIAnalysis({ modelInfo, observer, provider, repository, request });
    const second = await executeAIAnalysis({ modelInfo, observer, provider, repository, request });

    expect(first).toMatchObject({
      analysis: { failureCode: "AI_TIMEOUT", retryable: true, status: "FAILED" },
      created: true,
      providerCalled: true,
    });
    expect(second).toMatchObject({ created: false, providerCalled: false });
    expect(analyzeSignal).toHaveBeenCalledTimes(1);
    expect(await repository.count()).toBe(1);
    expect(events).toEqual([
      expect.objectContaining({
        correlationId: "correlation-1",
        failureCode: "AI_TIMEOUT",
        name: "ai_analysis_completed",
        providerCalled: true,
        status: "FAILED",
      }),
      expect.objectContaining({
        name: "ai_analysis_completed",
        providerCalled: false,
        status: "FAILED",
      }),
    ]);
  });

  it("turns provider identity drift into a trusted invalid-response failure", async () => {
    const provider: AIProvider = {
      analyzeSignal: () =>
        Promise.resolve(
          createFailedAnalysis({
            analysisVersion: request.analysisVersion,
            correlationId: request.signal.correlationId,
            createdAt: request.createdAt,
            failureCode: "AI_TIMEOUT",
            failureReason: "Untrusted provider-controlled failure",
            id: analysisId("wrong-analysis-id"),
            model: modelInfo.model,
            promptVersion: request.promptVersion,
            provider: modelInfo.provider,
            retryable: true,
            schemaVersion: request.schemaVersion,
            signalId: request.signal.id,
          }),
        ),
      healthCheck: () =>
        Promise.resolve({
          failureCode: null,
          model: modelInfo.model,
          provider: modelInfo.provider,
          retryable: false,
          status: "HEALTHY",
        }),
      modelInfo: () => Promise.resolve(modelInfo),
    };

    const result = await executeAIAnalysis({
      modelInfo,
      provider,
      repository: new InMemoryAnalysisRepository(),
      request,
    });

    expect(result.analysis).toMatchObject({
      failureCode: "AI_INVALID_RESPONSE",
      id: "analysis-1",
      retryable: false,
      status: "FAILED",
    });
    expect(result.analysis).not.toHaveProperty(
      "failureReason",
      "Untrusted provider-controlled failure",
    );
  });
});
