import {
  FeedbackWriteConflictError,
  type FeedbackReadRepository,
  type FeedbackRepository,
  type FeedbackSaveResult,
  type FeedbackSummarySnapshot,
  type HighScoreNotUsefulFeedback,
  type RecommendationFeedbackContext,
} from "@radar/application";
import {
  correlationId,
  deliveryId,
  FEEDBACK_ACTIONS,
  feedbackId,
  recommendationId,
  signalId,
  type Feedback,
  type FeedbackAction,
  type SignalId,
  type UserId,
} from "@radar/core";

import { type DatabaseClient } from "../client.js";
import { PersistenceError } from "../errors.js";
import { Prisma } from "../generated/prisma/client.js";
import { feedbackFromRecord, feedbackToCreateData } from "../mappers/feedback-mapper.js";

const compatible = (left: Feedback, right: Feedback): boolean =>
  left.action === right.action &&
  left.correlationId === right.correlationId &&
  left.deliveryId === right.deliveryId &&
  left.id === right.id &&
  left.reason === right.reason &&
  left.recommendationId === right.recommendationId &&
  left.userId === right.userId;

export class PrismaFeedbackRepository implements FeedbackRepository, FeedbackReadRepository {
  readonly #client: DatabaseClient;

  constructor(client: DatabaseClient) {
    this.#client = client;
  }

