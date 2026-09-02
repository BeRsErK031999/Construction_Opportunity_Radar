import { describe, expect, it } from "vitest";

import {
  analysisId,
  calculateCompanyFitV1,
  confidenceFactorFromProbabilityV1,
  correlationId,
  createRecommendationFromScoreV1,
  createSignal,
  createSuccessfulAnalysis,
  createUserProfile,
  factId,
  normalizedItemId,
  OPPORTUNITY_BAND_THRESHOLDS_V1,
  OPPORTUNITY_SCORE_WEIGHTS_V1,
  opportunityBandV1,
  recommendationId,
  scoreAnalyzedSignalForProfileV1,
  scoreOpportunityV1,
  SCORING_VERSION_V1,
  signalId,
  sourceId,
  userId,
  userProfileId,
  type CompanyFitCandidateV1,
  type CreateUserProfileInput,
  type Signal,
  type SuccessfulAnalysis,
  type UserProfile,
} from "../src/index.js";

const profile = (overrides: Partial<CreateUserProfileInput> = {}): UserProfile =>
  createUserProfile({
    companySize: "SMALL",
    companyType: "Поставщик строительных материалов",
    createdAt: "2026-09-01T00:00:00Z",
    excludedKeywords: ["частный дом"],
    id: userProfileId("profile-1"),
    ignoredEventTypes: ["PRIVATE_RENOVATION"],
    interestedEventTypes: ["NEW_CONSTRUCTION_PROJECT"],
    keywords: ["генподрядчик"],
    projectValueRange: { currency: "RUB", maximum: 100_000_000, minimum: 1_000_000 },
    regions: ["Алтайский край"],
    revision: 1,
    servicesAndProducts: ["Бетон", "Металлоконструкции"],
    targetClients: ["Генеральные подрядчики"],
    updatedAt: "2026-09-01T00:00:00Z",
    userId: userId("user-1"),
    verticals: ["CONSTRUCTION"],
    ...overrides,
  });

const matchingCandidate: CompanyFitCandidateV1 = Object.freeze({
  eventType: "new_construction_project",
  projectValue: { amount: 50_000_000, currency: "rub" },
  regions: ["АЛТАЙСКИЙ КРАЙ"],
  terms: ["Поставка бетона"],
  vertical: "CONSTRUCTION",
});

const signal = (): Signal =>
  createSignal({
    category: "CONSTRUCTION_TENDER",
    classificationConfidence: 90,
    classificationRuleIds: ["vertical.construction.build", "opportunity.tender"],
    classifierVersion: "classifier-v1",
    correlationId: correlationId("83000000-0000-4000-8000-000000000001"),
    createdAt: "2026-09-01T00:00:00Z",
    deduplicationRepresentativeNormalizedItemId: normalizedItemId(
      "84000000-0000-4000-8000-000000000001",
    ),
    deduplicatorVersion: "deduplicator-v1",
    id: signalId("85000000-0000-4000-8000-000000000001"),
    normalizedItemIds: [normalizedItemId("84000000-0000-4000-8000-000000000001")],
    relevanceScore: 90,
    sourceIds: [sourceId("86000000-0000-4000-8000-000000000001")],
    status: "CANDIDATE",
    taxonomyVersion: "signal-taxonomy-v1",
    updatedAt: "2026-09-01T00:00:00Z",
    vertical: "CONSTRUCTION",
  });

const analysis = (signalValue = signal()): SuccessfulAnalysis =>
  createSuccessfulAnalysis({
    actionability: 70,
    analysisVersion: "analysis-v1",
    businessImpact: 80,
    candidateActions: [],
    confidence: 0.85,
    correlationId: signalValue.correlationId,
    createdAt: "2026-09-01T00:10:00Z",
    entities: ["Бетон"],
    eventType: "NEW_CONSTRUCTION_PROJECT",
    facts: [
      {
        id: factId("fact-1"),
        sourceIds: signalValue.sourceIds,
        statement: "В Алтайском крае объявлен строительный проект.",
      },
    ],
    headline: "Новый строительный проект",
    id: analysisId("87000000-0000-4000-8000-000000000001"),
    inferences: [],
    model: "fake-model",
    promptVersion: "prompt-v1",
    provider: "fake",
    risks: [],
    schemaVersion: "analysis-schema-v1",
    signalId: signalValue.id,
    summary: "Открывается окно для поставщиков строительных материалов.",
    urgency: 60,
    whyImportant: "Профиль поставляет материалы в регионе проекта.",
  });

