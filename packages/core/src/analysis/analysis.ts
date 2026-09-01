import {
  type AnalysisId,
  type CorrelationId,
  type FactId,
  type InferenceId,
  type SignalId,
  type SourceId,
} from "../shared/identifiers.js";
import { assertInvariant } from "../shared/invariant.js";
import {
  isoDateTime,
  nonEmptyString,
  probability,
  score,
  uniqueStrings,
  uniqueValues,
  version,
  type IsoDateTime,
  type Probability,
  type Score,
  type Version,
} from "../shared/primitives.js";

export const RECOMMENDED_ACTION_KINDS = [
  "CONTACT",
  "REVIEW",
  "PREPARE_OFFER",
  "MONITOR",
  "VERIFY",
  "ADJUST_PLAN",
  "OTHER",
] as const;
export type RecommendedActionKind = (typeof RECOMMENDED_ACTION_KINDS)[number];

export interface RecommendedAction {
  readonly kind: RecommendedActionKind;
  readonly priority: number;
  readonly rationale: string;
  readonly title: string;
}

export interface CreateRecommendedActionInput {
  readonly kind: RecommendedActionKind;
  readonly priority: number;
  readonly rationale: string;
  readonly title: string;
}

export const createRecommendedAction = (input: CreateRecommendedActionInput): RecommendedAction => {
  assertInvariant(
    Number.isInteger(input.priority) && input.priority >= 1 && input.priority <= 5,
    "INVALID_ACTION_PRIORITY",
    "priority must be an integer between 1 and 5",
  );

  return Object.freeze({
    kind: input.kind,
    priority: input.priority,
    rationale: nonEmptyString(input.rationale, "rationale", 2_000),
    title: nonEmptyString(input.title, "title", 300),
  });
};

export interface AnalysisFact {
  readonly id: FactId;
  readonly sourceIds: readonly SourceId[];
  readonly statement: string;
}

export interface CreateAnalysisFactInput {
  readonly id: FactId;
  readonly sourceIds: readonly SourceId[];
  readonly statement: string;
}

export interface AnalysisInference {
  readonly basisFactIds: readonly FactId[];
  readonly id: InferenceId;
  readonly statement: string;
}

export interface CreateAnalysisInferenceInput {
  readonly basisFactIds: readonly FactId[];
  readonly id: InferenceId;
  readonly statement: string;
}

interface AnalysisBase {
  readonly analysisVersion: Version;
  readonly correlationId: CorrelationId;
  readonly createdAt: IsoDateTime;
  readonly id: AnalysisId;
  readonly model: string;
  readonly promptVersion: Version;
  readonly provider: string;
  readonly schemaVersion: Version;
  readonly signalId: SignalId;
}

export interface SuccessfulAnalysis extends AnalysisBase {
  readonly actionability: Score;
  readonly businessImpact: Score;
  readonly candidateActions: readonly RecommendedAction[];
  readonly confidence: Probability;
  readonly deadline: IsoDateTime | null;
  readonly entities: readonly string[];
  readonly eventType: string;
  readonly facts: readonly AnalysisFact[];
  readonly headline: string;
  readonly inferences: readonly AnalysisInference[];
  readonly risks: readonly string[];
  readonly sourceIds: readonly SourceId[];
  readonly status: "SUCCEEDED";
  readonly summary: string;
  readonly urgency: Score;
  readonly whyImportant: string;
}

export interface FailedAnalysis extends AnalysisBase {
  readonly failureCode: string;
  readonly failureReason: string;
  readonly retryable: boolean;
  readonly status: "FAILED";
}

export type Analysis = FailedAnalysis | SuccessfulAnalysis;

interface CreateAnalysisBaseInput {
  readonly analysisVersion: string;
  readonly correlationId: CorrelationId;
  readonly createdAt: string;
  readonly id: AnalysisId;
  readonly model: string;
  readonly promptVersion: string;
  readonly provider: string;
  readonly schemaVersion: string;
  readonly signalId: SignalId;
}

export interface CreateSuccessfulAnalysisInput extends CreateAnalysisBaseInput {
  readonly actionability: number;
  readonly businessImpact: number;
  readonly candidateActions: readonly CreateRecommendedActionInput[];
  readonly confidence: number;
  readonly deadline?: string | null;
  readonly entities: readonly string[];
  readonly eventType: string;
  readonly facts: readonly CreateAnalysisFactInput[];
  readonly headline: string;
  readonly inferences: readonly CreateAnalysisInferenceInput[];
  readonly risks: readonly string[];
  readonly summary: string;
  readonly urgency: number;
  readonly whyImportant: string;
}

