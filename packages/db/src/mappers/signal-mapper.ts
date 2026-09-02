import { createSignal, type Signal } from "@radar/core";

import {
  type Signal as SignalRecord,
  type SignalEvidence as SignalEvidenceRecord,
} from "../generated/prisma/client.js";

export type SignalWithEvidence = SignalRecord & {
  readonly evidence: readonly SignalEvidenceRecord[];
};

export const signalFromRecord = (record: SignalWithEvidence): Signal =>
  createSignal({
    category: record.category,
    classificationConfidence: record.classificationConfidence,
    classificationRuleIds: record.classificationRuleIds,
    classifierVersion: record.classifierVersion,
    correlationId: record.correlationId as Signal["correlationId"],
    createdAt: record.createdAt.toISOString(),
    deduplicationRepresentativeNormalizedItemId:
      record.deduplicationRepresentativeNormalizedItemId as Signal["deduplicationRepresentativeNormalizedItemId"],
    deduplicatorVersion: record.deduplicatorVersion,
    id: record.id as Signal["id"],
    normalizedItemIds: record.evidence.map(
      (evidence) => evidence.normalizedItemId as Signal["normalizedItemIds"][number],
    ),
    relevanceScore: record.relevanceScore,
    sourceIds: [
      ...new Set(
        record.evidence.map((evidence) => evidence.sourceId as Signal["sourceIds"][number]),
      ),
    ],
    status: record.status,
    supersededBySignalId: record.supersededBySignalId as Signal["supersededBySignalId"],
    taxonomyVersion: record.taxonomyVersion,
    updatedAt: record.updatedAt.toISOString(),
    vertical: record.vertical,
  });
