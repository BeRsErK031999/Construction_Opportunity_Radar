import { describe, expect, it } from "vitest";

import {
  type DomainInvariantError,
  analysisId,
  analysisIdentityKey,
  correlationId,
  createFailedAnalysis,
  createSignal,
  createSuccessfulAnalysis,
  factId,
  inferenceId,
  normalizedItemId,
  signalId,
  sourceId,
} from "../src/index.js";

const provenance = {
  correlationId: correlationId("correlation-1"),
  normalizedItemId: normalizedItemId("normalized-1"),
  signalId: signalId("signal-1"),
  sourceId: sourceId("source-1"),
};

const analysisBase = {
  analysisVersion: "analysis-v1",
  correlationId: provenance.correlationId,
  createdAt: "2026-09-01T00:05:00Z",
  id: analysisId("analysis-1"),
  model: "fake-deterministic-v1",
  promptVersion: "prompt-v1",
  provider: "fake",
  schemaVersion: "schema-v1",
  signalId: provenance.signalId,
};

const validSuccessfulAnalysisInput = () => ({
  ...analysisBase,
  actionability: 70,
  businessImpact: 80,
  candidateActions: [
    {
      kind: "VERIFY" as const,
      priority: 1,
      rationale: "Уточнить фактическую потребность",
      title: "Проверить документацию",
    },
  ],
  confidence: 0.85,
  entities: ["ООО СтройИнвест"],
  eventType: "NEW_CONSTRUCTION_PROJECT",
  facts: [
    {
      id: factId("fact-1"),
      sourceIds: [provenance.sourceId],
      statement: "Опубликовано разрешение на строительство",
    },
    {
      id: factId("fact-2"),
      sourceIds: [provenance.sourceId],
      statement: "Площадь объекта составляет 10 000 м²",
    },
  ],
  headline: "Разрешение на новый объект",
  inferences: [
    {
      basisFactIds: [factId("fact-1"), factId("fact-2")],
      id: inferenceId("inference-1"),
      statement: "Проект может потребовать поставщиков стройматериалов",
    },
  ],
  risks: ["Сроки закупки не опубликованы"],
  summary: "В регионе начинается новый строительный проект.",
  urgency: 60,
  whyImportant: "Появляется потенциальный спрос на материалы и подрядные работы.",
});

describe("Signal", () => {
  it("keeps classification global and preserves multi-item provenance", () => {
    const signal = createSignal({
      category: "PROJECT_START",
      classifierVersion: "classifier-v1",
      classificationConfidence: 91,
      correlationId: provenance.correlationId,
      createdAt: "2026-09-01T00:02:00Z",
      id: provenance.signalId,
      normalizedItemIds: [provenance.normalizedItemId, normalizedItemId("normalized-2")],
      relevanceScore: 88,
      sourceIds: [provenance.sourceId, sourceId("source-2")],
      status: "ACTIVE",
      taxonomyVersion: "taxonomy-v1",
      updatedAt: "2026-09-01T00:03:00Z",
      vertical: "CONSTRUCTION",
    });

    expect(signal).not.toHaveProperty("companyFit");
    expect(signal.normalizedItemIds).toHaveLength(2);
    expect(signal.sourceIds).toHaveLength(2);
  });

  it("requires a different replacement only for superseded signals", () => {
    expect(() =>
      createSignal({
        category: "PROJECT_START",
        classifierVersion: "classifier-v1",
        classificationConfidence: 91,
        correlationId: provenance.correlationId,
        createdAt: "2026-09-01T00:02:00Z",
        id: provenance.signalId,
        normalizedItemIds: [provenance.normalizedItemId],
        relevanceScore: 88,
        sourceIds: [provenance.sourceId],
        status: "SUPERSEDED",
        supersededBySignalId: provenance.signalId,
        taxonomyVersion: "taxonomy-v1",
        updatedAt: "2026-09-01T00:03:00Z",
        vertical: "CONSTRUCTION",
      }),
    ).toThrow(
      expect.objectContaining<Partial<DomainInvariantError>>({ code: "SELF_SUPERSEDED_SIGNAL" }),
    );
  });
});

describe("Analysis", () => {
  it("keeps facts attributable and inferences explicitly based on facts", () => {
    const analysis = createSuccessfulAnalysis(validSuccessfulAnalysisInput());

    expect(analysis.status).toBe("SUCCEEDED");
    expect(analysis.facts).toHaveLength(2);
    expect(analysis.inferences[0]?.basisFactIds).toEqual(["fact-1", "fact-2"]);
    expect(analysis.sourceIds).toEqual([provenance.sourceId]);
    expect(Object.isFrozen(analysis.facts)).toBe(true);
  });

  it("rejects an inference based on a fact outside the same analysis", () => {
    expect(() =>
      createSuccessfulAnalysis({
        ...validSuccessfulAnalysisInput(),
        inferences: [
          {
            basisFactIds: [factId("missing-fact")],
            id: inferenceId("inference-1"),
            statement: "Неподтвержденный вывод",
          },
        ],
      }),
    ).toThrow(
      expect.objectContaining<Partial<DomainInvariantError>>({
        code: "UNKNOWN_INFERENCE_BASIS",
      }),
    );
  });

  it("rejects duplicate fact identifiers", () => {
    const duplicateFact = validSuccessfulAnalysisInput().facts[0];
    if (duplicateFact === undefined) {
      throw new Error("Test fixture must contain a fact");
    }

    expect(() =>
      createSuccessfulAnalysis({
        ...validSuccessfulAnalysisInput(),
        facts: [duplicateFact, duplicateFact],
      }),
    ).toThrow(
      expect.objectContaining<Partial<DomainInvariantError>>({ code: "DUPLICATE_LIST_VALUE" }),
    );
  });

  it("represents provider failure without a successful payload", () => {
    const analysis = createFailedAnalysis({
      ...analysisBase,
      failureCode: "TIMEOUT",
      failureReason: "Provider deadline exceeded",
      retryable: true,
    });

    expect(analysis.status).toBe("FAILED");
    expect(analysis).not.toHaveProperty("facts");
    expect(analysisIdentityKey(analysis)).toContain("prompt-v1");
  });
});
