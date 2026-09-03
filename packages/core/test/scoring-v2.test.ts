import { describe, expect, it } from "vitest";

import {
  analysisId,
  CONFIDENCE_GUARDRAIL_V2,
  correlationId,
  createRecommendationFromScoreV2,
  createSignal,
  createSource,
  createSuccessfulAnalysis,
  createUserProfile,
  factId,
  normalizedItemId,
  recommendationId,
  scoreAnalyzedSignalForProfileV2,
  scoreOpportunityV2,
  SCORING_VERSION_V2,
  signalId,
  sourceId,
  supportingEvidenceReliabilityV2,
  userId,
  userProfileId,
  type Source,
} from "../src/index.js";

const createdAt = "2026-09-03T06:00:00Z";
const correlation = correlationId("91000000-0000-4000-8000-000000000001");

const source = (id: string, reliabilityScore: number): Source =>
  createSource({
    aiProcessingAllowed: true,
    collectionPolicy: { parserKind: "FIXTURE_JSON" },
    country: "RU",
    createdAt,
    enabled: true,
    id: sourceId(id),
    name: id,
    regions: ["Калининградская область"],
    reliabilityScore,
    rightsBasis: "Синтетический тестовый материал",
    rightsStatus: "CONSENT",
    type: "FIXTURE",
    updatedAt: createdAt,
    url: `https://fixtures.radar.local/sources/${id}`,
    verticals: ["CONSTRUCTION"],
  });

const signal = (sources: readonly Source[]) =>
  createSignal({
    category: "CONSTRUCTION_PROJECT",
    classificationConfidence: 90,
    classificationRuleIds: ["vertical.construction.build", "opportunity.construction"],
    classifierVersion: "classifier-v2",
    correlationId: correlation,
    createdAt,
    deduplicationRepresentativeNormalizedItemId: normalizedItemId("normalized-v2"),
    deduplicatorVersion: "deduplicator-v1",
    id: signalId("signal-v2"),
    normalizedItemIds: [normalizedItemId("normalized-v2")],
    relevanceScore: 90,
    sourceIds: sources.map(({ id }) => id),
    status: "CANDIDATE",
    taxonomyVersion: "signal-taxonomy-v1",
    updatedAt: createdAt,
    vertical: "CONSTRUCTION",
  });

const analysis = (sources: readonly Source[], confidence = 0.91) => {
  const signalValue = signal(sources);
  return createSuccessfulAnalysis({
    actionability: 74,
    analysisVersion: "analysis-v1",
    businessImpact: 78,
    candidateActions: [
      {
        kind: "VERIFY",
        priority: 1,
        rationale: "Сверить исходные документы",
        title: "Проверить факты",
      },
      {
        kind: "MONITOR",
        priority: 2,
        rationale: "Следить за подтверждениями",
        title: "Продолжить мониторинг",
      },
    ],
    confidence,
    correlationId: correlation,
    createdAt,
    entities: ["Калининградская область"],
    eventType: "CONSTRUCTION_PROJECT",
    facts: [
      {
        id: factId("fact-v2"),
        sourceIds: sources.map(({ id }) => id),
        statement: "Опубликованы сведения о строительной активности.",
      },
    ],
    headline: "Строительная активность региона",
    id: analysisId("analysis-v2"),
    inferences: [],
    model: "fake-model",
    promptVersion: "prompt-v1",
    provider: "fake",
    risks: [],
    schemaVersion: "ai-analysis/v1",
    signalId: signalValue.id,
    summary: "Сводка требует оценки для профиля поставщика.",
    urgency: 66,
    whyImportant: "Сигнал влияет на загрузку и ценовые решения.",
  });
};

