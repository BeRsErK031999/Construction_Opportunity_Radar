import {
  type CorrelationId,
  type DeliveryId,
  type FeedbackId,
  type RecommendationId,
  type UserId,
} from "../shared/identifiers.js";
import { isoDateTime, optionalString, type IsoDateTime } from "../shared/primitives.js";

export const FEEDBACK_ACTIONS = [
  "USEFUL",
  "NOT_USEFUL",
  "SAVED",
  "ACTED",
  "ALREADY_KNOWN",
] as const;
export type FeedbackAction = (typeof FEEDBACK_ACTIONS)[number];

export interface Feedback {
  readonly action: FeedbackAction;
  readonly correlationId: CorrelationId;
  readonly createdAt: IsoDateTime;
  readonly deliveryId: DeliveryId | null;
  readonly id: FeedbackId;
  readonly reason: string | null;
  readonly recommendationId: RecommendationId;
  readonly userId: UserId;
}

export interface CreateFeedbackInput {
  readonly action: FeedbackAction;
  readonly correlationId: CorrelationId;
  readonly createdAt: string;
  readonly deliveryId?: DeliveryId | null;
  readonly id: FeedbackId;
  readonly reason?: string | null;
  readonly recommendationId: RecommendationId;
  readonly userId: UserId;
}

export const createFeedback = (input: CreateFeedbackInput): Feedback =>
  Object.freeze({
    action: input.action,
    correlationId: input.correlationId,
    createdAt: isoDateTime(input.createdAt, "createdAt"),
    deliveryId: input.deliveryId ?? null,
    id: input.id,
    reason: optionalString(input.reason, "reason", 2_000),
    recommendationId: input.recommendationId,
    userId: input.userId,
  });

export const feedbackIdentityKey = (feedback: Feedback): string =>
  JSON.stringify([feedback.userId, feedback.recommendationId, feedback.action]);

export const feedbackSentimentKey = (feedback: Feedback): string | null =>
  feedback.action === "USEFUL" || feedback.action === "NOT_USEFUL"
    ? JSON.stringify([feedback.userId, feedback.recommendationId, "SENTIMENT"])
    : null;
