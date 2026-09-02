import { type DeduplicationRepository, type DeduplicationSaveResult } from "@radar/application";
import {
  isoDateTime,
  normalizedItemId,
  sourceId,
  type DeduplicationAssignment,
  type DeduplicationCandidate,
  type DeduplicationResult,
} from "@radar/core";

import { type DatabaseClient } from "../client.js";
import { DeduplicationIdentityConflictError, PersistenceError } from "../errors.js";
import { Prisma } from "../generated/prisma/client.js";
import { normalizedItemFromRecord } from "../mappers/normalized-item-mapper.js";

const candidateInclude = { rawItem: { include: { source: true } } } as const;

const assignmentData = (assignment: DeduplicationAssignment, createdAt: Date) => ({
  createdAt,
  deduplicatorVersion: assignment.deduplicatorVersion,
  matchKind: assignment.matchKind,
  matchedToNormalizedItemId: assignment.matchedToNormalizedItemId,
  normalizedItemId: assignment.normalizedItemId,
  representativeNormalizedItemId: assignment.representativeNormalizedItemId,
  similarity: assignment.similarity,
  timeDistanceHours: assignment.timeDistanceHours,
});

const compatible = (
  existing: {
    readonly matchKind: string;
    readonly matchedToNormalizedItemId: string;
    readonly representativeNormalizedItemId: string;
    readonly similarity: number;
    readonly timeDistanceHours: number;
  },
  candidate: DeduplicationAssignment,
): boolean =>
  existing.matchKind === candidate.matchKind &&
  existing.matchedToNormalizedItemId === candidate.matchedToNormalizedItemId &&
  existing.representativeNormalizedItemId === candidate.representativeNormalizedItemId &&
  existing.similarity === candidate.similarity &&
  existing.timeDistanceHours === candidate.timeDistanceHours;

export class PrismaDeduplicationRepository implements DeduplicationRepository {
  readonly #client: DatabaseClient;

  constructor(client: DatabaseClient) {
    this.#client = client;
  }

  countAssignments(version: string): Promise<number> {
    return this.#client.deduplicationAssignment.count({
      where: { deduplicatorVersion: version },
    });
  }

  async countClusters(version: string): Promise<number> {
    const clusters = await this.#client.deduplicationAssignment.groupBy({
      by: ["representativeNormalizedItemId"],
      where: { deduplicatorVersion: version },
    });
    return clusters.length;
  }

  async listCandidates(options: {
    readonly limit?: number;
    readonly normalizerVersion: string;
  }): Promise<readonly DeduplicationCandidate[]> {
    const limit = options.limit ?? 1_000;
    if (!Number.isInteger(limit) || limit < 1 || limit > 10_000) {
      throw new RangeError("limit must be an integer between 1 and 10000");
    }
    const records = await this.#client.normalizedItem.findMany({
      include: candidateInclude,
      orderBy: [{ publishedAt: "asc" }, { createdAt: "asc" }, { id: "asc" }],
      take: limit,
      where: { normalizerVersion: options.normalizerVersion },
    });
    return Object.freeze(
      records.map((record) =>
        Object.freeze({
          normalizedItem: normalizedItemFromRecord(record),
          sourceExternalId: record.rawItem.externalId,
          sourceId: sourceId(record.rawItem.sourceId),
          verticals: Object.freeze([...record.rawItem.source.verticals]),
        }),
      ),
    );
  }

  async save(result: DeduplicationResult, createdAt: string): Promise<DeduplicationSaveResult> {
    const canonicalCreatedAt = new Date(isoDateTime(createdAt, "createdAt"));
    const ids = result.assignments.map((assignment) => assignment.normalizedItemId);
    const existingRecords = await this.#client.deduplicationAssignment.findMany({
      where: {
        deduplicatorVersion: result.version,
        normalizedItemId: { in: ids },
      },
    });
    const existingById = new Map(
      existingRecords.map((record) => [normalizedItemId(record.normalizedItemId), record]),
    );
    const newAssignments = result.assignments.filter((assignment) => {
      const existing = existingById.get(assignment.normalizedItemId);
      if (existing === undefined) {
        return true;
      }
      if (!compatible(existing, assignment)) {
        throw new DeduplicationIdentityConflictError(
          `Deduplication identity ${assignment.normalizedItemId}/${assignment.deduplicatorVersion} already has different evidence`,
        );
      }
      return false;
    });

    try {
      if (newAssignments.length > 0) {
        await this.#client.deduplicationAssignment.createMany({
          data: newAssignments.map((assignment) => assignmentData(assignment, canonicalCreatedAt)),
        });
      }
    } catch (error) {
      if (error instanceof DeduplicationIdentityConflictError) {
        throw error;
      }
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const racedRecords = await this.#client.deduplicationAssignment.findMany({
          where: {
            deduplicatorVersion: result.version,
            normalizedItemId: { in: ids },
          },
        });
        const candidateById = new Map(
          result.assignments.map((assignment) => [assignment.normalizedItemId, assignment]),
        );
        if (
          racedRecords.length === result.assignments.length &&
          racedRecords.every((record) => {
            const candidate = candidateById.get(normalizedItemId(record.normalizedItemId));
            return candidate !== undefined && compatible(record, candidate);
          })
        ) {
          return Object.freeze({
            assignments: result.assignments.length,
            clusters: result.metrics.clusters,
            created: 0,
            existing: result.assignments.length,
            version: result.version,
          });
        }
        throw new DeduplicationIdentityConflictError(
          "Concurrent deduplication wrote an assignment for the same item and version",
        );
      }
      throw new PersistenceError(
        "DEDUPLICATION_SAVE_FAILED",
        "Unable to persist deduplication assignments",
        error,
      );
    }

    return Object.freeze({
      assignments: result.assignments.length,
      clusters: result.metrics.clusters,
      created: newAssignments.length,
      existing: result.assignments.length - newAssignments.length,
      version: result.version,
    });
  }
}
