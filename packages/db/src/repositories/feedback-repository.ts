import {
  FeedbackWriteConflictError,
  type FeedbackRepository,
  type FeedbackSaveResult,
  type RecommendationFeedbackContext,
} from "@radar/application";
import {
  correlationId,
  recommendationId,
  type Feedback,
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

export class PrismaFeedbackRepository implements FeedbackRepository {
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
        throw new FeedbackWriteConflictError("Concurrent feedback conflicts with this action");
      }
      if (error instanceof FeedbackWriteConflictError) {
        throw error;
      }
      throw new PersistenceError("FEEDBACK_SAVE_FAILED", "Unable to persist feedback", error);
    }
  }
}
