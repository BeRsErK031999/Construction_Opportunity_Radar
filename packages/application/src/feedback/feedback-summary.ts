import {
  FEEDBACK_ACTIONS,
  type CorrelationId,
  type DeliveryId,
  type FeedbackAction,
  type FeedbackId,
  type OpportunityBand,
  type RecommendationId,
  type SignalId,
  type UserId,
  type Vertical,
} from "@radar/core";

import { ApplicationApiError } from "../api/application-api.js";

export type FeedbackActionCounts = Readonly<Record<FeedbackAction, number>>;

export interface HighScoreNotUsefulFeedback {
  readonly attribution: "DIRECT" | "TELEGRAM";
  readonly band: OpportunityBand;
  readonly correlationId: CorrelationId;
  readonly deliveryId: DeliveryId | null;
  readonly feedbackAt: string;
  readonly feedbackId: FeedbackId;
  readonly headline: string;
  readonly reason: string | null;
  readonly recommendationId: RecommendationId;
  readonly signalId: SignalId;
  readonly totalScore: number;
  readonly vertical: Vertical;
}

export interface FeedbackSummarySnapshot {
  readonly actionCounts: FeedbackActionCounts;
  readonly deliveredRecommendations: number;
  readonly directActions: number;
  readonly evaluatedDeliveredRecommendations: number;
  readonly highScoreNotUseful: readonly HighScoreNotUsefulFeedback[];
  readonly recommendationsWithFeedback: number;
  readonly telegramActions: number;
}

export interface FeedbackReadRepository {
  summarizeForUser(userId: UserId, highScoreLimit: number): Promise<FeedbackSummarySnapshot>;
}

export interface FeedbackSummary {
  readonly actions: FeedbackActionCounts;
  readonly attribution: {
    readonly direct: number;
    readonly telegram: number;
  };
  readonly feedbackCoveragePercent: number;
  readonly generatedAt: string;
  readonly highScoreNotUseful: readonly HighScoreNotUsefulFeedback[];
  readonly positiveSentimentPercent: number | null;
  readonly totals: {
    readonly actions: number;
    readonly deliveredRecommendations: number;
    readonly evaluatedDeliveredRecommendations: number;
    readonly recommendationsWithFeedback: number;
  };
  readonly userId: UserId;
}

const percent = (numerator: number, denominator: number): number =>
  denominator === 0 ? 0 : Math.round((numerator / denominator) * 10_000) / 100;

export const getUserFeedbackSummary = async (input: {
  readonly callerUserId: UserId;
  readonly generatedAt: string;
  readonly highScoreLimit: number;
  readonly repository: FeedbackReadRepository;
  readonly userId: UserId;
}): Promise<FeedbackSummary> => {
  if (input.callerUserId !== input.userId) {
    throw new ApplicationApiError("FORBIDDEN", "Caller cannot access another user's feedback");
  }
  if (
    !Number.isInteger(input.highScoreLimit) ||
    input.highScoreLimit < 1 ||
    input.highScoreLimit > 100
  ) {
    throw new ApplicationApiError(
      "INVALID_INPUT",
      "Feedback summary limit must be between 1 and 100",
    );
  }

  const snapshot = await input.repository.summarizeForUser(input.userId, input.highScoreLimit);
  const sentimentTotal = snapshot.actionCounts.USEFUL + snapshot.actionCounts.NOT_USEFUL;
  const totalActions = FEEDBACK_ACTIONS.reduce(
    (total, action) => total + snapshot.actionCounts[action],
    0,
  );

  return Object.freeze({
    actions: Object.freeze({ ...snapshot.actionCounts }),
    attribution: Object.freeze({
      direct: snapshot.directActions,
      telegram: snapshot.telegramActions,
    }),
    feedbackCoveragePercent: percent(
      snapshot.evaluatedDeliveredRecommendations,
      snapshot.deliveredRecommendations,
    ),
    generatedAt: input.generatedAt,
    highScoreNotUseful: Object.freeze([...snapshot.highScoreNotUseful]),
    positiveSentimentPercent:
      sentimentTotal === 0 ? null : percent(snapshot.actionCounts.USEFUL, sentimentTotal),
    totals: Object.freeze({
      actions: totalActions,
      deliveredRecommendations: snapshot.deliveredRecommendations,
      evaluatedDeliveredRecommendations: snapshot.evaluatedDeliveredRecommendations,
      recommendationsWithFeedback: snapshot.recommendationsWithFeedback,
    }),
    userId: input.userId,
  });
};
