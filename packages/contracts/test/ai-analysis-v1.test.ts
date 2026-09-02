import { describe, expect, it } from "vitest";

import { AI_ANALYSIS_SCHEMA_VERSION_V1, AIAnalysisResponseV1Schema } from "../src/index.js";

const validResponse = () => ({
  actionability: 75,
  analysisId: "analysis-contract-1",
  analysisVersion: "analysis-v1",
  businessImpact: 80,
  candidateActions: [
    {
      kind: "VERIFY",
      priority: 1,
      rationale: "Проверить условия в первоисточнике.",
      title: "Проверить документацию",
    },
    {
      kind: "REVIEW",
      priority: 2,
      rationale: "Сопоставить проект с профилем компании.",
      title: "Оценить применимость",
    },
  ],
  confidence: 0.9,
  correlationId: "correlation-contract-1",
  createdAt: "2026-09-02T10:00:00.000Z",
  deadline: null,
  entities: ["Барнаул", "Гостиница"],
  eventType: "TENDER",
  facts: [
    {
      id: "fact-contract-1",
      sourceIds: ["source-contract-1"],
      statement: "Опубликован тендер на строительство гостиницы.",
    },
  ],
  headline: "Тендер на строительство гостиницы",
  inferences: [
    {
      basisFactIds: ["fact-contract-1"],
      id: "inference-contract-1",
      statement: "Проект может быть релевантен строительным подрядчикам.",
    },
  ],
  model: "fixture-analysis-v1",
  promptVersion: "prompt-v1",
  provider: "fake",
  risks: ["Точные сроки закупки требуют проверки."],
  schemaVersion: AI_ANALYSIS_SCHEMA_VERSION_V1,
  signalId: "signal-contract-1",
  sourceIds: ["source-contract-1"],
  status: "SUCCEEDED",
  summary: "Источник сообщает о новом строительном тендере.",
  urgency: 70,
  whyImportant: "Тендер может создать спрос на подрядные работы.",
});

describe("AIAnalysisResponseV1Schema", () => {
  it("accepts a complete versioned response with explicit provenance", () => {
    const parsed = AIAnalysisResponseV1Schema.parse(validResponse());

    expect(parsed.schemaVersion).toBe(AI_ANALYSIS_SCHEMA_VERSION_V1);
    expect(parsed.facts[0]?.sourceIds).toEqual(["source-contract-1"]);
    expect(parsed.inferences[0]?.basisFactIds).toEqual(["fact-contract-1"]);
  });

  it("rejects unknown fields and mixing fact/inference responsibilities", () => {
    const response = validResponse();

    expect(AIAnalysisResponseV1Schema.safeParse({ ...response, debug: true }).success).toBe(false);
    expect(
      AIAnalysisResponseV1Schema.safeParse({
        ...response,
        facts: [{ ...response.facts[0], basisFactIds: ["fact-contract-1"] }],
      }).success,
    ).toBe(false);
    expect(
      AIAnalysisResponseV1Schema.safeParse({
        ...response,
        inferences: [{ ...response.inferences[0], sourceIds: ["source-contract-1"] }],
      }).success,
    ).toBe(false);
  });

  it("rejects an inference whose basis is absent from the same analysis", () => {
    const response = validResponse();

    expect(
      AIAnalysisResponseV1Schema.safeParse({
        ...response,
        inferences: [{ ...response.inferences[0], basisFactIds: ["missing-fact"] }],
      }).success,
    ).toBe(false);
  });

  it("rejects declared sources that differ from fact provenance", () => {
    expect(
      AIAnalysisResponseV1Schema.safeParse({
        ...validResponse(),
        sourceIds: ["source-contract-2"],
      }).success,
    ).toBe(false);
  });

  it("rejects wrong versions, unsafe ranges, too few actions, and duplicate values", () => {
    const response = validResponse();

    expect(
      AIAnalysisResponseV1Schema.safeParse({ ...response, schemaVersion: "ai-analysis/v2" })
        .success,
    ).toBe(false);
    expect(AIAnalysisResponseV1Schema.safeParse({ ...response, confidence: 1.01 }).success).toBe(
      false,
    );
    expect(
      AIAnalysisResponseV1Schema.safeParse({
        ...response,
        candidateActions: response.candidateActions.slice(0, 1),
      }).success,
    ).toBe(false);
    expect(
      AIAnalysisResponseV1Schema.safeParse({
        ...response,
        entities: ["Барнаул", "барнаул"],
      }).success,
    ).toBe(false);
    expect(
      AIAnalysisResponseV1Schema.safeParse({ ...response, headline: ` ${response.headline}` })
        .success,
    ).toBe(false);
  });
});
