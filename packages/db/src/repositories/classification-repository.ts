import {
  type ClassificationSaveResult,
  type ClassificationSignalRepository,
  type PersistableClassifiedSignal,
} from "@radar/application";
import {
  normalizedItemId,
  type ClassificationCandidate,
  type ClassificationEvidence,
  type Signal,
} from "@radar/core";

import { type DatabaseClient } from "../client.js";
import { ClassificationIdentityConflictError, PersistenceError } from "../errors.js";
import { Prisma } from "../generated/prisma/client.js";
import { normalizedItemFromRecord } from "../mappers/normalized-item-mapper.js";
import { signalFromRecord, type SignalWithEvidence } from "../mappers/signal-mapper.js";
import { sourceFromRecord } from "../mappers/source-mapper.js";

const signalInclude = { evidence: true } as const;
const classificationCandidateInclude = {
  normalizedItem: { include: { rawItem: { include: { source: true } } } },
} as const;

const signalData = (candidate: PersistableClassifiedSignal) => ({
  category: candidate.signal.category,
  classificationConfidence: candidate.signal.classificationConfidence,
  classificationRuleIds: [...candidate.signal.classificationRuleIds],
  classifierVersion: candidate.signal.classifierVersion,
  correlationId: candidate.signal.correlationId,
  createdAt: new Date(candidate.signal.createdAt),
  deduplicationRepresentativeNormalizedItemId:
    candidate.signal.deduplicationRepresentativeNormalizedItemId,
  deduplicatorVersion: candidate.signal.deduplicatorVersion,
  evidence: {
    create: candidate.decision.aiInputEvidence.map((evidence) => ({
      normalizedItemId: evidence.normalizedItemId,
      sourceId: evidence.sourceId,
    })),
  },
  id: candidate.signal.id,
  relevanceScore: candidate.signal.relevanceScore,
  status: candidate.signal.status,
  supersededBySignalId: candidate.signal.supersededBySignalId,
  taxonomyVersion: candidate.signal.taxonomyVersion,
  updatedAt: new Date(candidate.signal.updatedAt),
  vertical: candidate.signal.vertical,
});

const evidenceKeys = (candidate: PersistableClassifiedSignal): readonly string[] =>
  candidate.decision.aiInputEvidence
    .map((evidence) => JSON.stringify([evidence.normalizedItemId, evidence.sourceId]))
    .sort();

const recordEvidenceKeys = (record: SignalWithEvidence): readonly string[] =>
  record.evidence
    .map((evidence) => JSON.stringify([evidence.normalizedItemId, evidence.sourceId]))
    .sort();

const sameStringList = (left: readonly string[], right: readonly string[]): boolean =>
  left.length === right.length && left.every((value, index) => value === right[index]);

const compatible = (
  record: SignalWithEvidence,
  candidate: PersistableClassifiedSignal,
): boolean => {
  const existing = signalFromRecord(record);
  const signal = candidate.signal;
  return (
    existing.category === signal.category &&
    existing.classificationConfidence === signal.classificationConfidence &&
    sameStringList(existing.classificationRuleIds, signal.classificationRuleIds) &&
    existing.classifierVersion === signal.classifierVersion &&
    existing.correlationId === signal.correlationId &&
    existing.deduplicationRepresentativeNormalizedItemId ===
      signal.deduplicationRepresentativeNormalizedItemId &&
    existing.deduplicatorVersion === signal.deduplicatorVersion &&
    existing.relevanceScore === signal.relevanceScore &&
    existing.status === signal.status &&
    existing.taxonomyVersion === signal.taxonomyVersion &&
    existing.vertical === signal.vertical &&
    sameStringList(recordEvidenceKeys(record), evidenceKeys(candidate))
  );
};

const assertCompatible = (
  record: SignalWithEvidence,
  candidate: PersistableClassifiedSignal,
): void => {
  if (!compatible(record, candidate)) {
    throw new ClassificationIdentityConflictError(
      `Classification signal identity ${candidate.signal.id} already has different evidence`,
    );
  }
};

export class PrismaClassificationRepository implements ClassificationSignalRepository {
  readonly #client: DatabaseClient;

  constructor(client: DatabaseClient) {
    this.#client = client;
  }

  countSignals(classifierVersion: string): Promise<number> {
    return this.#client.signal.count({ where: { classifierVersion } });
  }