describe("opportunity-score-v1", () => {
  it("calculates the frozen five-factor formula and an inspectable explanation", () => {
    const result = scoreOpportunityV1({
      actionability: 70,
      businessImpact: 80,
      companyFit: 95,
      confidence: 85,
      urgency: 60,
    });

    expect(
      Object.values(OPPORTUNITY_SCORE_WEIGHTS_V1).reduce((sum, weight) => sum + weight, 0),
    ).toBe(1);
    expect(result).toMatchObject({
      band: "HIGH",
      contributions: {
        actionability: 7,
        businessImpact: 28,
        companyFit: 23.75,
        confidence: 8.5,
        urgency: 12,
      },
      scoringVersion: SCORING_VERSION_V1,
      totalScore: 79.25,
    });
    expect(result.explanation).toContain("businessImpact 80.00×35%=28.00");
    expect(Object.isFrozen(result.scoreBreakdown)).toBe(true);
  });

  it("applies explicit inclusive band thresholds", () => {
    const cases = [
      [0, "IGNORE"],
      [OPPORTUNITY_BAND_THRESHOLDS_V1.low - 0.01, "IGNORE"],
      [OPPORTUNITY_BAND_THRESHOLDS_V1.low, "LOW"],
      [OPPORTUNITY_BAND_THRESHOLDS_V1.medium, "MEDIUM"],
      [OPPORTUNITY_BAND_THRESHOLDS_V1.high, "HIGH"],
      [OPPORTUNITY_BAND_THRESHOLDS_V1.critical, "CRITICAL"],
      [100, "CRITICAL"],
    ] as const;

    for (const [value, expected] of cases) {
      expect(opportunityBandV1(value)).toBe(expected);
      expect(
        scoreOpportunityV1({
          actionability: value,
          businessImpact: value,
          companyFit: value,
          confidence: value,
          urgency: value,
        }).band,
      ).toBe(expected);
    }
  });

  it("rejects invalid factors and converts analysis confidence explicitly", () => {
    expect(confidenceFactorFromProbabilityV1(0.853)).toBe(85.3);
    expect(() => confidenceFactorFromProbabilityV1(1.01)).toThrow(
      expect.objectContaining({ code: "INVALID_PROBABILITY" }),
    );
    expect(() =>
      scoreOpportunityV1({
        actionability: 70,
        businessImpact: Number.NaN,
        companyFit: 95,
        confidence: 85,
        urgency: 60,
      }),
    ).toThrow(expect.objectContaining({ code: "INVALID_SCORE" }));
  });
});

