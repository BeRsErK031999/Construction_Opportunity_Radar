import {
  type Page,
  type SavedOpportunityRepository,
  type SignalListFilter,
  type SignalOpportunity,
  type SignalOpportunityRepository,
} from "@radar/application";
import { type SignalId, type UserId } from "@radar/core";

import { type DatabaseClient } from "../client.js";
import { PersistenceError } from "../errors.js";
import { type Prisma } from "../generated/prisma/client.js";
import { analysisFromRecord } from "../mappers/analysis-mapper.js";
import { recommendationFromRecord } from "../mappers/recommendation-mapper.js";
import { signalFromRecord } from "../mappers/signal-mapper.js";

export const signalOpportunityInclude = {
  analysis: { include: { sources: true } },
  signal: {
    include: {
      evidence: { include: { normalizedItem: true, source: true } },
    },
  },
  sources: true,
} as const;

export type SignalOpportunityRecord = Prisma.RecommendationGetPayload<{
  include: typeof signalOpportunityInclude;
}>;

export const signalOpportunityFromRecord = (record: SignalOpportunityRecord): SignalOpportunity => {
  const analysis = analysisFromRecord(record.analysis);
  if (analysis.status !== "SUCCEEDED") {
    throw new PersistenceError(
      "SIGNAL_OPPORTUNITY_MAPPING_FAILED",
      "A recommendation must reference a successful analysis",
    );
  }
  return Object.freeze({
    analysis,
    recommendation: recommendationFromRecord(record),
    signal: signalFromRecord(record.signal),
    sources: Object.freeze(
      record.signal.evidence.map((evidence) =>
        Object.freeze({
          canonicalUrl: evidence.normalizedItem.canonicalUrl,
          normalizedItemId: evidence.normalizedItemId,
          publishedAt: evidence.normalizedItem.publishedAt?.toISOString() ?? null,
          sourceId: evidence.sourceId as SignalOpportunity["sources"][number]["sourceId"],
          sourceName: evidence.source.name,
          sourceUrl: evidence.source.url,
        }),
      ),
    ),
  });
};

const signalWhere = (filter: SignalListFilter): Prisma.SignalWhereInput => ({
  ...(filter.category === undefined ? {} : { category: filter.category }),
  ...(filter.dateFrom === undefined && filter.dateTo === undefined
    ? {}
    : {
        createdAt: {
          ...(filter.dateFrom === undefined ? {} : { gte: new Date(filter.dateFrom) }),
          ...(filter.dateTo === undefined ? {} : { lte: new Date(filter.dateTo) }),
        },
      }),
  ...(filter.status === undefined ? {} : { status: filter.status }),
  ...(filter.vertical === undefined ? {} : { vertical: filter.vertical }),
});

export class PrismaSignalOpportunityRepository
  implements SavedOpportunityRepository, SignalOpportunityRepository
{
  readonly #client: DatabaseClient;

  constructor(client: DatabaseClient) {
    this.#client = client;
  }

  async #latestProfile(
    userId: UserId,
  ): Promise<{ readonly id: string; readonly revision: number } | null> {
    return this.#client.companyProfileRevision.findFirst({
      orderBy: [{ revision: "desc" }, { id: "asc" }],
      select: { id: true, revision: true },
      where: { userId },
    });
  }

  async findForUser(userId: UserId, signalId: SignalId): Promise<SignalOpportunity | null> {
    const profile = await this.#latestProfile(userId);
    if (profile === null) {
      return null;
    }
    const record = await this.#client.recommendation.findFirst({
      include: signalOpportunityInclude,
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      where: {
        signalId,
        userProfileId: profile.id,
        userProfileRevision: profile.revision,
      },
    });
    return record === null ? null : signalOpportunityFromRecord(record);
  }

  async listForUser(userId: UserId, filter: SignalListFilter): Promise<Page<SignalOpportunity>> {
    const profile = await this.#latestProfile(userId);
    if (profile === null) {
      return Object.freeze({ items: Object.freeze([]), nextCursor: null });
    }
    const records = await this.#client.recommendation.findMany({
      ...(filter.after === undefined ? {} : { cursor: { id: filter.after }, skip: 1 }),
      include: signalOpportunityInclude,
      orderBy: [{ totalScore: "desc" }, { createdAt: "desc" }, { id: "asc" }],
      take: filter.limit + 1,
      where: {
        ...(filter.minimumScore === undefined ? {} : { totalScore: { gte: filter.minimumScore } }),
        signal: signalWhere(filter),
        userProfileId: profile.id,
        userProfileRevision: profile.revision,
      },
    });
    const hasNextPage = records.length > filter.limit;
    const selected = records.slice(0, filter.limit);
    return Object.freeze({
      items: Object.freeze(selected.map(signalOpportunityFromRecord)),
      nextCursor: hasNextPage ? (selected.at(-1)?.id ?? null) : null,
    });
  }

  async listSavedForUser(userId: UserId, limit: number): Promise<readonly SignalOpportunity[]> {
    const records = await this.#client.recommendation.findMany({
      include: signalOpportunityInclude,
      orderBy: [{ totalScore: "desc" }, { createdAt: "desc" }, { id: "asc" }],
      take: limit,
      where: {
        feedback: { some: { action: "SAVED", userId } },
        userProfile: { userId },
      },
    });
    return Object.freeze(records.map(signalOpportunityFromRecord));
  }
}
