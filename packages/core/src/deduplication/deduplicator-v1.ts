import { type NormalizedItemId, type SourceId } from "../shared/identifiers.js";
import { assertInvariant } from "../shared/invariant.js";
import { type IsoDateTime, type Version, version } from "../shared/primitives.js";
import { type Vertical } from "../shared/taxonomy.js";
import { type NormalizedItem } from "../normalization/normalized-item.js";

export const DEDUPLICATOR_VERSION_V1 = "deduplicator-v1";
export const DEDUPLICATION_NEAR_THRESHOLD_V1 = 0.95;
export const DEDUPLICATION_WINDOW_HOURS_V1 = 24 * 7;

export const DEDUPLICATION_MATCH_KINDS = [
  "REPRESENTATIVE",
  "SOURCE_IDENTITY",
  "CANONICAL_URL",
  "NORMALIZED_HASH",
  "NEAR_TEXT",
] as const;
export type DeduplicationMatchKind = (typeof DEDUPLICATION_MATCH_KINDS)[number];

export interface DeduplicationCandidate {
  readonly normalizedItem: NormalizedItem;
  readonly sourceExternalId: string | null;
  readonly sourceId: SourceId;
  readonly verticals: readonly Vertical[];
}

export interface DeduplicationAssignment {
  readonly deduplicatorVersion: Version;
  readonly matchKind: DeduplicationMatchKind;
  readonly matchedToNormalizedItemId: NormalizedItemId;
  readonly normalizedItemId: NormalizedItemId;
  readonly representativeNormalizedItemId: NormalizedItemId;
  readonly similarity: number;
  readonly timeDistanceHours: number;
}

export interface DeduplicationMetrics {
  readonly clusters: number;
  readonly duplicates: number;
  readonly exactDuplicates: number;
  readonly inputItems: number;
  readonly nearComparisons: number;
  readonly nearDuplicates: number;
}

export interface DeduplicationResult {
  readonly assignments: readonly DeduplicationAssignment[];
  readonly metrics: DeduplicationMetrics;
  readonly version: Version;
}

export interface DeduplicatorV1Options {
  readonly nearThreshold?: number;
  readonly windowHours?: number;
}

interface MatchEdge {
  readonly kind: Exclude<DeduplicationMatchKind, "REPRESENTATIVE">;
  readonly left: number;
  readonly right: number;
  readonly similarity: number;
  readonly timeDistanceHours: number;
}

const matchPriority: Readonly<Record<MatchEdge["kind"], number>> = Object.freeze({
  SOURCE_IDENTITY: 0,
  CANONICAL_URL: 1,
  NORMALIZED_HASH: 2,
  NEAR_TEXT: 3,
});

const arrayValue = <Value>(values: readonly Value[], index: number): Value => {
  const value = values[index];
  assertInvariant(value !== undefined, "INVALID_DEDUP_INDEX", "Deduplication index is invalid");
  return value;
};

const observedAt = (candidate: DeduplicationCandidate): IsoDateTime =>
  candidate.normalizedItem.publishedAt ?? candidate.normalizedItem.createdAt;

const timeDistanceHours = (left: DeduplicationCandidate, right: DeduplicationCandidate): number =>
  Math.abs(Date.parse(observedAt(left)) - Date.parse(observedAt(right))) / 3_600_000;

const sharesVertical = (left: DeduplicationCandidate, right: DeduplicationCandidate): boolean =>
  left.verticals.some((vertical) => right.verticals.includes(vertical));

const tokenNgrams = (text: string): ReadonlySet<string> => {
  const tokens = text.toLocaleLowerCase("ru").match(/[\p{L}\p{N}]+/gu) ?? [];
  if (tokens.length === 0) {
    return new Set();
  }
  const width = Math.min(3, tokens.length);
  const ngrams = new Set<string>();
  for (let index = 0; index <= tokens.length - width; index += 1) {
    ngrams.add(tokens.slice(index, index + width).join(" "));
  }
  return ngrams;
};

export const nearTextSimilarityV1 = (left: string, right: string): number => {
  const leftNgrams = tokenNgrams(left);
  const rightNgrams = tokenNgrams(right);
  if (leftNgrams.size === 0 || rightNgrams.size === 0) {
    return 0;
  }
  let intersection = 0;
  for (const ngram of leftNgrams) {
    if (rightNgrams.has(ngram)) {
      intersection += 1;
    }
  }
  return intersection / Math.min(leftNgrams.size, rightNgrams.size);
};

