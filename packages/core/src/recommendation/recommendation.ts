import { type RecommendedAction, createRecommendedAction } from "../analysis/analysis.js";
import {
  type AnalysisId,
  type CorrelationId,
  type RecommendationId,
  type SignalId,
  type SourceId,
  type UserProfileId,
} from "../shared/identifiers.js";
import { assertInvariant } from "../shared/invariant.js";
import {
  isoDateTime,
  nonEmptyString,
  positiveInteger,
  score,
  uniqueValues,
  version,
  type IsoDateTime,
  type Score,
  type Version,
} from "../shared/primitives.js";
import { type CreateRecommendedActionInput } from "../analysis/analysis.js";

export const OPPORTUNITY_BANDS = ["IGNORE", "LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
export type OpportunityBand = (typeof OPPORTUNITY_BANDS)[number];

export interface ScoreBreakdown {
  readonly actionability: Score;
  readonly businessImpact: Score;
  readonly companyFit: Score;
  readonly confidence: Score;
  readonly urgency: Score;
}

export interface CreateScoreBreakdownInput {
  readonly actionability: number;
  readonly businessImpact: number;
  readonly companyFit: number;
  readonly confidence: number;
  readonly urgency: number;
}

export interface Recommendation {
  readonly analysisId: AnalysisId;
  readonly band: OpportunityBand;
  readonly correlationId: CorrelationId;
  readonly createdAt: IsoDateTime;
  readonly explanation: string;
  readonly id: RecommendationId;
  readonly recommendedActions: readonly RecommendedAction[];
  readonly scoreBreakdown: ScoreBreakdown;
  readonly scoringVersion: Version;
  readonly signalId: SignalId;
  readonly sourceIds: readonly SourceId[];
  readonly totalScore: Score;
  readonly userProfileId: UserProfileId;
  readonly userProfileRevision: number;
}

export interface CreateRecommendationInput {
  readonly analysisId: AnalysisId;
  readonly band: OpportunityBand;
  readonly correlationId: CorrelationId;
  readonly createdAt: string;
  readonly explanation: string;
  readonly id: RecommendationId;
  readonly recommendedActions: readonly CreateRecommendedActionInput[];
  readonly scoreBreakdown: CreateScoreBreakdownInput;
  readonly scoringVersion: string;
  readonly signalId: SignalId;
  readonly sourceIds: readonly SourceId[];
  readonly totalScore: number;
  readonly userProfileId: UserProfileId;
  readonly userProfileRevision: number;
}

export const createScoreBreakdown = (input: CreateScoreBreakdownInput): ScoreBreakdown =>
  Object.freeze({
    actionability: score(input.actionability, "scoreBreakdown.actionability"),
    businessImpact: score(input.businessImpact, "scoreBreakdown.businessImpact"),
    companyFit: score(input.companyFit, "scoreBreakdown.companyFit"),
    confidence: score(input.confidence, "scoreBreakdown.confidence"),
    urgency: score(input.urgency, "scoreBreakdown.urgency"),
  });

export const createRecommendation = (input: CreateRecommendationInput): Recommendation => {
  assertInvariant(
    input.recommendedActions.length >= 2 && input.recommendedActions.length <= 5,
    "INVALID_RECOMMENDED_ACTION_COUNT",
    "recommendedActions must contain between two and five actions",
  );
  const recommendedActions = input.recommendedActions.map(createRecommendedAction);
  const normalizedTitles = recommendedActions.map((action) => action.title.toLocaleLowerCase("ru"));
  assertInvariant(
    new Set(normalizedTitles).size === normalizedTitles.length,
    "DUPLICATE_RECOMMENDED_ACTION",
    "recommendedActions must have unique titles",
  );

  return Object.freeze({
    analysisId: input.analysisId,
    band: input.band,
    correlationId: input.correlationId,
    createdAt: isoDateTime(input.createdAt, "createdAt"),
    explanation: nonEmptyString(input.explanation, "explanation", 4_000),
    id: input.id,
    recommendedActions: Object.freeze(recommendedActions),
    scoreBreakdown: createScoreBreakdown(input.scoreBreakdown),
    scoringVersion: version(input.scoringVersion, "scoringVersion"),
    signalId: input.signalId,
    sourceIds: uniqueValues(input.sourceIds, "sourceIds", 1),
    totalScore: score(input.totalScore, "totalScore"),
    userProfileId: input.userProfileId,
    userProfileRevision: positiveInteger(input.userProfileRevision, "userProfileRevision"),
  });
};

export const recommendationIdentityKey = (recommendation: Recommendation): string =>
  JSON.stringify([
    recommendation.signalId,
    recommendation.analysisId,
    recommendation.userProfileId,
    recommendation.userProfileRevision,
    recommendation.scoringVersion,
  ]);
