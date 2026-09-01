import { describe, expect, it } from "vitest";

import {
  type DomainInvariantError,
  analysisId,
  correlationId,
  createFeedback,
  createRecommendation,
  createUser,
  createUserProfile,
  deliveryId,
  feedbackId,
  feedbackIdentityKey,
  feedbackSentimentKey,
  recommendationId,
  recommendationIdentityKey,
  signalId,
  sourceId,
  userId,
  userProfileId,
  type ProfileVertical,
} from "../src/index.js";

const identifiers = {
  analysisId: analysisId("analysis-1"),
  correlationId: correlationId("correlation-1"),
  recommendationId: recommendationId("recommendation-1"),
  signalId: signalId("signal-1"),
  sourceId: sourceId("source-1"),
  userId: userId("user-1"),
  userProfileId: userProfileId("profile-1"),
};

const validProfileInput = () => ({
  companySize: "SMALL" as const,
  companyType: "Поставщик строительных материалов",
  createdAt: "2026-09-01T00:00:00Z",
  excludedKeywords: ["частный дом"],
  id: identifiers.userProfileId,
  ignoredEventTypes: ["PRIVATE_RENOVATION"],
  interestedEventTypes: ["NEW_CONSTRUCTION_PROJECT"],
  keywords: ["генподряд"],
  projectValueRange: { currency: "rub", maximum: 100_000_000, minimum: 1_000_000 },
  regions: ["Алтайский край"],
  revision: 1,
  servicesAndProducts: ["Бетон", "Металлоконструкции"],
  targetClients: ["Генеральные подрядчики"],
  updatedAt: "2026-09-01T00:00:00Z",
  userId: identifiers.userId,
  verticals: ["CONSTRUCTION" as const],
});

const actions = [
  {
    kind: "VERIFY" as const,
    priority: 1,
    rationale: "Подтвердить сроки закупки",
    title: "Проверить тендерную документацию",
  },
  {
    kind: "PREPARE_OFFER" as const,
    priority: 2,
    rationale: "Подготовиться до выхода закупки",
    title: "Собрать релевантное предложение",
  },
];

const validRecommendationInput = () => ({
  analysisId: identifiers.analysisId,
  band: "HIGH" as const,
  correlationId: identifiers.correlationId,
  createdAt: "2026-09-01T00:10:00Z",
  explanation: "Высокое соответствие профилю и значимый масштаб проекта.",
  id: identifiers.recommendationId,
  recommendedActions: actions,
  scoreBreakdown: {
    actionability: 70,
    businessImpact: 80,
    companyFit: 95,
    confidence: 85,
    urgency: 60,
  },
  scoringVersion: "score-v1",
  signalId: identifiers.signalId,
  sourceIds: [identifiers.sourceId],
  totalScore: 81.75,
  userProfileId: identifiers.userProfileId,
  userProfileRevision: 1,
});

describe("User and UserProfile", () => {
  it("stores only a transport identity and lifecycle state for the user", () => {
    const user = createUser({
      createdAt: "2026-09-01T00:00:00Z",
      id: identifiers.userId,
      revision: 1,
      status: "ACTIVE",
      telegramUserId: "123456789",
      updatedAt: "2026-09-01T00:00:00Z",
    });

    expect(user.telegramUserId).toBe("123456789");
    expect(user).not.toHaveProperty("name");
    expect(user).not.toHaveProperty("phone");
  });

  it("creates an MVP profile and normalizes its project currency", () => {
    const profile = createUserProfile(validProfileInput());

    expect(profile.verticals).toEqual(["CONSTRUCTION"]);
    expect(profile.projectValueRange?.currency).toBe("RUB");
  });

  it("rejects conflicting positive and negative interests", () => {
    expect(() =>
      createUserProfile({
        ...validProfileInput(),
        excludedKeywords: ["ГЕНПОДРЯД"],
      }),
    ).toThrow(
      expect.objectContaining<Partial<DomainInvariantError>>({ code: "CONFLICTING_KEYWORDS" }),
    );
  });

  it("keeps profiles within Construction and HoReCa before Gate G4", () => {
    expect(() =>
      createUserProfile({
        ...validProfileInput(),
        verticals: ["OTHER" as ProfileVertical],
      }),
    ).toThrow(
      expect.objectContaining<Partial<DomainInvariantError>>({
        code: "UNSUPPORTED_PROFILE_VERTICAL",
      }),
    );
  });
});

describe("Recommendation", () => {
  it("owns profile-specific company fit, score, explanation, and actions", () => {
    const recommendation = createRecommendation(validRecommendationInput());

    expect(recommendation.scoreBreakdown.companyFit).toBe(95);
    expect(recommendation.totalScore).toBe(81.75);
    expect(recommendation.recommendedActions).toHaveLength(2);
    expect(recommendationIdentityKey(recommendation)).toBe(
      JSON.stringify(["signal-1", "analysis-1", "profile-1", 1, "score-v1"]),
    );
  });

  it("requires two to five concrete actions", () => {
    expect(() =>
      createRecommendation({
        ...validRecommendationInput(),
        recommendedActions: actions.slice(0, 1),
      }),
    ).toThrow(
      expect.objectContaining<Partial<DomainInvariantError>>({
        code: "INVALID_RECOMMENDED_ACTION_COUNT",
      }),
    );
  });

  it("rejects score factors outside the 0-100 range", () => {
    expect(() =>
      createRecommendation({
        ...validRecommendationInput(),
        scoreBreakdown: { ...validRecommendationInput().scoreBreakdown, companyFit: 101 },
      }),
    ).toThrow(expect.objectContaining<Partial<DomainInvariantError>>({ code: "INVALID_SCORE" }));
  });
});

describe("Feedback", () => {
  it("keeps feedback attributable through user, recommendation, delivery, and correlation", () => {
    const feedback = createFeedback({
      action: "USEFUL",
      correlationId: identifiers.correlationId,
      createdAt: "2026-09-01T00:20:00Z",
      deliveryId: deliveryId("delivery-1"),
      id: feedbackId("feedback-1"),
      reason: "Подходит по региону и номенклатуре",
      recommendationId: identifiers.recommendationId,
      userId: identifiers.userId,
    });

    expect(feedbackIdentityKey(feedback)).toBe(
      JSON.stringify(["user-1", "recommendation-1", "USEFUL"]),
    );
    expect(feedbackSentimentKey(feedback)).toBe(
      JSON.stringify(["user-1", "recommendation-1", "SENTIMENT"]),
    );
    expect(feedback.deliveryId).toBe("delivery-1");
  });

  it("does not place non-sentiment actions into the sentiment uniqueness group", () => {
    const feedback = createFeedback({
      action: "SAVED",
      correlationId: identifiers.correlationId,
      createdAt: "2026-09-01T00:20:00Z",
      id: feedbackId("feedback-2"),
      recommendationId: identifiers.recommendationId,
      userId: identifiers.userId,
    });

    expect(feedbackSentimentKey(feedback)).toBeNull();
  });
});