  async listCandidates(options: {
    readonly deduplicatorVersion: string;
    readonly limit?: number;
  }): Promise<readonly ClassificationCandidate[]> {
    const limit = options.limit ?? 1_000;
    if (!Number.isInteger(limit) || limit < 1 || limit > 10_000) {
      throw new RangeError("limit must be an integer between 1 and 10000");
    }
    const representatives = await this.#client.deduplicationAssignment.findMany({
      orderBy: { representativeNormalizedItemId: "asc" },
      select: { representativeNormalizedItemId: true },
      take: limit,
      where: {
        deduplicatorVersion: options.deduplicatorVersion,
        matchKind: "REPRESENTATIVE",
      },
    });
    const representativeIds = representatives.map(
      (assignment) => assignment.representativeNormalizedItemId,
    );
    if (representativeIds.length === 0) {
      return Object.freeze([]);
    }
    const assignments = await this.#client.deduplicationAssignment.findMany({
      include: classificationCandidateInclude,
      orderBy: [{ representativeNormalizedItemId: "asc" }, { normalizedItemId: "asc" }],
      where: {
        deduplicatorVersion: options.deduplicatorVersion,
        representativeNormalizedItemId: { in: representativeIds },
      },
    });
    const evidenceByRepresentative = new Map<string, ClassificationEvidence[]>();
    for (const assignment of assignments) {
      const evidence = evidenceByRepresentative.get(assignment.representativeNormalizedItemId);
      const member = Object.freeze({
        normalizedItem: normalizedItemFromRecord(assignment.normalizedItem),
        source: sourceFromRecord(assignment.normalizedItem.rawItem.source),
      });
      if (evidence === undefined) {
        evidenceByRepresentative.set(assignment.representativeNormalizedItemId, [member]);
      } else {
        evidence.push(member);
      }
    }

    return Object.freeze(
      representativeIds.map((representativeId) =>
        Object.freeze({
          deduplicatorVersion: options.deduplicatorVersion,
          evidence: Object.freeze(evidenceByRepresentative.get(representativeId) ?? []),
          representativeNormalizedItemId: normalizedItemId(representativeId),
        }),
      ),
    );
  }

  async save(
    candidates: readonly PersistableClassifiedSignal[],
  ): Promise<ClassificationSaveResult> {
    if (candidates.length === 0) {
      return Object.freeze({ created: 0, existing: 0, signals: 0 });
    }
    const ids = candidates.map((candidate) => candidate.signal.id);
    const existingRecords = await this.#client.signal.findMany({
      include: signalInclude,
      where: { id: { in: ids } },
    });
    const candidatesById = new Map(candidates.map((candidate) => [candidate.signal.id, candidate]));
    for (const record of existingRecords) {
      const candidate = candidatesById.get(record.id as Signal["id"]);
      if (candidate !== undefined) {
        assertCompatible(record, candidate);
      }
    }
    const existingIds = new Set(existingRecords.map((record) => record.id));
    const newCandidates = candidates.filter((candidate) => !existingIds.has(candidate.signal.id));

    try {
      if (newCandidates.length > 0) {
        await this.#client.$transaction(
          newCandidates.map((candidate) =>
            this.#client.signal.create({ data: signalData(candidate) }),
          ),
        );
      }
    } catch (error) {
      if (error instanceof ClassificationIdentityConflictError) {
        throw error;
      }
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const racedRecords = await this.#client.signal.findMany({
          include: signalInclude,
          where: { id: { in: ids } },
        });
        if (
          racedRecords.length === candidates.length &&
          racedRecords.every((record) => {
            const candidate = candidatesById.get(record.id as Signal["id"]);
            return candidate !== undefined && compatible(record, candidate);
          })
        ) {
          return Object.freeze({
            created: 0,
            existing: candidates.length,
            signals: candidates.length,
          });
        }
        throw new ClassificationIdentityConflictError(
          "Concurrent classification wrote a different signal for the same identity",
        );
      }
      throw new PersistenceError(
        "CLASSIFICATION_SIGNAL_SAVE_FAILED",
        "Unable to persist classification signals",
        error,
      );
    }

    return Object.freeze({
      created: newCandidates.length,
      existing: candidates.length - newCandidates.length,
      signals: candidates.length,
    });
  }
}
