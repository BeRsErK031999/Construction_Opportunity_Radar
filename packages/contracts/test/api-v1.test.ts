import { describe, expect, it } from "vitest";

import {
  FeedbackCreateRequestV1Schema,
  FeedbackSummaryQueryV1Schema,
  FeedbackSummaryV1Schema,
  SignalListQueryV1Schema,
  SourceCreateRequestV1Schema,
  SourceListQueryV1Schema,
  UserProfilePatchRequestV1Schema,
} from "../src/index.js";

const validSourceRequest = () => ({
  aiProcessingAllowed: true,
  collectionPolicy: { parserKind: "RSS", pollIntervalMinutes: 30 },
  country: "RU",
  enabled: true,
  name: "Открытый реестр разрешений",
  ownerContact: null,
  regions: ["Алтайский край"],
  reliabilityScore: 90,
  rightsBasis: "Открытая лицензия проверена владельцем источника",
  rightsStatus: "OPEN_DATA",
  signalQualityNotes: null,
  type: "RSS",
  url: "https://example.test/feed.xml",
  verticals: ["CONSTRUCTION"],
});

describe("HTTP API contract v1", () => {
  it("rejects unknown source fields instead of silently accepting them", () => {
    expect(() =>
      SourceCreateRequestV1Schema.parse({ ...validSourceRequest(), secret: "unexpected" }),
    ).toThrow();
  });

  it("coerces bounded list filters and rejects an unbounded limit", () => {
    expect(SourceListQueryV1Schema.parse({ enabled: "true", limit: "100" })).toMatchObject({
      enabled: true,
      limit: 100,
    });
    expect(() => SourceListQueryV1Schema.parse({ limit: "101" })).toThrow();
  });

  it("rejects an inverted signal date range", () => {
    expect(() =>
      SignalListQueryV1Schema.parse({
        dateFrom: "2026-09-02T00:00:00.000Z",
        dateTo: "2026-09-01T00:00:00.000Z",
      }),
    ).toThrow();
  });

  it("requires a non-empty profile patch", () => {
    expect(() => UserProfilePatchRequestV1Schema.parse({})).toThrow();
    expect(UserProfilePatchRequestV1Schema.parse({ keywords: ["генподряд"] })).toEqual({
      keywords: ["генподряд"],
    });
  });

  it("accepts only versioned feedback actions and bounded reasons", () => {
    for (const action of ["USEFUL", "NOT_USEFUL", "SAVED", "ACTED", "ALREADY_KNOWN"]) {
      expect(
        FeedbackCreateRequestV1Schema.parse({ action, reason: "Контекст пользователя" }),
      ).toEqual({
        action,
        reason: "Контекст пользователя",
      });
    }
    expect(() => FeedbackCreateRequestV1Schema.parse({ action: "LIKE" })).toThrow();
    expect(() =>
      FeedbackCreateRequestV1Schema.parse({ action: "NOT_USEFUL", reason: "x".repeat(2_001) }),
    ).toThrow();
  });

  it("validates bounded feedback summary queries and metric relationships", () => {
    expect(FeedbackSummaryQueryV1Schema.parse({})).toEqual({ highScoreLimit: 20 });
    expect(() => FeedbackSummaryQueryV1Schema.parse({ highScoreLimit: 101 })).toThrow();
    expect(
      FeedbackSummaryV1Schema.parse({
        actions: { acted: 1, alreadyKnown: 0, notUseful: 1, saved: 1, useful: 3 },
        attribution: { direct: 2, telegram: 4 },
        feedbackCoveragePercent: 40,
        generatedAt: "2026-09-02T12:00:00.000Z",
        highScoreNotUseful: [],
        positiveSentimentPercent: 75,
        totals: {
          actions: 6,
          deliveredRecommendations: 5,
          evaluatedDeliveredRecommendations: 2,
          recommendationsWithFeedback: 4,
        },
        userId: "10000000-0000-4000-8000-000000000001",
      }),
    ).toMatchObject({ feedbackCoveragePercent: 40, positiveSentimentPercent: 75 });
  });
});