describe("company-fit-v1", () => {
  it("scores all five profile dimensions and records their reasons", () => {
    const result = calculateCompanyFitV1(profile(), matchingCandidate);

    expect(result).toMatchObject({
      excluded: false,
      exclusionReasonCode: null,
      score: 100,
      version: SCORING_VERSION_V1,
    });
    expect(result.criteria).toHaveLength(5);
    expect(result.criteria.map((item) => item.reasonCode)).toEqual([
      "VERTICAL_MATCH",
      "REGION_MATCH",
      "EVENT_MATCH",
      "OFFERING_MATCH",
      "PROJECT_VALUE_MATCH",
    ]);
    expect(result.criteria.reduce((sum, item) => sum + item.contribution, 0)).toBe(100);
  });

  it("produces different company fit for the same opportunity and treats unknowns neutrally", () => {
    const horecaProfile = profile({
      companyType: "Поставщик ресторанного оборудования",
      id: userProfileId("profile-2"),
      interestedEventTypes: ["HORECA_OPENING"],
      projectValueRange: { currency: "RUB", maximum: 5_000_000, minimum: 100_000 },
      regions: ["Новосибирская область"],
      servicesAndProducts: ["Ресторанное оборудование"],
      userId: userId("user-2"),
      verticals: ["HORECA"],
    });

    expect(calculateCompanyFitV1(profile(), matchingCandidate).score).toBe(100);
    expect(calculateCompanyFitV1(horecaProfile, matchingCandidate).score).toBe(8.75);
    expect(
      calculateCompanyFitV1(profile(), {
        eventType: null,
        projectValue: null,
        regions: [],
        terms: [],
        vertical: "CONSTRUCTION",
      }).score,
    ).toBe(65);
  });

  it("makes ignored events and excluded terms explicit hard exclusions", () => {
    const ignored = calculateCompanyFitV1(profile(), {
      ...matchingCandidate,
      eventType: "private_renovation",
    });
    const excluded = calculateCompanyFitV1(profile(), {
      ...matchingCandidate,
      terms: ["Строительство частного дома"],
    });

    expect(ignored).toMatchObject({
      excluded: true,
      exclusionReasonCode: "EVENT_IGNORED",
      score: 0,
    });
    expect(excluded).toMatchObject({
      excluded: true,
      exclusionReasonCode: "EXCLUDED_TERM_MATCH",
      score: 0,
    });
  });

  it("validates candidate project values independently of profile range availability", () => {
    expect(() =>
      calculateCompanyFitV1(profile({ projectValueRange: null }), {
        ...matchingCandidate,
        projectValue: { amount: -1, currency: "RUB" },
      }),
    ).toThrow(expect.objectContaining({ code: "INVALID_CANDIDATE_PROJECT_VALUE" }));
  });

  it("scores a successful analysis for one profile and rejects cross-signal input", () => {
    const signalValue = signal();
    const analysisValue = analysis(signalValue);
    const result = scoreAnalyzedSignalForProfileV1({
      analysis: analysisValue,
      companyFitContext: {
        projectValue: { amount: 50_000_000, currency: "rub" },
        regions: ["АЛТАЙСКИЙ КРАЙ"],
        terms: ["Поставка бетона"],
      },
      profile: profile(),
      signal: signalValue,
    });

    expect(result.status).toBe("SCORED");
    if (result.status !== "SCORED") {
      throw new Error("Expected a scored profile decision");
    }
    expect(result.companyFit.score).toBe(100);
    expect(result.scoreBreakdown).toEqual({
      actionability: 70,
      businessImpact: 80,
      companyFit: 100,
      confidence: 85,
      urgency: 60,
    });
    expect(result.totalScore).toBe(80.5);
    expect(result.explanation).toContain("companyFitCriteria: VERTICAL 100.00");

    const profileValue = profile();
    const recommendation = createRecommendationFromScoreV1({
      analysisId: analysisValue.id,
      correlationId: signalValue.correlationId,
      createdAt: "2026-09-01T00:20:00Z",
      id: recommendationId("88000000-0000-4000-8000-000000000001"),
      recommendedActions: [
        {
          kind: "VERIFY",
          priority: 1,
          rationale: "Проверить факты и сроки",
          title: "Изучить документацию",
        },
        {
          kind: "PREPARE_OFFER",
          priority: 2,
          rationale: "Подготовить предложение под профиль",
          title: "Собрать предложение",
        },
      ],
      score: result,
      signalId: signalValue.id,
      sourceIds: signalValue.sourceIds,
      userProfileId: profileValue.id,
      userProfileRevision: profileValue.revision,
    });
    expect(recommendation).toMatchObject({
      band: result.band,
      scoreBreakdown: result.scoreBreakdown,
      scoringVersion: SCORING_VERSION_V1,
      totalScore: result.totalScore,
    });

    expect(() =>
      scoreAnalyzedSignalForProfileV1({
        analysis: analysisValue,
        profile: profile(),
        signal: createSignal({ ...signalValue, id: signalId("another-signal") }),
      }),
    ).toThrow(expect.objectContaining({ code: "SCORING_SIGNAL_ANALYSIS_MISMATCH" }));
  });

  it("does not emit a score for an explicitly excluded profile opportunity", () => {
    const signalValue = signal();
    const analysisValue = createSuccessfulAnalysis({
      ...analysis(signalValue),
      eventType: "PRIVATE_RENOVATION",
    });

    const result = scoreAnalyzedSignalForProfileV1({
      analysis: analysisValue,
      profile: profile(),
      signal: signalValue,
    });

    expect(result).toMatchObject({
      companyFit: {
        excluded: true,
        exclusionReasonCode: "EVENT_IGNORED",
        score: 0,
      },
      scoringVersion: SCORING_VERSION_V1,
      status: "EXCLUDED",
    });
    expect(result).not.toHaveProperty("totalScore");
  });
});
