import {
  correlationId,
  createFeedback,
  deliveryId,
  feedbackId,
  recommendationId,
  userId,
  type Feedback,
} from "@radar/core";

import { type Feedback as FeedbackRecord, type Prisma } from "../generated/prisma/client.js";

export const feedbackToCreateData = (feedback: Feedback): Prisma.FeedbackCreateInput => ({
  action: feedback.action,
  correlationId: feedback.correlationId,
  createdAt: new Date(feedback.createdAt),
  deliveryId: feedback.deliveryId,
  id: feedback.id,
  reason: feedback.reason,
  recommendation: { connect: { id: feedback.recommendationId } },
  user: { connect: { id: feedback.userId } },
});

export const feedbackFromRecord = (record: FeedbackRecord): Feedback =>
  createFeedback({
    action: record.action,
    correlationId: correlationId(record.correlationId),
    createdAt: record.createdAt.toISOString(),
    deliveryId: record.deliveryId === null ? null : deliveryId(record.deliveryId),
    id: feedbackId(record.id),
    reason: record.reason,
    recommendationId: recommendationId(record.recommendationId),
    userId: userId(record.userId),
  });
