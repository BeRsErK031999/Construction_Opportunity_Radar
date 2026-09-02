import {
  RECOMMENDED_ACTION_KINDS,
  analysisId,
  correlationId,
  createFailedAnalysis,
  createSuccessfulAnalysis,
  factId,
  inferenceId,
  signalId,
  sourceId,
  type Analysis,
  type JsonValue,
  type RecommendedActionKind,
} from "@radar/core";

import { PersistenceError } from "../errors.js";
import {
  type Analysis as AnalysisRecord,
  type AnalysisSource as AnalysisSourceRecord,
  type Prisma,
} from "../generated/prisma/client.js";

export type AnalysisWithSources = AnalysisRecord & {
  readonly sources: readonly AnalysisSourceRecord[];
};

const inputJson = (value: unknown): Prisma.InputJsonValue =>
  structuredClone(value) as Prisma.InputJsonValue;
const mutableJson = (value: unknown): JsonValue => structuredClone(value) as JsonValue;

const mappingError = (field: string): never => {
  throw new PersistenceError("ANALYSIS_MAPPING_FAILED", `Analysis ${field} has an invalid shape`);
};

const jsonArray = (value: unknown, field: string): readonly JsonValue[] => {
  const cloned = mutableJson(value);
  return Array.isArray(cloned) ? cloned : mappingError(field);
};

const objectValue = (value: JsonValue, field: string): Record<string, JsonValue> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? value
    : mappingError(field);

const stringValue = (value: JsonValue | undefined, field: string): string =>
  typeof value === "string" ? value : mappingError(field);

const numberValue = (value: JsonValue | undefined, field: string): number =>
  typeof value === "number" ? value : mappingError(field);

const stringArray = (value: unknown, field: string): readonly string[] =>
  jsonArray(value, field).map((item) => (typeof item === "string" ? item : mappingError(field)));

const requiredNumber = (value: number | null, field: string): number =>
  value ?? mappingError(field);

const requiredString = (value: string | null, field: string): string =>
  value ?? mappingError(field);

export const analysisToCreateData = (analysis: Analysis): Prisma.AnalysisCreateInput => {
  const base = {
    analysisVersion: analysis.analysisVersion,
    correlationId: analysis.correlationId,
    createdAt: new Date(analysis.createdAt),
    id: analysis.id,
    model: analysis.model,
    promptVersion: analysis.promptVersion,
    provider: analysis.provider,
    schemaVersion: analysis.schemaVersion,
    signal: { connect: { id: analysis.signalId } },
    status: analysis.status,
  } as const;

  if (analysis.status === "FAILED") {
    return {
      ...base,
      failureCode: analysis.failureCode,
      failureReason: analysis.failureReason,
      retryable: analysis.retryable,
    };
  }

  return {
    ...base,
    actionability: analysis.actionability,
    businessImpact: analysis.businessImpact,
    candidateActions: inputJson(analysis.candidateActions),
    confidence: analysis.confidence,
    deadline: analysis.deadline === null ? null : new Date(analysis.deadline),
    entities: inputJson(analysis.entities),
    eventType: analysis.eventType,
    facts: inputJson(analysis.facts),
    headline: analysis.headline,
    inferences: inputJson(analysis.inferences),
    risks: inputJson(analysis.risks),
    sources: { create: analysis.sourceIds.map((id) => ({ sourceId: id })) },
    summary: analysis.summary,
    urgency: analysis.urgency,
    whyImportant: analysis.whyImportant,
  };
};

export const analysisFromRecord = (record: AnalysisWithSources): Analysis => {
  const base = {
    analysisVersion: record.analysisVersion,
    correlationId: correlationId(record.correlationId),
    createdAt: record.createdAt.toISOString(),
    id: analysisId(record.id),
    model: record.model,
    promptVersion: record.promptVersion,
    provider: record.provider,
    schemaVersion: record.schemaVersion,
    signalId: signalId(record.signalId),
  };
  if (record.status === "FAILED") {
    if (record.sources.length > 0) {
      mappingError("sources");
    }
    return createFailedAnalysis({
      ...base,
      failureCode: requiredString(record.failureCode, "failureCode"),
      failureReason: requiredString(record.failureReason, "failureReason"),
      retryable: record.retryable ?? mappingError("retryable"),
    });
  }

  const facts = jsonArray(record.facts, "facts").map((value, index) => {
    const fact = objectValue(value, `facts[${String(index)}]`);
    return {
      id: factId(stringValue(fact.id, `facts[${String(index)}].id`)),
      sourceIds: stringArray(fact.sourceIds, `facts[${String(index)}].sourceIds`).map(sourceId),
      statement: stringValue(fact.statement, `facts[${String(index)}].statement`),
    };
  });
  const inferences = jsonArray(record.inferences, "inferences").map((value, index) => {
    const inference = objectValue(value, `inferences[${String(index)}]`);
    return {
      basisFactIds: stringArray(
        inference.basisFactIds,
        `inferences[${String(index)}].basisFactIds`,
      ).map(factId),
      id: inferenceId(stringValue(inference.id, `inferences[${String(index)}].id`)),
      statement: stringValue(inference.statement, `inferences[${String(index)}].statement`),
    };
  });
  const candidateActions = jsonArray(record.candidateActions, "candidateActions").map(
    (value, index) => {
      const action = objectValue(value, `candidateActions[${String(index)}]`);
      const kind = stringValue(action.kind, `candidateActions[${String(index)}].kind`);
      if (!RECOMMENDED_ACTION_KINDS.includes(kind as RecommendedActionKind)) {
        mappingError(`candidateActions[${String(index)}].kind`);
      }
      return {
        kind: kind as RecommendedActionKind,
        priority: numberValue(action.priority, `candidateActions[${String(index)}].priority`),
        rationale: stringValue(action.rationale, `candidateActions[${String(index)}].rationale`),
        title: stringValue(action.title, `candidateActions[${String(index)}].title`),
      };
    },
  );
  const persistedSourceIds = record.sources.map(({ sourceId: id }) => sourceId(id)).sort();
  const factSourceIds = [...new Set(facts.flatMap(({ sourceIds }) => sourceIds))].sort();
  if (JSON.stringify(persistedSourceIds) !== JSON.stringify(factSourceIds)) {
    mappingError("sources");
  }

  return createSuccessfulAnalysis({
    ...base,
    actionability: requiredNumber(record.actionability, "actionability"),
    businessImpact: requiredNumber(record.businessImpact, "businessImpact"),
    candidateActions,
    confidence: requiredNumber(record.confidence, "confidence"),
    deadline: record.deadline?.toISOString() ?? null,
    entities: stringArray(record.entities, "entities"),
    eventType: requiredString(record.eventType, "eventType"),
    facts,
    headline: requiredString(record.headline, "headline"),
    inferences,
    risks: stringArray(record.risks, "risks"),
    summary: requiredString(record.summary, "summary"),
    urgency: requiredNumber(record.urgency, "urgency"),
    whyImportant: requiredString(record.whyImportant, "whyImportant"),
  });
};
