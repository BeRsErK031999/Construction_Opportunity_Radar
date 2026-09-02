import { describe, expect, it } from "vitest";

import {
  correlationId,
  deliveryId,
  feedbackId,
  recommendationId,
  signalId,
  userId,
} from "@radar/core";

import {
  ApplicationApiError,
  getUserFeedbackSummary,
  type FeedbackReadRepository,
} from "../src/index.js";

const USER_ID = userId("10000000-0000-4000-8000-000000000001");
const OTHER_USER_ID = userId("10000000-0000-4000-8000-000000000002");
const NOW = "2026-09-02T12:00:00.000Z";

const repository = (): FeedbackReadRepository => ({
  summarizeForUser(_userId, highScoreLimit) {
    return Promise.resolve({
      actionCounts: {
        ACTED: 1,
        ALREADY_KNOWN: 1,
        NOT_USEFUL: 1,
        SAVED: 2,
        USEFUL: 3,
      },
      deliveredRecommendations: 5,
      directActions: 2,
      evaluatedDeliveredRecommendations: 2,
      highScoreNotUseful: [
        {
          attribution: "TELEGRAM",
          band: "HIGH",
          correlationId: correlationId("20000000-0000-4000-8000-000000000001"),
          deliveryId: deliveryId("30000000-0000-4000-8000-000000000001"),
          feedbackAt: NOW,
          feedbackId: feedbackId("40000000-0000-4000-8000-000000000001"),
          headline: `Неполезная возможность ${String(highScoreLimit)}`,
          reason: "Уже закрыли потребность",
          recommendationId: recommendationId("50000000-0000-4000-8000-000000000001"),
          signalId: signalId("60000000-0000-4000-8000-000000000001"),
          totalScore: 82,
          vertical: "CONSTRUCTION",
        },
      ],
      recommendationsWithFeedback: 4,
      telegramActions: 6,
    });
  },
});

describe("feedback summary", () => {
  it("calculates explicit coverage and sentiment metrics without changing scoring", async () => {
    const summary = await getUserFeedbackSummary({
      callerUserId: USER_ID,
      generatedAt: NOW,
      highScoreLimit: 7,
      repository: repository(),
      userId: USER_ID,
    });

    expect(summary).toMatchObject({
      attribution: { direct: 2, telegram: 6 },
      feedbackCoveragePercent: 40,
      positiveSentimentPercent: 75,
      totals: {
        actions: 8,
        deliveredRecommendations: 5,
        evaluatedDeliveredRecommendations: 2,
        recommendationsWithFeedback: 4,
      },
    });
    expect(summary.highScoreNotUseful[0]?.headline).toContain("7");
  });

  it("returns zero coverage and unknown sentiment when there is no evidence", async () => {
    const emptyRepository: FeedbackReadRepository = {
      summarizeForUser() {
        return Promise.resolve({
          actionCounts: { ACTED: 0, ALREADY_KNOWN: 0, NOT_USEFUL: 0, SAVED: 0, USEFUL: 0 },
          deliveredRecommendations: 0,
          directActions: 0,
          evaluatedDeliveredRecommendations: 0,
          highScoreNotUseful: [],
          recommendationsWithFeedback: 0,
          telegramActions: 0,
        });
      },
    };

    const summary = await getUserFeedbackSummary({
      callerUserId: USER_ID,
      generatedAt: NOW,
      highScoreLimit: 20,
      repository: emptyRepository,
      userId: USER_ID,
    });

    expect(summary.feedbackCoveragePercent).toBe(0);
    expect(summary.positiveSentimentPercent).toBeNull();
  });

  it("denies another user's summary before querying persistence", async () => {
    await expect(
      getUserFeedbackSummary({
        callerUserId: OTHER_USER_ID,
        generatedAt: NOW,
        highScoreLimit: 20,
        repository: repository(),
        userId: USER_ID,
      }),
    ).rejects.toBeInstanceOf(ApplicationApiError);
  });
});
