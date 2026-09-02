import {
  isAiProcessingPermitted,
  isoDateTime,
  version,
  type AnalysisId,
  type NormalizedItem,
  type Signal,
  type Source,
} from "@radar/core";

import { type AIAnalysisEvidence, type AIAnalysisRequest } from "../ports/ai-provider.js";

export type AIAnalysisRequestErrorCode =
  | "AI_EVIDENCE_DUPLICATED"
  | "AI_EVIDENCE_INCOMPLETE"
  | "AI_EVIDENCE_NOT_PERMITTED"
  | "AI_EVIDENCE_OUTSIDE_SIGNAL"
  | "AI_EVIDENCE_REQUIRED"
  | "SIGNAL_NOT_ANALYZABLE";

export class AIAnalysisRequestError extends Error {
  readonly code: AIAnalysisRequestErrorCode;

  constructor(code: AIAnalysisRequestErrorCode, message: string) {
    super(message);
    this.name = "AIAnalysisRequestError";
    this.code = code;
  }
}

export interface AIAnalysisEvidenceInput {
  readonly normalizedItem: NormalizedItem;
  readonly source: Source;
}

export interface CreateAIAnalysisRequestInput {
  readonly analysisId: AnalysisId;
  readonly analysisVersion: string;
  readonly createdAt: string;
  readonly evidence: readonly AIAnalysisEvidenceInput[];
  readonly promptVersion: string;
  readonly schemaVersion: string;
  readonly signal: Signal;
}

const sameSet = <Value>(left: readonly Value[], right: readonly Value[]): boolean => {
  if (left.length !== right.length) {
    return false;
  }
  const rightValues = new Set(right);
  return left.every((value) => rightValues.has(value));
};

const sanitizedEvidence = (input: AIAnalysisEvidenceInput): AIAnalysisEvidence =>
  Object.freeze({
    canonicalUrl: input.normalizedItem.canonicalUrl,
    entities: Object.freeze(
      input.normalizedItem.entities.map((entity) =>
        Object.freeze({ kind: entity.kind, value: entity.value }),
      ),
    ),
    language: input.normalizedItem.language,
    normalizedItemId: input.normalizedItem.id,
    publishedAt: input.normalizedItem.publishedAt,
    sourceId: input.source.id,
    text: input.normalizedItem.text,
    title: input.normalizedItem.title,
  });

export const createAIAnalysisRequest = (input: CreateAIAnalysisRequestInput): AIAnalysisRequest => {
  if (input.signal.status !== "CANDIDATE" && input.signal.status !== "ACTIVE") {
    throw new AIAnalysisRequestError(
      "SIGNAL_NOT_ANALYZABLE",
      "Only candidate or active signals may be analyzed",
    );
  }
  if (input.evidence.length === 0) {
    throw new AIAnalysisRequestError(
      "AI_EVIDENCE_REQUIRED",
      "AI analysis requires source-backed evidence",
    );
  }

  const evidenceKeys = input.evidence.map(
    ({ normalizedItem, source }) => `${normalizedItem.id}\u0000${source.id}`,
  );
  if (new Set(evidenceKeys).size !== evidenceKeys.length) {
    throw new AIAnalysisRequestError(
      "AI_EVIDENCE_DUPLICATED",
      "AI analysis evidence pairs must be unique",
    );
  }

  const normalizedItemIds = new Set(input.signal.normalizedItemIds);
  const sourceIds = new Set(input.signal.sourceIds);
  for (const evidence of input.evidence) {
    if (!normalizedItemIds.has(evidence.normalizedItem.id) || !sourceIds.has(evidence.source.id)) {
      throw new AIAnalysisRequestError(
        "AI_EVIDENCE_OUTSIDE_SIGNAL",
        "AI analysis evidence must belong to the selected signal",
      );
    }
    if (!isAiProcessingPermitted(evidence.source)) {
      throw new AIAnalysisRequestError(
        "AI_EVIDENCE_NOT_PERMITTED",
        "AI analysis evidence source is not currently permitted",
      );
    }
  }

  const evidenceNormalizedItemIds = [
    ...new Set(input.evidence.map(({ normalizedItem }) => normalizedItem.id)),
  ];
  const evidenceSourceIds = [...new Set(input.evidence.map(({ source }) => source.id))];
  if (
    !sameSet(evidenceNormalizedItemIds, input.signal.normalizedItemIds) ||
    !sameSet(evidenceSourceIds, input.signal.sourceIds)
  ) {
    throw new AIAnalysisRequestError(
      "AI_EVIDENCE_INCOMPLETE",
      "AI analysis evidence must cover every normalized item and source in the signal",
    );
  }

  return Object.freeze({
    analysisId: input.analysisId,
    analysisVersion: version(input.analysisVersion, "analysisVersion"),
    createdAt: isoDateTime(input.createdAt, "createdAt"),
    evidence: Object.freeze(input.evidence.map(sanitizedEvidence)),
    promptVersion: version(input.promptVersion, "promptVersion"),
    schemaVersion: version(input.schemaVersion, "schemaVersion"),
    signal: Object.freeze({
      category: input.signal.category,
      classificationConfidence: input.signal.classificationConfidence,
      correlationId: input.signal.correlationId,
      id: input.signal.id,
      normalizedItemIds: Object.freeze([...input.signal.normalizedItemIds]),
      relevanceScore: input.signal.relevanceScore,
      sourceIds: Object.freeze([...input.signal.sourceIds]),
      vertical: input.signal.vertical,
    }),
  });
};
