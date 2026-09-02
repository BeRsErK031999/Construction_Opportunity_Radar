import { createFailedAnalysis, type Analysis, type SignalId } from "@radar/core";

import {
  AIProviderError,
  type AIAnalysisRequest,
  type AIProvider,
  type AIProviderErrorCode,
  type AIProviderModelInfo,
} from "../ports/ai-provider.js";

export interface AnalysisIdentity {
  readonly analysisVersion: string;
  readonly model: string;
  readonly promptVersion: string;
  readonly provider: string;
  readonly schemaVersion: string;
  readonly signalId: SignalId;
}

export interface AnalysisSaveResult {
  readonly analysis: Analysis;
  readonly created: boolean;
}

export interface AnalysisRepository {
  count(): Promise<number>;
  findByIdentity(identity: AnalysisIdentity): Promise<Analysis | null>;
  save(analysis: Analysis): Promise<AnalysisSaveResult>;
}

export interface ExecuteAIAnalysisInput {
  readonly modelInfo: AIProviderModelInfo;
  readonly provider: AIProvider;
  readonly repository: AnalysisRepository;
  readonly request: AIAnalysisRequest;
}

export interface ExecuteAIAnalysisResult extends AnalysisSaveResult {
  readonly providerCalled: boolean;
}

const identityFrom = (
  request: AIAnalysisRequest,
  modelInfo: AIProviderModelInfo,
): AnalysisIdentity =>
  Object.freeze({
    analysisVersion: request.analysisVersion,
    model: modelInfo.model,
    promptVersion: request.promptVersion,
    provider: modelInfo.provider,
    schemaVersion: request.schemaVersion,
    signalId: request.signal.id,
  });

const failedAnalysis = (
  request: AIAnalysisRequest,
  modelInfo: AIProviderModelInfo,
  code: AIProviderErrorCode,
  retryable: boolean,
  reason: string,
): Analysis =>
  createFailedAnalysis({
    analysisVersion: request.analysisVersion,
    correlationId: request.signal.correlationId,
    createdAt: request.createdAt,
    failureCode: code,
    failureReason: reason,
    id: request.analysisId,
    model: modelInfo.model,
    promptVersion: request.promptVersion,
    provider: modelInfo.provider,
    retryable,
    schemaVersion: request.schemaVersion,
    signalId: request.signal.id,
  });

const matchesRequest = (
  analysis: Analysis,
  request: AIAnalysisRequest,
  modelInfo: AIProviderModelInfo,
): boolean =>
  analysis.id === request.analysisId &&
  analysis.signalId === request.signal.id &&
  analysis.correlationId === request.signal.correlationId &&
  analysis.createdAt === request.createdAt &&
  analysis.provider === modelInfo.provider &&
  analysis.model === modelInfo.model &&
  analysis.promptVersion === request.promptVersion &&
  analysis.schemaVersion === request.schemaVersion &&
  analysis.analysisVersion === request.analysisVersion;

const safeFailure = (
  error: unknown,
): { readonly code: AIProviderErrorCode; readonly reason: string; readonly retryable: boolean } => {
  if (error instanceof AIProviderError) {
    return Object.freeze({
      code: error.code,
      reason: "AI provider failed before producing a valid analysis",
      retryable: error.retryable,
    });
  }
  return Object.freeze({
    code: "AI_INTERNAL_ERROR",
    reason: "AI provider failed with an unexpected internal error",
    retryable: true,
  });
};

export const executeAIAnalysis = async (
  input: ExecuteAIAnalysisInput,
): Promise<ExecuteAIAnalysisResult> => {
  const identity = identityFrom(input.request, input.modelInfo);
  const existing = await input.repository.findByIdentity(identity);
  if (existing !== null) {
    return Object.freeze({ analysis: existing, created: false, providerCalled: false });
  }

  let analysis: Analysis;
  try {
    const candidate = await input.provider.analyzeSignal(input.request);
    analysis = matchesRequest(candidate, input.request, input.modelInfo)
      ? candidate
      : failedAnalysis(
          input.request,
          input.modelInfo,
          "AI_INVALID_RESPONSE",
          false,
          "AI provider returned an analysis with mismatched identity",
        );
  } catch (error) {
    const failure = safeFailure(error);
    analysis = failedAnalysis(
      input.request,
      input.modelInfo,
      failure.code,
      failure.retryable,
      failure.reason,
    );
  }

  const saved = await input.repository.save(analysis);
  return Object.freeze({ ...saved, providerCalled: true });
};