export interface CreateFailedAnalysisInput extends CreateAnalysisBaseInput {
  readonly failureCode: string;
  readonly failureReason: string;
  readonly retryable: boolean;
}

const createAnalysisBase = (input: CreateAnalysisBaseInput): AnalysisBase => ({
  analysisVersion: version(input.analysisVersion, "analysisVersion"),
  correlationId: input.correlationId,
  createdAt: isoDateTime(input.createdAt, "createdAt"),
  id: input.id,
  model: nonEmptyString(input.model, "model", 200),
  promptVersion: version(input.promptVersion, "promptVersion"),
  provider: nonEmptyString(input.provider, "provider", 100),
  schemaVersion: version(input.schemaVersion, "schemaVersion"),
  signalId: input.signalId,
});

export const createSuccessfulAnalysis = (
  input: CreateSuccessfulAnalysisInput,
): SuccessfulAnalysis => {
  const facts = input.facts.map((fact) =>
    Object.freeze({
      id: fact.id,
      sourceIds: uniqueValues(fact.sourceIds, "fact.sourceIds", 1),
      statement: nonEmptyString(fact.statement, "fact.statement", 4_000),
    }),
  );
  const factIds = facts.map((fact) => fact.id);
  uniqueValues(factIds, "factIds", 1);
  const factIdSet = new Set<FactId>(factIds);

  const inferences = input.inferences.map((inference) => {
    const basisFactIds = uniqueValues(inference.basisFactIds, "inference.basisFactIds", 1);
    assertInvariant(
      basisFactIds.every((basisFactId) => factIdSet.has(basisFactId)),
      "UNKNOWN_INFERENCE_BASIS",
      "Every inference must reference facts in the same analysis",
    );
    return Object.freeze({
      basisFactIds,
      id: inference.id,
      statement: nonEmptyString(inference.statement, "inference.statement", 4_000),
    });
  });
  uniqueValues(
    inferences.map((inference) => inference.id),
    "inferenceIds",
  );

  const sourceIds = uniqueValues(
    [...new Set(facts.flatMap((fact) => fact.sourceIds))],
    "sourceIds",
    1,
  );
  const candidateActions = input.candidateActions.map(createRecommendedAction);
  assertInvariant(
    candidateActions.length <= 5,
    "TOO_MANY_RECOMMENDED_ACTIONS",
    "candidateActions must contain at most five actions",
  );

  return Object.freeze({
    ...createAnalysisBase(input),
    actionability: score(input.actionability, "actionability"),
    businessImpact: score(input.businessImpact, "businessImpact"),
    candidateActions: Object.freeze(candidateActions),
    confidence: probability(input.confidence, "confidence"),
    deadline:
      input.deadline === undefined || input.deadline === null
        ? null
        : isoDateTime(input.deadline, "deadline"),
    entities: uniqueStrings(input.entities, "entities", {
      caseInsensitive: true,
      maxItems: 100,
    }),
    eventType: nonEmptyString(input.eventType, "eventType", 200),
    facts: Object.freeze(facts),
    headline: nonEmptyString(input.headline, "headline", 500),
    inferences: Object.freeze(inferences),
    risks: uniqueStrings(input.risks, "risks", {
      caseInsensitive: true,
      maxItems: 20,
    }),
    sourceIds,
    status: "SUCCEEDED",
    summary: nonEmptyString(input.summary, "summary", 4_000),
    urgency: score(input.urgency, "urgency"),
    whyImportant: nonEmptyString(input.whyImportant, "whyImportant", 4_000),
  });
};

export const createFailedAnalysis = (input: CreateFailedAnalysisInput): FailedAnalysis =>
  Object.freeze({
    ...createAnalysisBase(input),
    failureCode: nonEmptyString(input.failureCode, "failureCode", 100),
    failureReason: nonEmptyString(input.failureReason, "failureReason", 2_000),
    retryable: input.retryable,
    status: "FAILED",
  });

export const analysisIdentityKey = (analysis: Analysis): string =>
  JSON.stringify([
    analysis.signalId,
    analysis.provider,
    analysis.model,
    analysis.promptVersion,
    analysis.schemaVersion,
    analysis.analysisVersion,
  ]);
