import {
  DigestWriteConflictError,
  type DigestBuildSnapshot,
  type DigestRepository,
  type DigestSaveResult,
  type DigestView,
} from "@radar/application";
import {
  digestIdentityKey,
  recommendationId,
  signalId,
  userProfileId,
  type Digest,
  type DigestId,
  type DigestKind,
  type UserId,
} from "@radar/core";

import { type DatabaseClient } from "../client.js";
import { PersistenceError } from "../errors.js";
import { Prisma } from "../generated/prisma/client.js";
import {
  digestFromRecord,
  digestRecordInclude,
  digestToCreateData,
} from "../mappers/digest-mapper.js";
import {
  signalOpportunityFromRecord,
  signalOpportunityInclude,
} from "./signal-opportunity-repository.js";

const candidateSelect = {
  band: true,
  createdAt: true,
  id: true,
  signal: { select: { category: true, id: true } },
  totalScore: true,
} as const;

export class PrismaDigestRepository implements DigestRepository {
  readonly #client: DatabaseClient;

  constructor(client: DatabaseClient) {
    this.#client = client;
  }

  async collectBuildSnapshot(input: {
    readonly periodEnd: string;
    readonly periodStart: string;
    readonly previousPeriodStart: string;
    readonly userId: UserId;
  }): Promise<DigestBuildSnapshot | null> {
    return this.#client.$transaction(
      async (transaction) => {
        const profile = await transaction.companyProfileRevision.findFirst({
          orderBy: [{ revision: "desc" }, { id: "asc" }],
          select: { id: true, revision: true },
          where: { userId: input.userId },
        });
        if (profile === null) {
          return null;
        }
        const period = {
          gte: new Date(input.periodStart),
          lt: new Date(input.periodEnd),
        };
        const previousPeriod = {
          gte: new Date(input.previousPeriodStart),
          lt: new Date(input.periodStart),
        };
        const candidateWhere = (createdAt: typeof period) => ({
          analysis: { status: "SUCCEEDED" as const },
          signal: { createdAt, status: { in: ["ACTIVE" as const, "CANDIDATE" as const] } },
          userProfileId: profile.id,
          userProfileRevision: profile.revision,
        });
        const [processed, unique, relevant, candidates, previousCandidates] = await Promise.all([
          transaction.rawItem.count({ where: { receivedAt: period } }),
          transaction.deduplicationAssignment.count({
            where: { createdAt: period, matchKind: "REPRESENTATIVE" },
          }),
          transaction.signal.count({
            where: { createdAt: period, status: { in: ["ACTIVE", "CANDIDATE"] } },
          }),
          transaction.recommendation.findMany({
            select: candidateSelect,
            where: candidateWhere(period),
          }),
          transaction.recommendation.findMany({
            select: candidateSelect,
            where: candidateWhere(previousPeriod),
          }),
        ]);
        const mapCandidate = (candidate: (typeof candidates)[number]) =>
          Object.freeze({
            band: candidate.band,
            category: candidate.signal.category,
            createdAt: candidate.createdAt.toISOString(),
            recommendationId: recommendationId(candidate.id),
            signalId: signalId(candidate.signal.id),
            totalScore: candidate.totalScore,
          });
        return Object.freeze({
          candidates: Object.freeze(candidates.map(mapCandidate)),
          previousCandidates: Object.freeze(previousCandidates.map(mapCandidate)),
          processed,
          relevant,
          unique,
          userProfileId: userProfileId(profile.id),
          userProfileRevision: profile.revision,
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  async findByIdentity(input: {
    readonly kind: DigestKind;
    readonly periodEnd: string;
    readonly periodStart: string;
    readonly userId: UserId;
    readonly version: string;
  }): Promise<Digest | null> {
    const record = await this.#client.digest.findUnique({
      include: digestRecordInclude,
      where: {
        userId_kind_periodStart_periodEnd_digestVersion: {
          digestVersion: input.version,
          kind: input.kind,
          periodEnd: new Date(input.periodEnd),
          periodStart: new Date(input.periodStart),
          userId: input.userId,
        },
      },
    });
    return record === null ? null : digestFromRecord(record);
  }

  async findView(id: DigestId): Promise<DigestView | null> {
    const record = await this.#client.digest.findUnique({
      include: {
        categoryTrends: { orderBy: { rank: "asc" } },
        items: {
          include: { recommendation: { include: signalOpportunityInclude } },
          orderBy: { rank: "asc" },
        },
      },
      where: { id },
    });
    if (record === null) {
      return null;
    }
    return Object.freeze({
      digest: digestFromRecord(record),
      items: Object.freeze(
        record.items.map((item) =>
          Object.freeze({
            opportunity: signalOpportunityFromRecord(item.recommendation),
            rank: item.rank,
          }),
        ),
      ),
    });
  }

  async save(digest: Digest): Promise<DigestSaveResult> {
    const byId = await this.#client.digest.findUnique({
      include: digestRecordInclude,
      where: { id: digest.id },
    });
    if (byId !== null) {
      const existing = digestFromRecord(byId);
      if (digestIdentityKey(existing) !== digestIdentityKey(digest)) {
        throw new DigestWriteConflictError("Digest identifier is attached to another period");
      }
      return Object.freeze({ created: false, digest: existing });
    }
    const existing = await this.findByIdentity({
      kind: digest.kind,
      periodEnd: digest.periodEnd,
      periodStart: digest.periodStart,
      userId: digest.userId,
      version: digest.version,
    });
    if (existing !== null) {
      return Object.freeze({ created: false, digest: existing });
    }
    try {
      const record = await this.#client.digest.create({
        data: digestToCreateData(digest),
        include: digestRecordInclude,
      });
      return Object.freeze({ created: true, digest: digestFromRecord(record) });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const raced = await this.findByIdentity({
          kind: digest.kind,
          periodEnd: digest.periodEnd,
          periodStart: digest.periodStart,
          userId: digest.userId,
          version: digest.version,
        });
        if (raced !== null) {
          return Object.freeze({ created: false, digest: raced });
        }
        throw new DigestWriteConflictError("Concurrent digest conflicts with this build");
      }
      if (error instanceof DigestWriteConflictError) {
        throw error;
      }
      throw new PersistenceError("DIGEST_SAVE_FAILED", "Unable to persist digest", error);
    }
  }
}