const pairKey = (left: number, right: number): string =>
  left < right ? `${String(left)}:${String(right)}` : `${String(right)}:${String(left)}`;

const sourceIdentity = (candidate: DeduplicationCandidate): string | null =>
  candidate.sourceExternalId === null
    ? null
    : JSON.stringify([candidate.sourceId, candidate.sourceExternalId]);

const compareCandidates = (left: DeduplicationCandidate, right: DeduplicationCandidate): number => {
  const timeOrder = Date.parse(observedAt(left)) - Date.parse(observedAt(right));
  return timeOrder === 0
    ? left.normalizedItem.id.localeCompare(right.normalizedItem.id, "en")
    : timeOrder;
};

const addExactEdges = (
  candidates: readonly DeduplicationCandidate[],
  edges: Map<string, MatchEdge>,
): void => {
  const indexes = {
    canonicalUrl: new Map<string, number>(),
    normalizedHash: new Map<string, number>(),
    sourceIdentity: new Map<string, number>(),
  };

  const add = (
    index: number,
    identity: string | null,
    kind: Exclude<MatchEdge["kind"], "NEAR_TEXT">,
    values: Map<string, number>,
  ): void => {
    if (identity === null) {
      return;
    }
    const existingIndex = values.get(identity);
    if (existingIndex === undefined) {
      values.set(identity, index);
      return;
    }
    const edge: MatchEdge = Object.freeze({
      kind,
      left: existingIndex,
      right: index,
      similarity: 1,
      timeDistanceHours: timeDistanceHours(
        arrayValue(candidates, existingIndex),
        arrayValue(candidates, index),
      ),
    });
    const key = pairKey(edge.left, edge.right);
    const current = edges.get(key);
    if (current === undefined || matchPriority[edge.kind] < matchPriority[current.kind]) {
      edges.set(key, edge);
    }
  };

  for (const [index, candidate] of candidates.entries()) {
    add(index, sourceIdentity(candidate), "SOURCE_IDENTITY", indexes.sourceIdentity);
    add(index, candidate.normalizedItem.canonicalUrl, "CANONICAL_URL", indexes.canonicalUrl);
    add(index, candidate.normalizedItem.normalizedHash, "NORMALIZED_HASH", indexes.normalizedHash);
  }
};

const addNearEdges = (
  candidates: readonly DeduplicationCandidate[],
  edges: Map<string, MatchEdge>,
  nearThreshold: number,
  windowHours: number,
): number => {
  let comparisons = 0;
  for (let left = 0; left < candidates.length; left += 1) {
    for (let right = left + 1; right < candidates.length; right += 1) {
      if (edges.has(pairKey(left, right))) {
        continue;
      }
      const leftCandidate = arrayValue(candidates, left);
      const rightCandidate = arrayValue(candidates, right);
      const distance = timeDistanceHours(leftCandidate, rightCandidate);
      if (distance > windowHours || !sharesVertical(leftCandidate, rightCandidate)) {
        continue;
      }
      comparisons += 1;
      const similarity = nearTextSimilarityV1(
        leftCandidate.normalizedItem.text,
        rightCandidate.normalizedItem.text,
      );
      if (similarity >= nearThreshold) {
        edges.set(
          pairKey(left, right),
          Object.freeze({
            kind: "NEAR_TEXT",
            left,
            right,
            similarity,
            timeDistanceHours: distance,
          }),
        );
      }
    }
  }
  return comparisons;
};

const components = (size: number, edges: readonly MatchEdge[]): readonly number[] => {
  const parent = Array.from({ length: size }, (_, index) => index);
  const find = (index: number): number => {
    let root = index;
    while (parent[root] !== root) {
      root = arrayValue(parent, root);
    }
    while (parent[index] !== index) {
      const next = arrayValue(parent, index);
      parent[index] = root;
      index = next;
    }
    return root;
  };
  const union = (left: number, right: number): void => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) {
      parent[Math.max(leftRoot, rightRoot)] = Math.min(leftRoot, rightRoot);
    }
  };
  for (const edge of edges) {
    union(edge.left, edge.right);
  }
  return Object.freeze(parent.map((_, index) => find(index)));
};

