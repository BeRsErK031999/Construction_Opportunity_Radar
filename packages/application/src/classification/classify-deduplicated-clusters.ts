import {
  classificationSignalId,
  createSignal,
  isAiProcessingPermitted,
  type AiEligibleClassificationDecision,
  type ClassificationCandidate,
  type ClassificationDecision,
  type Signal,
} from "@radar/core";

export interface Classifier {
  readonly taxonomyVersion: string;
  readonly version: string;
  classify(candidate: ClassificationCandidate): ClassificationDecision;
}

export interface PersistableClassifiedSignal {
  readonly decision: AiEligibleClassificationDecision;
  readonly signal: Signal;
}

export interface ClassificationSaveResult {
  readonly created: number;
  readonly existing: number;
  readonly signals: number;
}

export interface ClassificationSignalRepository {
  countSignals(classifierVersion: string): Promise<number>;
  save(signals: readonly PersistableClassifiedSignal[]): Promise<ClassificationSaveResult>;
}

export interface ClassificationMetrics {
  readonly aiEligible: number;
  readonly construction: number;
  readonly horeca: number;
  readonly inputClusters: number;
  readonly irrelevant: number;
  readonly other: number;
  readonly permissionDenied: number;
}

export interface ExecuteClassificationInput {
  readonly candidates: readonly ClassificationCandidate[];
  readonly classifier: Classifier;
  readonly createdAt: string;
  readonly repository: ClassificationSignalRepository;
}

export interface ExecuteClassificationResult {
  readonly decisions: readonly ClassificationDecision[];
  readonly metrics: ClassificationMetrics;
  readonly persistence: ClassificationSaveResult;
}

export class ClassificationUseCaseError extends Error {
  readonly code:
    | "CLASSIFICATION_COVERAGE_MISMATCH"
    | "CLASSIFIER_VERSION_MISMATCH"
    | "DUPLICATE_CLASSIFICATION_CLUSTER"
    | "INVALID_AI_INPUT_EVIDENCE"
    | "TAXONOMY_VERSION_MISMATCH";

  constructor(code: ClassificationUseCaseError["code"], message: string) {
    super(message);
    this.name = "ClassificationUseCaseError";
    this.code = code;
  }
}

const validateDecision = (
  candidate: ClassificationCandidate,
  decision: ClassificationDecision,
  classifier: Classifier,
): void => {
  if (decision.classifierVersion !== classifier.version) {
    throw new ClassificationUseCaseError(
      "CLASSIFIER_VERSION_MISMATCH",
      "Classification decision version does not match the declared classifier version",
    );
  }
  if (decision.taxonomyVersion !== classifier.taxonomyVersion) {
    throw new ClassificationUseCaseError(
      "TAXONOMY_VERSION_MISMATCH",
      "Classification taxonomy version does not match the declared taxonomy version",
    );
  }
  if (
    decision.representativeNormalizedItemId !== candidate.representativeNormalizedItemId ||
    decision.deduplicatorVersion !== candidate.deduplicatorVersion
  ) {
    throw new ClassificationUseCaseError(
      "CLASSIFICATION_COVERAGE_MISMATCH",
      "Classification decision does not match its deduplication cluster",
    );
  }

  const evidenceByIdentity = new Map(
    candidate.evidence.map((evidence) => [
      JSON.stringify([evidence.normalizedItem.id, evidence.source.id]),
      evidence,
    ]),
  );
  const aiEvidenceKeys = decision.aiInputEvidence.map((evidence) =>
    JSON.stringify([evidence.normalizedItemId, evidence.sourceId]),
  );
  const hasInvalidAiEvidence =
    new Set(aiEvidenceKeys).size !== aiEvidenceKeys.length ||
    aiEvidenceKeys.some((key) => {
      const evidence = evidenceByIdentity.get(key);
      return evidence === undefined || !isAiProcessingPermitted(evidence.source);
    });
  const eligibleEvidenceIsInvalid =
    decision.outcome === "AI_ELIGIBLE" &&
    (decision.aiInputEvidence.length === 0 ||
      !decision.aiInputEvidence.some(
        (evidence) => evidence.normalizedItemId === decision.selectedNormalizedItemId,
      ));
  const rejectedDecisionLeaksAiInput =
    decision.outcome !== "AI_ELIGIBLE" && decision.aiInputEvidence.length > 0;
  if (hasInvalidAiEvidence || eligibleEvidenceIsInvalid || rejectedDecisionLeaksAiInput) {
    throw new ClassificationUseCaseError(
      "INVALID_AI_INPUT_EVIDENCE",
      "AI input evidence must be unique, permitted, cluster-backed, and limited to eligible decisions",
    );
  }
};

const toPersistableSignal = (
  decision: AiEligibleClassificationDecision,
  createdAt: string,
): PersistableClassifiedSignal => {
  const sourceIds = [...new Set(decision.aiInputEvidence.map((evidence) => evidence.sourceId))];
  return Object.freeze({
    decision,
    signal: createSignal({
      category: decision.category,
      classificationConfidence: decision.classificationConfidence,
      classificationRuleIds: decision.matchedRuleIds,
      classifierVersion: decision.classifierVersion,
      correlationId: decision.correlationId,
      createdAt,
      deduplicationRepresentativeNormalizedItemId: decision.representativeNormalizedItemId,
      deduplicatorVersion: decision.deduplicatorVersion,
      id: classificationSignalId(decision),
      normalizedItemIds: decision.aiInputEvidence.map((evidence) => evidence.normalizedItemId),
      relevanceScore: decision.relevanceScore,
      sourceIds,
      status: "CANDIDATE",
      taxonomyVersion: decision.taxonomyVersion,
      updatedAt: createdAt,
      vertical: decision.vertical,
    }),
  });
};

const metrics = (decisions: readonly ClassificationDecision[]): ClassificationMetrics =>
  Object.freeze({
    aiEligible: decisions.filter((decision) => decision.outcome === "AI_ELIGIBLE").length,
    construction: decisions.filter((decision) => decision.vertical === "CONSTRUCTION").length,
    horeca: decisions.filter((decision) => decision.vertical === "HORECA").length,
    inputClusters: decisions.length,
    irrelevant: decisions.filter((decision) => decision.outcome === "IRRELEVANT").length,
    other: decisions.filter((decision) => decision.vertical === "OTHER").length,
    permissionDenied: decisions.filter((decision) => decision.outcome === "PERMISSION_DENIED")
      .length,
  });

export const executeClassification = async (
  input: ExecuteClassificationInput,
): Promise<ExecuteClassificationResult> => {
  const representativeIds = input.candidates.map(
    (candidate) => candidate.representativeNormalizedItemId,
  );
  if (new Set(representativeIds).size !== representativeIds.length) {
    throw new ClassificationUseCaseError(
      "DUPLICATE_CLASSIFICATION_CLUSTER",
      "Each deduplication cluster may be classified only once per batch",
    );
  }

  const decisions = input.candidates.map((candidate) => {
    const decision = input.classifier.classify(candidate);
    validateDecision(candidate, decision, input.classifier);
    return decision;
  });
  const signals = decisions
    .filter(
      (decision): decision is AiEligibleClassificationDecision =>
        decision.outcome === "AI_ELIGIBLE",
    )
    .map((decision) => toPersistableSignal(decision, input.createdAt));
  const persistence = await input.repository.save(signals);

  return Object.freeze({
    decisions: Object.freeze(decisions),
    metrics: metrics(decisions),
    persistence,
  });
};
