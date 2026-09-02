import { createHash } from "node:crypto";

import { createAIAnalysisRequest, type AIAnalysisRequest } from "@radar/application";
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

import { analysisFromAIResponseV1 } from "../src/index.js";

const timestamp = "2026-09-02T10:30:00Z";

const request = (): AIAnalysisRequest => {
  const text = "Опубликован тендер на строительство гостиницы в Барнауле.";
  const item = createNormalizedItem({
    canonicalUrl: "https://fixtures.radar.local/items/contract-tender",
    correlationId: correlationId("correlation-response-contract"),
    createdAt: timestamp,
    id: normalizedItemId("normalized-response-contract"),
    language: "ru",
    normalizedHash: createHash("sha256").update(text).digest("hex"),
    normalizerVersion: "normalizer-v1",
    publishedAt: timestamp,
    rawItemId: rawItemId("raw-response-contract"),
    text,
    title: "Тендер на гостиницу",
  });
  const source = createSource({
    aiProcessingAllowed: true,
    collectionPolicy: { parserKind: "FIXTURE_JSON" },
    country: "RU",
    createdAt: timestamp,
    enabled: true,
    id: sourceId("source-response-contract"),
    name: "Contract fixture source",
    regions: ["Алтайский край"],
    reliabilityScore: 90,
    rightsBasis: "Синтетический тестовый материал",
    rightsStatus: "CONSENT",
    type: "FIXTURE",
    updatedAt: timestamp,
    url: "https://fixtures.radar.local/sources/contract",
    verticals: ["CONSTRUCTION"],
  });
  const signal = createSignal({
    category: "TENDER",
    classificationConfidence: 90,
    classificationRuleIds: ["construction.tender"],
    classifierVersion: "classifier-v1",
    correlationId: correlationId("correlation-response-contract"),
    createdAt: timestamp,
    deduplicationRepresentativeNormalizedItemId: item.id,
    deduplicatorVersion: "deduplicator-v1",
    id: signalId("signal-response-contract"),
    normalizedItemIds: [item.id],
    relevanceScore: 80,
    sourceIds: [source.id],
    status: "CANDIDATE",
    taxonomyVersion: "signal-taxonomy-v1",
    updatedAt: timestamp,
    vertical: "CONSTRUCTION",
  });

  return createAIAnalysisRequest({
    analysisId: analysisId("analysis-response-contract"),
    analysisVersion: "analysis-v1",
    createdAt: timestamp,
    evidence: [{ normalizedItem: item, source }],
    promptVersion: "prompt-v1",
    schemaVersion: AI_ANALYSIS_SCHEMA_VERSION_V1,
    signal,
  });
};

const responseFor = (analysisRequest: AIAnalysisRequest) => ({
  actionability: 75,
  analysisId: analysisRequest.analysisId,
  analysisVersion: analysisRequest.analysisVersion,
  businessImpact: 85,
  candidateActions: [
    {
      kind: "VERIFY",
      priority: 1,
      rationale: "Проверить первоисточник.",
      title: "Проверить документацию",
    },
    {
      kind: "REVIEW",
      priority: 2,
      rationale: "Сопоставить с профилем.",
      title: "Оценить применимость",
    },
  ],
  confidence: 0.9,
  correlationId: analysisRequest.signal.correlationId,
  createdAt: analysisRequest.createdAt,
  deadline: null,
  entities: ["Барнаул"],
  eventType: "TENDER",
  facts: [
    {
      id: "fact-response-contract",
      sourceIds: ["source-response-contract"],
      statement: "Опубликован тендер на строительство гостиницы в Барнауле.",
    },
  ],
  headline: "Тендер на строительство гостиницы",
  inferences: [
    {
      basisFactIds: ["fact-response-contract"],
      id: "inference-response-contract",
      statement: "Проект может быть релевантен подрядчикам.",
    },
  ],
  model: "fixture-analysis-v1",
  promptVersion: analysisRequest.promptVersion,
  provider: "fake",
  risks: ["Сроки требуют проверки."],
  schemaVersion: AI_ANALYSIS_SCHEMA_VERSION_V1,
  signalId: analysisRequest.signal.id,
  sourceIds: ["source-response-contract"],
  status: "SUCCEEDED",
  summary: "Источник сообщает о строительном тендере.",
  urgency: 80,
  whyImportant: "Тендер может создать спрос на подрядные работы.",
});

const contextFor = (analysisRequest: AIAnalysisRequest) => ({
  model: "fixture-analysis-v1",
  provider: "fake",
  request: analysisRequest,
});

describe("analysisFromAIResponseV1", () => {
  it("maps a schema-valid, request-matched response to successful domain Analysis", () => {
    const analysisRequest = request();
    const analysis = analysisFromAIResponseV1(
      responseFor(analysisRequest),
      contextFor(analysisRequest),
    );

    expect(analysis).toMatchObject({
      analysisVersion: "analysis-v1",
      model: "fixture-analysis-v1",
      provider: "fake",
      schemaVersion: AI_ANALYSIS_SCHEMA_VERSION_V1,
      sourceIds: ["source-response-contract"],
      status: "SUCCEEDED",
    });
    expect(Object.isFrozen(analysis)).toBe(true);
  });

  it("returns a safe failed Analysis for a schema-invalid response", () => {
    const analysisRequest = request();
    const rawResponse = { ...responseFor(analysisRequest), facts: [] };
    const analysis = analysisFromAIResponseV1(rawResponse, contextFor(analysisRequest));

    expect(analysis).toMatchObject({
      failureCode: "AI_INVALID_RESPONSE",
      failureReason: "AI response failed ai-analysis/v1 schema validation",
      retryable: false,
      status: "FAILED",
    });
    expect(analysis).not.toHaveProperty("facts");
    expect(JSON.stringify(analysis)).not.toContain("Опубликован тендер");
  });

  it("rejects response identity drift even when the schema is valid", () => {
    const analysisRequest = request();
    const rawResponse = { ...responseFor(analysisRequest), signalId: "different-signal" };

    expect(analysisFromAIResponseV1(rawResponse, contextFor(analysisRequest))).toMatchObject({
      failureCode: "AI_INVALID_RESPONSE",
      failureReason: "AI response identity does not match the request",
      status: "FAILED",
    });
  });

  it("rejects source IDs outside the permission-checked request", () => {
    const analysisRequest = request();
    const response = responseFor(analysisRequest);
    const rawResponse = {
      ...response,
      facts: [{ ...response.facts[0], sourceIds: ["source-outside-request"] }],
      sourceIds: ["source-outside-request"],
    };

    expect(analysisFromAIResponseV1(rawResponse, contextFor(analysisRequest))).toMatchObject({
      failureCode: "AI_INVALID_RESPONSE",
      failureReason: "AI response references source evidence outside the request",
      status: "FAILED",
    });
  });
});
