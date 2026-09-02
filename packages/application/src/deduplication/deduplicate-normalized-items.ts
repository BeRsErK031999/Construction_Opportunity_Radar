import { type DeduplicationCandidate, type DeduplicationResult, type Version } from "@radar/core";

export interface Deduplicator {
  readonly version: string;
  deduplicate(candidates: readonly DeduplicationCandidate[]): DeduplicationResult;
}

export interface DeduplicationSaveResult {
  readonly assignments: number;
  readonly clusters: number;
  readonly created: number;
  readonly existing: number;
  readonly version: Version;
}

export interface DeduplicationRepository {
  countAssignments(version: string): Promise<number>;
  countClusters(version: string): Promise<number>;
  listCandidates(options: {
    readonly limit?: number;
    readonly normalizerVersion: string;
  }): Promise<readonly DeduplicationCandidate[]>;
  save(result: DeduplicationResult, createdAt: string): Promise<DeduplicationSaveResult>;
}

export interface ExecuteDeduplicationInput {
  readonly candidates: readonly DeduplicationCandidate[];
  readonly createdAt: string;
  readonly deduplicator: Deduplicator;
  readonly repository: DeduplicationRepository;
}

export interface ExecuteDeduplicationResult {
  readonly deduplication: DeduplicationResult;
  readonly persistence: DeduplicationSaveResult;
}

export class DeduplicationUseCaseError extends Error {
  readonly code: "DEDUPLICATOR_COVERAGE_MISMATCH" | "DEDUPLICATOR_VERSION_MISMATCH";

  constructor(
    code: "DEDUPLICATOR_COVERAGE_MISMATCH" | "DEDUPLICATOR_VERSION_MISMATCH",
    message: string,
  ) {
    super(message);
    this.name = "DeduplicationUseCaseError";
    this.code = code;
  }
}

export const executeDeduplication = async (
  input: ExecuteDeduplicationInput,
): Promise<ExecuteDeduplicationResult> => {
  const result = input.deduplicator.deduplicate(input.candidates);
  if (result.version !== input.deduplicator.version) {
    throw new DeduplicationUseCaseError(
      "DEDUPLICATOR_VERSION_MISMATCH",
      "Deduplication result version does not match the declared deduplicator version",
    );
  }

  const candidateIds = new Set(input.candidates.map((candidate) => candidate.normalizedItem.id));
  const assignmentIds = new Set(
    result.assignments.map((assignment) => assignment.normalizedItemId),
  );
  if (
    candidateIds.size !== input.candidates.length ||
    assignmentIds.size !== result.assignments.length ||
    candidateIds.size !== assignmentIds.size ||
    [...candidateIds].some((id) => !assignmentIds.has(id))
  ) {
    throw new DeduplicationUseCaseError(
      "DEDUPLICATOR_COVERAGE_MISMATCH",
      "Deduplication result must assign every candidate exactly once",
    );
  }
  if (result.assignments.some((assignment) => assignment.deduplicatorVersion !== result.version)) {
    throw new DeduplicationUseCaseError(
      "DEDUPLICATOR_VERSION_MISMATCH",
      "Every deduplication assignment must use the result version",
    );
  }
  if (
    result.assignments.some(
      (assignment) =>
        !candidateIds.has(assignment.representativeNormalizedItemId) ||
        !candidateIds.has(assignment.matchedToNormalizedItemId),
    )
  ) {
    throw new DeduplicationUseCaseError(
      "DEDUPLICATOR_COVERAGE_MISMATCH",
      "Deduplication evidence may reference only candidates from the current result",
    );
  }

  const persistence = await input.repository.save(result, input.createdAt);
  return Object.freeze({ deduplication: result, persistence });
};
