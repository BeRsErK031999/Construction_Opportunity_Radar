import {
  correlationId,
  createDigest,
  digestId,
  recommendationId,
  userId,
  userProfileId,
  type Digest,
} from "@radar/core";

import { type Prisma } from "../generated/prisma/client.js";

export const digestRecordInclude = {
  categoryTrends: { orderBy: { rank: "asc" as const } },
  items: { orderBy: { rank: "asc" as const } },
} as const;

export type DigestRecord = Prisma.DigestGetPayload<{ include: typeof digestRecordInclude }>;

export const digestToCreateData = (digest: Digest): Prisma.DigestCreateInput => ({
  categoryTrends: {
    create: (digest.weeklySummary?.categoryTrends ?? []).map((trend) => ({
      category: trend.category,
      currentCount: trend.currentCount,
      delta: trend.delta,
      previousCount: trend.previousCount,
      rank: trend.rank,
    })),
  },
  correlationId: digest.correlationId,
  createdAt: new Date(digest.createdAt),
  digestVersion: digest.version,
  highPriorityCount: digest.weeklySummary?.highPriority ?? null,
  id: digest.id,
  items: {
    create: digest.items.map((item) => ({
      rank: item.rank,
      recommendation: { connect: { id: item.recommendationId } },
    })),
  },
  kind: digest.kind,
  opportunityCount: digest.weeklySummary?.opportunities ?? null,
  periodEnd: new Date(digest.periodEnd),
  periodStart: new Date(digest.periodStart),
  processedCount: digest.weeklySummary?.processed ?? null,
  relevantCount: digest.weeklySummary?.relevant ?? null,
  uniqueCount: digest.weeklySummary?.unique ?? null,
  user: { connect: { id: digest.userId } },
  userProfile: {
    connect: {
      id_revision: { id: digest.userProfileId, revision: digest.userProfileRevision },
    },
  },
});

export const digestFromRecord = (record: DigestRecord): Digest =>
  createDigest({
    correlationId: correlationId(record.correlationId),
    createdAt: record.createdAt.toISOString(),
    id: digestId(record.id),
    items: record.items.map((item) => ({
      rank: item.rank,
      recommendationId: recommendationId(item.recommendationId),
    })),
    kind: record.kind,
    periodEnd: record.periodEnd.toISOString(),
    periodStart: record.periodStart.toISOString(),
    userId: userId(record.userId),
    userProfileId: userProfileId(record.userProfileId),
    userProfileRevision: record.userProfileRevision,
    version: record.digestVersion,
    ...(record.kind === "WEEKLY"
      ? {
          weeklySummary: {
            categoryTrends: record.categoryTrends.map((trend) => ({
              category: trend.category,
              currentCount: trend.currentCount,
              delta: trend.delta,
              previousCount: trend.previousCount,
              rank: trend.rank,
            })),
            highPriority: record.highPriorityCount ?? -1,
            opportunities: record.opportunityCount ?? -1,
            processed: record.processedCount ?? -1,
            relevant: record.relevantCount ?? -1,
            unique: record.uniqueCount ?? -1,
          },
        }
      : {}),
  });