describe("opportunity-score-v2", () => {
  it("caps a low-confidence, low-reliability opportunity below HIGH", () => {
    const result = scoreOpportunityV2({
      actionability: 61,
      analysisConfidence: 46,
      businessImpact: 86,
      companyFit: 95,
      evidenceReliability: 35,
      urgency: 42,
    });

    expect(result).toMatchObject({
      band: "LOW",
      confidenceGuardrail: {
        analysisConfidence: 46,
        applied: true,
        effectiveConfidence: 35,
        evidenceReliability: 35,
        maximumBand: "LOW",
        maximumScore: CONFIDENCE_GUARDRAIL_V2.lowMaximumScore,
        rawTotalScore: 71.85,
      },
      scoringVersion: SCORING_VERSION_V2,
      totalScore: 54,
    });
    expect(result.explanation).toContain("confidenceGuardrail capped priority at LOW/54.00");
  });

  it("preserves the weighted result when evidence and analysis are reliable", () => {
    const result = scoreOpportunityV2({
      actionability: 74,
      analysisConfidence: 91,
      businessImpact: 78,
      companyFit: 95,
      evidenceReliability: 95,
      urgency: 66,
    });

    expect(result).toMatchObject({
      band: "HIGH",
      confidenceGuardrail: {
        applied: false,
        effectiveConfidence: 91,
        maximumBand: "CRITICAL",
      },
      scoringVersion: SCORING_VERSION_V2,
      totalScore: 80.75,
    });
  });

  it("uses the best corroborating source per fact and the weakest fact overall", () => {
    const weak = source("weak", 35);
    const strong = source("strong", 90);
    const signalValue = signal([weak, strong]);
    const analysisValue = createSuccessfulAnalysis({
      ...analysis([weak, strong]),
      facts: [
        {
          id: factId("corroborated-fact"),
          sourceIds: [weak.id, strong.id],
          statement: "Первый факт подтверждён двумя источниками.",
        },
        {
          id: factId("weak-fact"),
          sourceIds: [weak.id],
          statement: "Второй факт подтверждён только слабым источником.",
        },
      ],
      id: analysisId("corroborated-analysis"),
      signalId: signalValue.id,
    });

    expect(supportingEvidenceReliabilityV2(analysisValue, [weak, strong])).toBe(35);
    expect(() => supportingEvidenceReliabilityV2(analysisValue, [strong])).toThrow(
      expect.objectContaining({ code: "MISSING_SCORING_SOURCE_RELIABILITY" }),
    );
  });

  it("persists the effective confidence and versioned guardrail result", () => {
    const reliableSource = source("reliable", 95);
    const signalValue = signal([reliableSource]);
    const analysisValue = analysis([reliableSource]);
    const profile = createUserProfile({
      companySize: "SMALL",
      companyType: "Поставщик строительных материалов",
      createdAt,
      id: userProfileId("profile-v2"),
      interestedEventTypes: ["CONSTRUCTION_PROJECT"],
      keywords: ["строительство"],
      regions: ["Калининградская область"],
      revision: 1,
      servicesAndProducts: ["строительные материалы"],
      targetClients: ["генподрядчики"],
      updatedAt: createdAt,
      userId: userId("user-v2"),
      verticals: ["CONSTRUCTION"],
    });
    const result = scoreAnalyzedSignalForProfileV2({
      analysis: analysisValue,
      companyFitContext: {
        regions: reliableSource.regions,
        terms: ["строительство и строительные материалы"],
      },
      profile,
      signal: signalValue,
      sources: [reliableSource],
    });
    expect(result.status).toBe("SCORED");
    if (result.status !== "SCORED") {
      throw new Error("Expected a scored result");
    }
    const recommendation = createRecommendationFromScoreV2({
      analysisId: analysisValue.id,
      correlationId: correlation,
      createdAt,
      id: recommendationId("recommendation-v2"),
      recommendedActions: analysisValue.candidateActions,
      score: result,
      signalId: signalValue.id,
      sourceIds: signalValue.sourceIds,
      userProfileId: profile.id,
      userProfileRevision: profile.revision,
    });

    expect(recommendation.scoringVersion).toBe(SCORING_VERSION_V2);
    expect(recommendation.scoreBreakdown.confidence).toBe(91);
    expect(recommendation.explanation).toContain("evidenceReliability");
  });
});
