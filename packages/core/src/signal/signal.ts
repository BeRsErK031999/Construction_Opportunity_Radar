import {
  type CorrelationId,
  type NormalizedItemId,
  type SignalId,
  type SourceId,
} from "../shared/identifiers.js";
import { assertInvariant } from "../shared/invariant.js";
import {
  assertTimestampOrder,
  isoDateTime,
  nonEmptyString,
  score,
  uniqueValues,
  version,
  type IsoDateTime,
  type Score,
  type Version,
} from "../shared/primitives.js";
import { type Vertical } from "../shared/taxonomy.js";

export const SIGNAL_STATUSES = ["CANDIDATE", "ACTIVE", "DISMISSED", "SUPERSEDED"] as const;
export type SignalStatus = (typeof SIGNAL_STATUSES)[number];

export interface Signal {
  readonly category: string;
  readonly classifierVersion: Version;
  readonly classificationConfidence: Score;
  readonly correlationId: CorrelationId;
  readonly createdAt: IsoDateTime;
  readonly id: SignalId;
  readonly normalizedItemIds: readonly NormalizedItemId[];
  readonly relevanceScore: Score;
  readonly sourceIds: readonly SourceId[];
  readonly status: SignalStatus;
  readonly supersededBySignalId: SignalId | null;
  readonly taxonomyVersion: Version;
  readonly updatedAt: IsoDateTime;
  readonly vertical: Vertical;
}

export interface CreateSignalInput {
  readonly category: string;
  readonly classifierVersion: string;
  readonly classificationConfidence: number;
  readonly correlationId: CorrelationId;
  readonly createdAt: string;
  readonly id: SignalId;
  readonly normalizedItemIds: readonly NormalizedItemId[];
  readonly relevanceScore: number;
  readonly sourceIds: readonly SourceId[];
  readonly status: SignalStatus;
  readonly supersededBySignalId?: SignalId | null;
  readonly taxonomyVersion: string;
  readonly updatedAt: string;
  readonly vertical: Vertical;
}

export const createSignal = (input: CreateSignalInput): Signal => {
  const createdAt = isoDateTime(input.createdAt, "createdAt");
  const updatedAt = isoDateTime(input.updatedAt, "updatedAt");
  const supersededBySignalId = input.supersededBySignalId ?? null;

  assertTimestampOrder(createdAt, updatedAt, "updatedAt");
  assertInvariant(
    (input.status === "SUPERSEDED") === (supersededBySignalId !== null),
    "INVALID_SUPERSEDED_SIGNAL",
    "Only SUPERSEDED signals must reference their replacement",
  );
  assertInvariant(
    supersededBySignalId !== input.id,
    "SELF_SUPERSEDED_SIGNAL",
    "A signal cannot supersede itself",
  );

  return Object.freeze({
    category: nonEmptyString(input.category, "category", 200),
    classifierVersion: version(input.classifierVersion, "classifierVersion"),
    classificationConfidence: score(input.classificationConfidence, "classificationConfidence"),
    correlationId: input.correlationId,
    createdAt,
    id: input.id,
    normalizedItemIds: uniqueValues(input.normalizedItemIds, "normalizedItemIds", 1),
    relevanceScore: score(input.relevanceScore, "relevanceScore"),
    sourceIds: uniqueValues(input.sourceIds, "sourceIds", 1),
    status: input.status,
    supersededBySignalId,
    taxonomyVersion: version(input.taxonomyVersion, "taxonomyVersion"),
    updatedAt,
    vertical: input.vertical,
  });
};
