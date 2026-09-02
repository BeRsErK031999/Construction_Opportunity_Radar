import { createHash } from "node:crypto";

import { createAIAnalysisRequest } from "@radar/application";
import { AI_ANALYSIS_SCHEMA_VERSION_V1 } from "@radar/contracts";
import {
  analysisId,
  correlationId,
  createNormalizedItem,
  createSignal,
  createSource,
  normalizedItemId,
  rawItemId,
  signalId,
  sourceId,
} from "@radar/core";
import { describe, expect, it } from "vitest";

import { FakeAIProvider } from "../src/index.js";

const timestamp = "2026-09-02T09:30:00Z";

const request = () => {
  const text = "Опубликован тендер на строительство гостиницы в Барнауле.";
  const item = createNormalizedItem({
    canonicalUrl: "https://fixtures.radar.local/items/hotel-tender",
    correlationId: correlationId("correlation-fake-provider"),
    createdAt: timestamp,
    entities: [
      { kind: "region", value: "Барнаул" },
      { kind: "object", value: "Гостиница" },
    ],
    id: normalizedItemId("normalized-hotel-tender"),
    language: "ru",
    normalizedHash: createHash("sha256").update(text).digest("hex"),
    normalizerVersion: "normalizer-v1",
    publishedAt: timestamp,
    rawItemId: rawItemId("raw-hotel-tender"),
    text,
    title: "Тендер на строительство гостиницы",
  });
  const source = createSource({
    aiProcessingAllowed: true,
    collectionPolicy: { parserKind: "FIXTURE_JSON" },
    country: "RU",
    createdAt: timestamp,
    enabled: true,
    id: sourceId("source-hotel-tender"),
    name: "Fixture Hotel Tender",
    regions: ["Алтайский край"],
    reliabilityScore: 90,
    rightsBasis: "Синтетический тестовый материал",
    rightsStatus: "CONSENT",
    type: "FIXTURE",
    updatedAt: timestamp,
    url: "https://fixtures.radar.local/sources/hotel-tender",
    verticals: ["CONSTRUCTION", "HORECA"],
  });
  const signal = createSignal({
    category: "TENDER",
    classificationConfidence: 90,
    classificationRuleIds: ["construction.tender"],
    classifierVersion: "classifier-v1",
    correlationId: correlationId("correlation-fake-provider"),
    createdAt: timestamp,
    deduplicationRepresentativeNormalizedItemId: item.id,
    deduplicatorVersion: "deduplicator-v1",
    id: signalId("signal-hotel-tender"),
    normalizedItemIds: [item.id],
    relevanceScore: 80,
    sourceIds: [source.id],
    status: "CANDIDATE",
    taxonomyVersion: "signal-taxonomy-v1",
    updatedAt: timestamp,
    vertical: "CONSTRUCTION",
  });

  return createAIAnalysisRequest({
    analysisId: analysisId("analysis-hotel-tender"),
    analysisVersion: "analysis-v1",
    createdAt: timestamp,
    evidence: [{ normalizedItem: item, source }],
    promptVersion: "prompt-v1",
    schemaVersion: AI_ANALYSIS_SCHEMA_VERSION_V1,
    signal,
  });
};

describe("FakeAIProvider", () => {
  it("returns the same valid source-backed analysis for the same request", async () => {
    const provider = new FakeAIProvider();

    const first = await provider.analyzeSignal(request());
    const second = await provider.analyzeSignal(request());

    expect(second).toEqual(first);
    expect(first).toMatchObject({
      actionability: 75,
      analysisVersion: "analysis-v1",
      businessImpact: 85,
      confidence: 0.9,
      eventType: "TENDER",
      model: "fixture-analysis-v1",
      promptVersion: "prompt-v1",
      provider: "fake",
      schemaVersion: AI_ANALYSIS_SCHEMA_VERSION_V1,
      signalId: "signal-hotel-tender",
      sourceIds: ["source-hotel-tender"],
      status: "SUCCEEDED",
      urgency: 90,
    });
    if (first.status !== "SUCCEEDED") {
      throw new Error("Expected a successful fake analysis");
    }
    expect(first.facts).toHaveLength(1);
    expect(first.facts[0]).toMatchObject({
      sourceIds: ["source-hotel-tender"],
      statement: "Опубликован тендер на строительство гостиницы в Барнауле.",
    });
    expect(first.inferences[0]?.basisFactIds).toEqual([first.facts[0]?.id]);
    expect(first.candidateActions.map(({ kind }) => kind)).toEqual(["VERIFY", "REVIEW"]);
  });

  it("reports provider-independent model capabilities and health", async () => {
    const provider = new FakeAIProvider({
      maxInputCharacters: 12_345,
      model: "custom-fixture-v2",
      provider: "test-double",
    });

    await expect(provider.modelInfo()).resolves.toEqual({
      capabilities: ["STRUCTURED_ANALYSIS"],
      maxInputCharacters: 12_345,
      model: "custom-fixture-v2",
      provider: "test-double",
    });
    await expect(provider.healthCheck()).resolves.toEqual({
      failureCode: null,
      model: "custom-fixture-v2",
      provider: "test-double",
      retryable: false,
      status: "HEALTHY",
    });
  });

  it("returns a typed failed analysis when configured", async () => {
    const provider = new FakeAIProvider({
      behavior: { code: "AI_INVALID_RESPONSE", mode: "FAILED_ANALYSIS", retryable: false },
    });

    await expect(provider.analyzeSignal(request())).resolves.toMatchObject({
      failureCode: "AI_INVALID_RESPONSE",
      failureReason: "Fake provider was configured to return a failed analysis",
      retryable: false,
      status: "FAILED",
    });
  });

  it("turns an invalid generated response into a failed analysis", async () => {
    const provider = new FakeAIProvider({ behavior: { mode: "INVALID_RESPONSE" } });

    await expect(provider.analyzeSignal(request())).resolves.toMatchObject({
      failureCode: "AI_INVALID_RESPONSE",
      failureReason: "AI response failed ai-analysis/v1 schema validation",
      retryable: false,
      status: "FAILED",
    });
  });

  it("throws a safe typed provider error when configured", async () => {
    const provider = new FakeAIProvider({
      behavior: { code: "AI_TIMEOUT", mode: "THROW", retryable: true },
    });

    await expect(provider.analyzeSignal(request())).rejects.toMatchObject({
      code: "AI_TIMEOUT",
      message: "AI provider request timed out",
      name: "AIProviderError",
      retryable: true,
    });
    await expect(provider.analyzeSignal(request())).rejects.not.toThrow("Опубликован тендер");
  });

  it("reports unhealthy state and enforces the advertised input bound", async () => {
    const provider = new FakeAIProvider({
      healthStatus: "UNHEALTHY",
      maxInputCharacters: 10,
    });

    await expect(provider.healthCheck()).resolves.toEqual({
      failureCode: "AI_UNAVAILABLE",
      model: "fixture-analysis-v1",
      provider: "fake",
      retryable: true,
      status: "UNHEALTHY",
    });
    await expect(provider.analyzeSignal(request())).rejects.toMatchObject({
      code: "AI_INPUT_TOO_LARGE",
      retryable: false,
    });
  });
});
