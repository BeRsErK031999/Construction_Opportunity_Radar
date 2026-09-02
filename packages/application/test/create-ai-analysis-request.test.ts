import { createHash } from "node:crypto";

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
  type NormalizedItem,
  type Signal,
  type SignalStatus,
  type Source,
} from "@radar/core";
import { describe, expect, it } from "vitest";

import { createAIAnalysisRequest, type AIAnalysisEvidenceInput } from "../src/index.js";

const timestamp = "2026-09-02T08:00:00Z";
const correlation = correlationId("correlation-ai-request");

const evidence = (id: string, allowed = true): AIAnalysisEvidenceInput => {
  const text = `Разрешённый материал ${id} о строительном тендере.`;
  const normalizedItem: NormalizedItem = createNormalizedItem({
    canonicalUrl: `https://fixtures.radar.local/items/${id}`,
    correlationId: correlation,
    createdAt: timestamp,
    entities: [{ kind: "region", value: "Алтайский край" }],
    id: normalizedItemId(`normalized-${id}`),
    language: "ru",
    normalizedHash: createHash("sha256").update(text).digest("hex"),
    normalizerVersion: "normalizer-v1",
    publishedAt: timestamp,
    rawItemId: rawItemId(`raw-${id}`),
    text,
    title: `Тендер ${id}`,
  });
  const source: Source = createSource({
    aiProcessingAllowed: allowed,
    collectionPolicy: { parserKind: "FIXTURE_JSON" },
    country: "RU",
    createdAt: timestamp,
    enabled: true,
    id: sourceId(`source-${id}`),
    name: `Fixture ${id}`,
    regions: ["Алтайский край"],
    reliabilityScore: 90,
    ...(allowed ? { rightsBasis: "Синтетический тестовый материал" } : {}),
    rightsStatus: allowed ? "CONSENT" : "REVIEW_REQUIRED",
    type: "FIXTURE",
    updatedAt: timestamp,
    url: `https://fixtures.radar.local/sources/${id}`,
    verticals: ["CONSTRUCTION"],
  });
  return Object.freeze({ normalizedItem, source });
};

const signalFor = (
  inputs: readonly AIAnalysisEvidenceInput[],
  status: SignalStatus = "CANDIDATE",
): Signal => {
  const first = inputs[0];
  if (first === undefined) {
    throw new Error("Test signal requires evidence");
  }
  return createSignal({
    category: "TENDER",
    classificationConfidence: 90,
    classificationRuleIds: ["construction.tender"],
    classifierVersion: "classifier-v1",
    correlationId: correlation,
    createdAt: timestamp,
    deduplicationRepresentativeNormalizedItemId: first.normalizedItem.id,
    deduplicatorVersion: "deduplicator-v1",
    id: signalId("signal-ai-request"),
    normalizedItemIds: inputs.map(({ normalizedItem }) => normalizedItem.id),
    relevanceScore: 85,
    sourceIds: [...new Set(inputs.map(({ source }) => source.id))],
    status,
    taxonomyVersion: "signal-taxonomy-v1",
    updatedAt: timestamp,
    vertical: "CONSTRUCTION",
  });
};

const requestFor = (signal: Signal, inputs: readonly AIAnalysisEvidenceInput[]) =>
  createAIAnalysisRequest({
    analysisId: analysisId("analysis-ai-request"),
    analysisVersion: "analysis-v1",
    createdAt: timestamp,
    evidence: inputs,
    promptVersion: "prompt-v1",
    schemaVersion: "analysis-schema-v1",
    signal,
  });

describe("createAIAnalysisRequest", () => {
  it("creates a frozen provider-neutral request from complete permitted evidence", () => {
    const input = evidence("allowed");
    const request = requestFor(signalFor([input]), [input]);

    expect(request).toMatchObject({
      analysisVersion: "analysis-v1",
      promptVersion: "prompt-v1",
      schemaVersion: "analysis-schema-v1",
      signal: {
        category: "TENDER",
        normalizedItemIds: ["normalized-allowed"],
        sourceIds: ["source-allowed"],
        vertical: "CONSTRUCTION",
      },
    });
    expect(request.evidence[0]).toEqual({
      canonicalUrl: "https://fixtures.radar.local/items/allowed",
      entities: [{ kind: "region", value: "Алтайский край" }],
      language: "ru",
      normalizedItemId: "normalized-allowed",
      publishedAt: "2026-09-02T08:00:00.000Z",
      sourceId: "source-allowed",
      text: "Разрешённый материал allowed о строительном тендере.",
      title: "Тендер allowed",
    });
    expect(request.evidence[0]).not.toHaveProperty("rightsBasis");
    expect(Object.isFrozen(request)).toBe(true);
    expect(Object.isFrozen(request.signal.sourceIds)).toBe(true);
    expect(Object.isFrozen(request.evidence[0]?.entities)).toBe(true);
  });

  it("rejects a source whose AI permission is absent or revoked", () => {
    const denied = evidence("denied", false);

    expect(() => requestFor(signalFor([denied]), [denied])).toThrow(
      expect.objectContaining({ code: "AI_EVIDENCE_NOT_PERMITTED" }),
    );
  });

  it("rejects evidence that does not belong to the signal", () => {
    const allowed = evidence("allowed");
    const outside = evidence("outside");

    expect(() => requestFor(signalFor([allowed]), [outside])).toThrow(
      expect.objectContaining({ code: "AI_EVIDENCE_OUTSIDE_SIGNAL" }),
    );
  });

  it("rejects duplicate and incomplete signal evidence", () => {
    const first = evidence("first");
    const second = evidence("second");
    const signal = signalFor([first, second]);

    expect(() => requestFor(signal, [first, first])).toThrow(
      expect.objectContaining({ code: "AI_EVIDENCE_DUPLICATED" }),
    );
    expect(() => requestFor(signal, [first])).toThrow(
      expect.objectContaining({ code: "AI_EVIDENCE_INCOMPLETE" }),
    );
  });

  it("rejects dismissed signals before preparing provider input", () => {
    const input = evidence("dismissed");

    expect(() => requestFor(signalFor([input], "DISMISSED"), [input])).toThrow(
      expect.objectContaining({ code: "SIGNAL_NOT_ANALYZABLE" }),
    );
  });
});
