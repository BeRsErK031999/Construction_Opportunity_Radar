import {
  type Analysis,
  type AnalysisId,
  type CorrelationId,
  type HttpUrl,
  type IsoDateTime,
  type NormalizedItemId,
  type Score,
  type SignalId,
  type SourceId,
  type Version,
  type Vertical,
} from "@radar/core";

export const AI_PROVIDER_ERROR_CODES = [
  "AI_INPUT_TOO_LARGE",
  "AI_INVALID_REQUEST",
  "AI_INVALID_RESPONSE",
  "AI_RATE_LIMITED",
  "AI_TIMEOUT",
  "AI_UNAVAILABLE",
  "AI_INTERNAL_ERROR",
] as const;
export type AIProviderErrorCode = (typeof AI_PROVIDER_ERROR_CODES)[number];

const AI_PROVIDER_ERROR_MESSAGES: Readonly<Record<AIProviderErrorCode, string>> = Object.freeze({
  AI_INPUT_TOO_LARGE: "AI provider input exceeds its configured limit",
  AI_INTERNAL_ERROR: "AI provider failed internally",
  AI_INVALID_REQUEST: "AI provider request is invalid",
  AI_INVALID_RESPONSE: "AI provider returned an invalid response",
  AI_RATE_LIMITED: "AI provider rate limit was reached",
  AI_TIMEOUT: "AI provider request timed out",
  AI_UNAVAILABLE: "AI provider is unavailable",
});

export class AIProviderError extends Error {
  readonly code: AIProviderErrorCode;
  readonly retryable: boolean;

  constructor(code: AIProviderErrorCode, retryable: boolean) {
    super(AI_PROVIDER_ERROR_MESSAGES[code]);
    this.name = "AIProviderError";
    this.code = code;
    this.retryable = retryable;
  }
}

export interface AIAnalysisEvidenceEntity {
  readonly kind: string;
  readonly value: string;
}

export interface AIAnalysisEvidence {
  readonly canonicalUrl: HttpUrl;
  readonly entities: readonly AIAnalysisEvidenceEntity[];
  readonly language: string;
  readonly normalizedItemId: NormalizedItemId;
  readonly publishedAt: IsoDateTime | null;
  readonly sourceId: SourceId;
  readonly text: string;
  readonly title: string | null;
}

export interface AIAnalysisSignal {
  readonly category: string;
  readonly classificationConfidence: Score;
  readonly correlationId: CorrelationId;
  readonly id: SignalId;
  readonly normalizedItemIds: readonly NormalizedItemId[];
  readonly relevanceScore: Score;
  readonly sourceIds: readonly SourceId[];
  readonly vertical: Vertical;
}

export interface AIAnalysisRequest {
  readonly analysisId: AnalysisId;
  readonly analysisVersion: Version;
  readonly createdAt: IsoDateTime;
  readonly evidence: readonly AIAnalysisEvidence[];
  readonly promptVersion: Version;
  readonly schemaVersion: Version;
  readonly signal: AIAnalysisSignal;
}

export type AIProviderCapability = "STRUCTURED_ANALYSIS";

export interface AIProviderModelInfo {
  readonly capabilities: readonly AIProviderCapability[];
  readonly maxInputCharacters: number;
  readonly model: string;
  readonly provider: string;
}

export type AIProviderHealth =
  | {
      readonly failureCode: null;
      readonly model: string;
      readonly provider: string;
      readonly retryable: false;
      readonly status: "HEALTHY";
    }
  | {
      readonly failureCode: AIProviderErrorCode;
      readonly model: string;
      readonly provider: string;
      readonly retryable: boolean;
      readonly status: "UNHEALTHY";
    };

export interface AIProvider {
  analyzeSignal(request: AIAnalysisRequest): Promise<Analysis>;
  healthCheck(): Promise<AIProviderHealth>;
  modelInfo(): Promise<AIProviderModelInfo>;
}