  async findRecommendationForUser(
    userId: UserId,
    signalId: SignalId,
  ): Promise<RecommendationFeedbackContext | null> {
    const record = await this.#client.recommendation.findFirst({
      orderBy: [{ userProfileRevision: "desc" }, { createdAt: "desc" }, { id: "asc" }],
      select: { correlationId: true, id: true },
      where: { signalId, userProfile: { userId } },
    });
    return record === null
      ? null
      : Object.freeze({
          correlationId: correlationId(record.correlationId),
          recommendationId: recommendationId(record.id),
        });
  }

  async summarizeForUser(userId: UserId, highScoreLimit: number): Promise<FeedbackSummarySnapshot> {
    const [actionGroups, directActions, telegramActions, delivered, recommendations, highScore] =
      await Promise.all([
        this.#client.feedback.groupBy({
          _count: { _all: true },
          by: ["action"],
          where: { userId },
        }),
        this.#client.feedback.count({ where: { deliveryId: null, userId } }),
        this.#client.feedback.count({ where: { deliveryId: { not: null }, userId } }),
        this.#client.delivery.findMany({
          distinct: ["recommendationId"],
          select: { recommendationId: true },
          where: { status: "SENT", userId },
        }),
        this.#client.feedback.findMany({
          distinct: ["recommendationId"],
          select: { recommendationId: true },
          where: { userId },
        }),
        this.#client.feedback.findMany({
          orderBy: [
            { recommendation: { totalScore: "desc" } },
            { createdAt: "desc" },
            { id: "asc" },
          ],
          select: {
            correlationId: true,
            createdAt: true,
            deliveryId: true,
            id: true,
            reason: true,
            recommendation: {
              select: {
                analysis: { select: { headline: true } },
                band: true,
                id: true,
                signal: { select: { id: true, vertical: true } },
                totalScore: true,
              },
            },
          },
          take: highScoreLimit,
          where: {
            action: "NOT_USEFUL",
            recommendation: {
              analysis: { status: "SUCCEEDED" },
              band: { in: ["HIGH", "CRITICAL"] },
            },
            userId,
          },
        }),
      ]);

    const actionCounts: Record<FeedbackAction, number> = {
      ACTED: 0,
      ALREADY_KNOWN: 0,
      NOT_USEFUL: 0,
      SAVED: 0,
      USEFUL: 0,
    };
    for (const action of FEEDBACK_ACTIONS) {
      actionCounts[action] =
        actionGroups.find((group) => group.action === action)?._count._all ?? 0;
    }

    const deliveredRecommendationIds = delivered.map((item) => item.recommendationId);
    const evaluatedDelivered =
      deliveredRecommendationIds.length === 0
        ? []
        : await this.#client.feedback.findMany({
            distinct: ["recommendationId"],
            select: { recommendationId: true },
            where: { recommendationId: { in: deliveredRecommendationIds }, userId },
          });
    const highScoreNotUseful: HighScoreNotUsefulFeedback[] = highScore.map((item) => {
      const headline = item.recommendation.analysis.headline;
      if (headline === null) {
        throw new PersistenceError(
          "FEEDBACK_SUMMARY_INVALID_DATA",
          "High-score feedback references analysis without a headline",
        );
      }
      return Object.freeze({
        attribution: item.deliveryId === null ? "DIRECT" : "TELEGRAM",
        band: item.recommendation.band,
        correlationId: correlationId(item.correlationId),
        deliveryId: item.deliveryId === null ? null : deliveryId(item.deliveryId),
        feedbackAt: item.createdAt.toISOString(),
        feedbackId: feedbackId(item.id),
        headline,
        reason: item.reason,
        recommendationId: recommendationId(item.recommendation.id),
        signalId: signalId(item.recommendation.signal.id),
        totalScore: item.recommendation.totalScore,
        vertical: item.recommendation.signal.vertical,
      });
    });

    return Object.freeze({
      actionCounts: Object.freeze(actionCounts),
      deliveredRecommendations: delivered.length,
      directActions,
      evaluatedDeliveredRecommendations: evaluatedDelivered.length,
      highScoreNotUseful: Object.freeze(highScoreNotUseful),
      recommendationsWithFeedback: recommendations.length,
      telegramActions,
    });
  }

  async save(feedback: Feedback): Promise<FeedbackSaveResult> {
    const byId = await this.#client.feedback.findUnique({ where: { id: feedback.id } });
    if (byId !== null) {
      const existing = feedbackFromRecord(byId);
      if (!compatible(existing, feedback)) {
        throw new FeedbackWriteConflictError("Feedback id is already attached to another action");
      }
      return Object.freeze({ created: false, feedback: existing });
    }

    const byAction = await this.#client.feedback.findUnique({
      where: {
        userId_recommendationId_action: {
          action: feedback.action,
          recommendationId: feedback.recommendationId,
          userId: feedback.userId,
        },
      },
    });
    if (byAction !== null) {
      return Object.freeze({ created: false, feedback: feedbackFromRecord(byAction) });
    }
    if (feedback.action === "USEFUL" || feedback.action === "NOT_USEFUL") {
      const sentiment = await this.#client.feedback.findFirst({
        where: {
          action: { in: ["NOT_USEFUL", "USEFUL"] },
          recommendationId: feedback.recommendationId,
          userId: feedback.userId,
        },
      });
      if (sentiment !== null) {
        throw new FeedbackWriteConflictError(
          "A sentiment response already exists for this recommendation",
        );
      }
    }

    try {
      const record = await this.#client.feedback.create({ data: feedbackToCreateData(feedback) });
      return Object.freeze({ created: true, feedback: feedbackFromRecord(record) });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const raced = await this.#client.feedback.findUnique({ where: { id: feedback.id } });
        if (raced !== null && compatible(feedbackFromRecord(raced), feedback)) {
          return Object.freeze({ created: false, feedback: feedbackFromRecord(raced) });
        }
        const racedByAction = await this.#client.feedback.findUnique({
          where: {
            userId_recommendationId_action: {
              action: feedback.action,
              recommendationId: feedback.recommendationId,
              userId: feedback.userId,
            },
          },
        });
        if (racedByAction !== null) {
          return Object.freeze({ created: false, feedback: feedbackFromRecord(racedByAction) });
        }
        throw new FeedbackWriteConflictError("Concurrent feedback conflicts with this action");
      }
      if (error instanceof FeedbackWriteConflictError) {
        throw error;
      }
      throw new PersistenceError("FEEDBACK_SAVE_FAILED", "Unable to persist feedback", error);
    }
  }
}
