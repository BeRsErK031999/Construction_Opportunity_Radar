import { type RecommendationRepository, type RecommendationSaveResult } from "@radar/application";
import { type Recommendation } from "@radar/core";

import { type DatabaseClient } from "../client.js";
import { PersistenceError, RecommendationIdentityConflictError } from "../errors.js";
import { Prisma } from "../generated/prisma/client.js";
import {
  recommendationFromRecord,
  recommendationToCreateData,
} from "../mappers/recommendation-mapper.js";

const recommendationInclude = { sources: true } as const;
const comparable = (recommendation: Recommendation) => {
  const { createdAt, id, sourceIds, ...value } = recommendation;
  void createdAt;
  void id;
  return { ...value, sourceIds: [...sourceIds].sort() };
};

const compatible = (left: Recommendation, right: Recommendation): boolean =>
  JSON.stringify(comparable(left)) === JSON.stringify(comparable(right));

const identityWhere = (recommendation: Recommendation) => ({
  analysisId: recommendation.analysisId,
  scoringVersion: recommendation.scoringVersion,
  signalId: recommendation.signalId,
  userProfileId: recommendation.userProfileId,
  userProfileRevision: recommendation.userProfileRevision,
});

export class PrismaRecommendationRepository implements RecommendationRepository {
  readonly #client: DatabaseClient;

  constructor(client: DatabaseClient) {
    this.#client = client;
  }

  count(): Promise<number> {
    return this.#client.recommendation.count();
  }

  async save(recommendation: Recommendation): Promise<RecommendationSaveResult> {
    const existingRecord = await this.#client.recommendation.findUnique({
      include: recommendationInclude,
      where: {
        signalId_analysisId_userProfileId_userProfileRevision_scoringVersion:
          identityWhere(recommendation),
      },
    });
    if (existingRecord !== null) {
      const existing = recommendationFromRecord(existingRecord);
      if (!compatible(existing, recommendation)) {
        throw new RecommendationIdentityConflictError(
          `Recommendation identity for signal ${recommendation.signalId} already has different data`,
        );
      }
      return Object.freeze({ created: false, recommendation: existing });
    }

    try {
      const record = await this.#client.recommendation.create({
        data: recommendationToCreateData(recommendation),
        include: recommendationInclude,
      });
      return Object.freeze({ created: true, recommendation: recommendationFromRecord(record) });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const racedRecord = await this.#client.recommendation.findUnique({
          include: recommendationInclude,
          where: {
            signalId_analysisId_userProfileId_userProfileRevision_scoringVersion:
              identityWhere(recommendation),
          },
        });
        if (racedRecord !== null) {
          const raced = recommendationFromRecord(racedRecord);
          if (compatible(raced, recommendation)) {
            return Object.freeze({ created: false, recommendation: raced });
          }
        }
        throw new RecommendationIdentityConflictError(
          `Recommendation id ${recommendation.id} already belongs to different data`,
        );
      }
      if (error instanceof RecommendationIdentityConflictError) {
        throw error;
      }
      throw new PersistenceError(
        "RECOMMENDATION_SAVE_FAILED",
        "Unable to persist recommendation",
        error,
      );
    }
  }
}
