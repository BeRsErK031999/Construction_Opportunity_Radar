import { type AIAnalysisRequest } from "@radar/application";
import { AIAnalysisResponseV1Schema, type AIAnalysisResponseV1 } from "@radar/contracts";
import {
  analysisId,
  correlationId,
  createFailedAnalysis,
  createSuccessfulAnalysis,
  factId,
  inferenceId,
  signalId,
  sourceId,
  type Analysis,
} from "@radar/core";

export interface AIAnalysisResponseContextV1 {
  readonly model: string;
  readonly provider: string;
  readonly request: AIAnalysisRequest;
}

type InvalidResponseReason = "DOMAIN" | "IDENTITY" | "PROVENANCE" | "SCHEMA";

const INVALID_RESPONSE_REASONS: Readonly<Record<InvalidResponseReason, string>> = Object.freeze({
  DOMAIN: "AI response failed domain validation",
  IDENTITY: "AI response identity does not match the request",
  PROVENANCE: "AI response references source evidence outside the request",
  SCHEMA: "AI response failed ai-analysis/v1 schema validation",
});

const failedAnalysis = (
  context: AIAnalysisResponseContextV1,
  reason: InvalidResponseReason,
): Analysis =>
  createFailedAnalysis({
    analysisVersion: context.request.analysisVersion,
    correlationId: context.request.signal.correlationId,
    createdAt: context.request.createdAt,
    failureCode: "AI_INVALID_RESPONSE",
    failureReason: INVALID_RESPONSE_REASONS[reason],
    id: context.request.analysisId,
    model: context.model,
    promptVersion: context.request.promptVersion,
    provider: context.provider,
    retryable: false,
    schemaVersion: context.request.schemaVersion,
    signalId: context.request.signal.id,
  });

const matchesRequestIdentity = (
  response: AIAnalysisResponseV1,
  context: AIAnalysisResponseContextV1,
): boolean =>
  response.analysisId === context.request.analysisId &&
  response.analysisVersion === context.request.analysisVersion &&
  response.correlationId === context.request.signal.correlationId &&
  response.createdAt === context.request.createdAt &&
  response.model === context.model &&
  response.promptVersion === context.request.promptVersion &&
  response.provider === context.provider &&
  response.schemaVersion === context.request.schemaVersion &&
  response.signalId === context.request.signal.id;

const hasOnlyRequestSources = (
  response: AIAnalysisResponseV1,
  request: AIAnalysisRequest,
): boolean => {
  const permittedSourceIds = new Set<string>(request.evidence.map(({ sourceId: id }) => id));
  return response.sourceIds.every((id) => permittedSourceIds.has(id));
};

export const analysisFromAIResponseV1 = (
  rawResponse: unknown,
  context: AIAnalysisResponseContextV1,
): Analysis => {
  const parsed = AIAnalysisResponseV1Schema.safeParse(rawResponse);
  if (!parsed.success) {
    return failedAnalysis(context, "SCHEMA");
  }
  const response = parsed.data;
  if (!matchesRequestIdentity(response, context)) {
    return failedAnalysis(context, "IDENTITY");
  }
  if (!hasOnlyRequestSources(response, context.request)) {
    return failedAnalysis(context, "PROVENANCE");
  }

  try {
    return createSuccessfulAnalysis({
      actionability: response.actionability,
      analysisVersion: response.analysisVersion,
      businessImpact: response.businessImpact,
      candidateActions: response.candidateActions,
      confidence: response.confidence,
      correlationId: correlationId(response.correlationId),
      createdAt: response.createdAt,
      deadline: response.deadline,
      entities: response.entities,
      eventType: response.eventType,
      facts: response.facts.map((fact) => ({
        id: factId(fact.id),
        sourceIds: fact.sourceIds.map(sourceId),
        statement: fact.statement,
      })),
      headline: response.headline,
      id: analysisId(response.analysisId),
      inferences: response.inferences.map((inference) => ({
        basisFactIds: inference.basisFactIds.map(factId),
        id: inferenceId(inference.id),
        statement: inference.statement,
      })),
      model: response.model,
      promptVersion: response.promptVersion,
      provider: response.provider,
      risks: response.risks,
      schemaVersion: response.schemaVersion,
      signalId: signalId(response.signalId),
      summary: response.summary,
      urgency: response.urgency,
      whyImportant: response.whyImportant,
    });
  } catch {
    return failedAnalysis(context, "DOMAIN");
  }
};
