import { assertInvariant } from "./invariant.js";

declare const brand: unique symbol;

type Identifier<Name extends string> = string & { readonly [brand]: Name };

export type AnalysisId = Identifier<"AnalysisId">;
export type CorrelationId = Identifier<"CorrelationId">;
export type DeliveryId = Identifier<"DeliveryId">;
export type FactId = Identifier<"FactId">;
export type FeedbackId = Identifier<"FeedbackId">;
export type InferenceId = Identifier<"InferenceId">;
export type NormalizedItemId = Identifier<"NormalizedItemId">;
export type RawItemId = Identifier<"RawItemId">;
export type RecommendationId = Identifier<"RecommendationId">;
export type SignalId = Identifier<"SignalId">;
export type SourceId = Identifier<"SourceId">;
export type UserId = Identifier<"UserId">;
export type UserProfileId = Identifier<"UserProfileId">;

const identifier = (value: string, field: string): string => {
  const normalized = value.trim();
  assertInvariant(normalized.length > 0, "EMPTY_IDENTIFIER", `${field} must not be empty`);
  assertInvariant(normalized.length <= 200, "IDENTIFIER_TOO_LONG", `${field} is too long`);
  return normalized;
};

export const analysisId = (value: string): AnalysisId =>
  identifier(value, "analysisId") as AnalysisId;
export const correlationId = (value: string): CorrelationId =>
  identifier(value, "correlationId") as CorrelationId;
export const deliveryId = (value: string): DeliveryId =>
  identifier(value, "deliveryId") as DeliveryId;
export const factId = (value: string): FactId => identifier(value, "factId") as FactId;
export const feedbackId = (value: string): FeedbackId =>
  identifier(value, "feedbackId") as FeedbackId;
export const inferenceId = (value: string): InferenceId =>
  identifier(value, "inferenceId") as InferenceId;
export const normalizedItemId = (value: string): NormalizedItemId =>
  identifier(value, "normalizedItemId") as NormalizedItemId;
export const rawItemId = (value: string): RawItemId => identifier(value, "rawItemId") as RawItemId;
export const recommendationId = (value: string): RecommendationId =>
  identifier(value, "recommendationId") as RecommendationId;
export const signalId = (value: string): SignalId => identifier(value, "signalId") as SignalId;
export const sourceId = (value: string): SourceId => identifier(value, "sourceId") as SourceId;
export const userId = (value: string): UserId => identifier(value, "userId") as UserId;
export const userProfileId = (value: string): UserProfileId =>
  identifier(value, "userProfileId") as UserProfileId;