const bestEdgeFor = (index: number, edges: readonly MatchEdge[]): MatchEdge => {
  const candidates = edges
    .filter((edge) => edge.left === index || edge.right === index)
    .sort((left, right) => {
      const priorityOrder = matchPriority[left.kind] - matchPriority[right.kind];
      if (priorityOrder !== 0) {
        return priorityOrder;
      }
      const similarityOrder = right.similarity - left.similarity;
      if (similarityOrder !== 0) {
        return similarityOrder;
      }
      return Math.min(left.left, left.right) - Math.min(right.left, right.right);
    });
  const edge = candidates[0];
  assertInvariant(edge !== undefined, "MISSING_DEDUP_EDGE", "Duplicate member must have evidence");
  return edge;
};

export const deduplicateCandidatesV1 = (
  inputCandidates: readonly DeduplicationCandidate[],
  options: DeduplicatorV1Options = {},
): DeduplicationResult => {
  const nearThreshold = options.nearThreshold ?? DEDUPLICATION_NEAR_THRESHOLD_V1;
  const windowHours = options.windowHours ?? DEDUPLICATION_WINDOW_HOURS_V1;
  assertInvariant(
    nearThreshold >= 0.5 && nearThreshold <= 1,
    "INVALID_NEAR_THRESHOLD",
    "nearThreshold must be between 0.5 and 1",
  );
  assertInvariant(
    Number.isFinite(windowHours) && windowHours > 0,
    "INVALID_DEDUP_WINDOW",
    "windowHours must be positive",
  );

  const uniqueIds = new Set(inputCandidates.map((candidate) => candidate.normalizedItem.id));
  assertInvariant(
    uniqueIds.size === inputCandidates.length,
    "DUPLICATE_DEDUP_CANDIDATE",
    "Each normalized item may appear only once",
  );
  for (const candidate of inputCandidates) {
    assertInvariant(
      candidate.verticals.length > 0,
      "MISSING_DEDUP_VERTICAL",
      "Deduplication candidate must include a vertical hint",
    );
  }

  const candidates = [...inputCandidates].sort(compareCandidates);
  const edgeMap = new Map<string, MatchEdge>();
  addExactEdges(candidates, edgeMap);
  const nearComparisons = addNearEdges(candidates, edgeMap, nearThreshold, windowHours);
  const edges = [...edgeMap.values()];
  const componentRoots = components(candidates.length, edges);
  const representativeByRoot = new Map<number, number>();
  for (const [index, root] of componentRoots.entries()) {
    if (!representativeByRoot.has(root)) {
      representativeByRoot.set(root, index);
    }
  }

  const deduplicatorVersion = version(DEDUPLICATOR_VERSION_V1, "deduplicatorVersion");
  const assignments = candidates.map((candidate, index): DeduplicationAssignment => {
    const root = arrayValue(componentRoots, index);
    const representativeIndex = representativeByRoot.get(root);
    assertInvariant(
      representativeIndex !== undefined,
      "MISSING_DEDUP_REPRESENTATIVE",
      "Deduplication component must have a representative",
    );
    const representativeId = arrayValue(candidates, representativeIndex).normalizedItem.id;
    if (index === representativeIndex) {
      return Object.freeze({
        deduplicatorVersion,
        matchKind: "REPRESENTATIVE",
        matchedToNormalizedItemId: candidate.normalizedItem.id,
        normalizedItemId: candidate.normalizedItem.id,
        representativeNormalizedItemId: representativeId,
        similarity: 1,
        timeDistanceHours: 0,
      });
    }
    const edge = bestEdgeFor(index, edges);
    const matchedIndex = edge.left === index ? edge.right : edge.left;
    return Object.freeze({
      deduplicatorVersion,
      matchKind: edge.kind,
      matchedToNormalizedItemId: arrayValue(candidates, matchedIndex).normalizedItem.id,
      normalizedItemId: candidate.normalizedItem.id,
      representativeNormalizedItemId: representativeId,
      similarity: edge.similarity,
      timeDistanceHours: edge.timeDistanceHours,
    });
  });

  const exactKinds = new Set<DeduplicationMatchKind>([
    "SOURCE_IDENTITY",
    "CANONICAL_URL",
    "NORMALIZED_HASH",
  ]);
  const exactDuplicates = assignments.filter((assignment) =>
    exactKinds.has(assignment.matchKind),
  ).length;
  const nearDuplicates = assignments.filter(
    (assignment) => assignment.matchKind === "NEAR_TEXT",
  ).length;
  const clusters = representativeByRoot.size;
  return Object.freeze({
    assignments: Object.freeze(assignments),
    metrics: Object.freeze({
      clusters,
      duplicates: assignments.length - clusters,
      exactDuplicates,
      inputItems: assignments.length,
      nearComparisons,
      nearDuplicates,
    }),
    version: deduplicatorVersion,
  });
};
