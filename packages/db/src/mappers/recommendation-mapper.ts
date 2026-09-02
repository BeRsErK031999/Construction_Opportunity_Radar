import {
  RECOMMENDED_ACTION_KINDS,
  analysisId,
  correlationId,
  createRecommendation,
  recommendationId,
  signalId,
  sourceId,
  userProfileId,
  type JsonValue,
  type Recommendation,
  type RecommendedActionKind,
} from "@radar/core";

import { PersistenceError } from "../errors.js";
import {
  type Prisma,
  type Recommendation as RecommendationRecord,
  type RecommendationSource as RecommendationSourceRecord,
} from "../generated/prisma/client.js";

export type RecommendationWithSources = RecommendationRecord & {
  readonly sources: readonly RecommendationSourceRecord[];
};

const mappingError = (field: string): never => {
  throw new PersistenceError(
    "RECOMMENDATION_MAPPING_FAILED",
    `Recommendation ${field} has an invalid shape`,
  );
};

const actionsFromJson = (value: unknown): Recommendation["recommendedActions"] => {
  const cloned = structuredClone(value) as JsonValue;
  if (!Array.isArray(cloned)) {
    return mappingError("recommendedActions");
  }
  return cloned.map((value, index) => {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return mappingError(`recommendedActions[${String(index)}]`);
    }
    const { kind, priority, rationale, title } = value;
    if (
      typeof kind !== "string" ||
      !RECOMMENDED_ACTION_KINDS.includes(kind as RecommendedActionKind) ||
      typeof priority !== "number" ||
      typeof rationale !== "string" ||
      typeof title !== "string"
    ) {
      return mappingError(`recommendedActions[${String(index)}]`);
    }
    return { kind: kind as RecommendedActionKind, priority, rationale, title };
  });
};

export const recommendationToCreateData = (
  recommendation: Recommendation,
): Prisma.RecommendationCreateInput => ({
  actionability: recommendation.scoreBreakdown.actionability,
  analysis: {
    connect: { id_signalId: { id: recommendation.analysisId, signalId: recommendation.signalId } },
  },
  band: recommendation.band,
  businessImpact: recommendation.scoreBreakdown.businessImpact,
  companyFit: recommendation.scoreBreakdown.companyFit,
  confidence: recommendation.scoreBreakdown.confidence,
  correlationId: recommendation.correlationId,
  createdAt: new Date(recommendation.createdAt),
  explanation: recommendation.explanation,
  id: recommendation.id,
  recommendedActions: structuredClone(
    recommendation.recommendedActions,
  ) as unknown as Prisma.InputJsonValue,
  scoringVersion: recommendation.scoringVersion,
  signal: { connect: { id: recommendation.signalId } },
  sources: { create: recommendation.sourceIds.map((id) => ({ sourceId: id })) },
  totalScore: recommendation.totalScore,
  urgency: recommendation.scoreBreakdown.urgency,
  userProfile: {
    connect: {
      id_revision: {
        id: recommendation.userProfileId,
        revision: recommendation.userProfileRevision,
      },
    },
  },
});

export const recommendationFromRecord = (record: RecommendationWithSources): Recommendation =>
  createRecommendation({
    analysisId: analysisId(record.analysisId),
    band: record.band,
    correlationId: correlationId(record.correlationId),
    createdAt: record.createdAt.toISOString(),
    explanation: record.explanation,
    id: recommendationId(record.id),
    recommendedActions: actionsFromJson(record.recommendedActions),
    scoreBreakdown: {
      actionability: record.actionability,
      businessImpact: record.businessImpact,
      companyFit: record.companyFit,
      confidence: record.confidence,
      urgency: record.urgency,
    },
    scoringVersion: record.scoringVersion,
    signalId: signalId(record.signalId),
    sourceIds: record.sources.map(({ sourceId: id }) => sourceId(id)),
    totalScore: record.totalScore,
    userProfileId: userProfileId(record.userProfileId),
    userProfileRevision: record.userProfileRevision,
  });
