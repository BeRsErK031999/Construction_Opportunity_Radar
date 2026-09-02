import { createHash } from "node:crypto";

import {
  AIProviderError,
  type AIAnalysisRequest,
  type AIProvider,
  type AIProviderErrorCode,
  type AIProviderHealth,
  type AIProviderModelInfo,
} from "@radar/application";
import { createFailedAnalysis, nonEmptyString, type Analysis } from "@radar/core";

import { analysisFromAIResponseV1 } from "./ai-analysis-response-v1.js";

export type FakeAIProviderBehavior =
  | { readonly mode: "SUCCESS" }
  | { readonly mode: "INVALID_RESPONSE" }
  | {
      readonly code: AIProviderErrorCode;
      readonly mode: "FAILED_ANALYSIS";
      readonly retryable: boolean;
    }
  | {
      readonly code: AIProviderErrorCode;
      readonly mode: "THROW";
      readonly retryable: boolean;
    };

export interface FakeAIProviderOptions {
  readonly behavior?: FakeAIProviderBehavior;
  readonly healthStatus?: "HEALTHY" | "UNHEALTHY";
  readonly maxInputCharacters?: number;
  readonly model?: string;
  readonly provider?: string;
}

const DEFAULT_MAX_INPUT_CHARACTERS = 1_000_000;
const DEFAULT_MODEL = "fixture-analysis-v1";
const DEFAULT_PROVIDER = "fake";

const deterministicId = (kind: "fact" | "inference", values: readonly string[]): string => {
  const digest = createHash("sha256").update(JSON.stringify(values)).digest("hex").slice(0, 32);
  return `${kind}-${digest}`;
};

const compactText = (value: string, maxLength: number): string =>
  value.replace(/\s+/gu, " ").trim().slice(0, maxLength).trim();

const uniqueEntities = (request: AIAnalysisRequest): readonly string[] => {
  const seen = new Set<string>();
  const values: string[] = [];
  for (const entity of request.evidence.flatMap((evidence) => evidence.entities)) {
    const key = entity.value.toLocaleLowerCase("ru");
    if (!seen.has(key)) {
      seen.add(key);
      values.push(entity.value);
    }
    if (values.length === 100) {
      break;
    }
  }
  return values;
};

const validMaxInputCharacters = (value: number): number => {
  if (!Number.isInteger(value) || value < 1) {
    throw new RangeError("maxInputCharacters must be a positive integer");
  }
  return value;
};

export class FakeAIProvider implements AIProvider {
  readonly #behavior: FakeAIProviderBehavior;
  readonly #healthStatus: "HEALTHY" | "UNHEALTHY";
  readonly #maxInputCharacters: number;
  readonly #model: string;
  readonly #provider: string;

  constructor(options: FakeAIProviderOptions = {}) {
    this.#behavior = options.behavior ?? Object.freeze({ mode: "SUCCESS" });
    this.#healthStatus = options.healthStatus ?? "HEALTHY";
    this.#maxInputCharacters = validMaxInputCharacters(
      options.maxInputCharacters ?? DEFAULT_MAX_INPUT_CHARACTERS,
    );
    this.#model = nonEmptyString(options.model ?? DEFAULT_MODEL, "model", 200);
    this.#provider = nonEmptyString(options.provider ?? DEFAULT_PROVIDER, "provider", 100);
  }

  analyzeSignal(request: AIAnalysisRequest): Promise<Analysis> {
    if (request.evidence.length === 0) {
      return Promise.reject(new AIProviderError("AI_INVALID_REQUEST", false));
    }
    const inputCharacters = request.evidence.reduce(
      (total, evidence) => total + evidence.text.length + (evidence.title?.length ?? 0),
      0,
    );
    if (inputCharacters > this.#maxInputCharacters) {
      return Promise.reject(new AIProviderError("AI_INPUT_TOO_LARGE", false));
    }
    if (this.#behavior.mode === "THROW") {
      return Promise.reject(new AIProviderError(this.#behavior.code, this.#behavior.retryable));
    }
    if (this.#behavior.mode === "FAILED_ANALYSIS") {
      return Promise.resolve(
        createFailedAnalysis({
          analysisVersion: request.analysisVersion,
          correlationId: request.signal.correlationId,
          createdAt: request.createdAt,
          failureCode: this.#behavior.code,
          failureReason: "Fake provider was configured to return a failed analysis",
          id: request.analysisId,
          model: this.#model,
          promptVersion: request.promptVersion,
          provider: this.#provider,
          retryable: this.#behavior.retryable,
          schemaVersion: request.schemaVersion,
          signalId: request.signal.id,
        }),
      );
    }

    const facts = request.evidence.map((evidence) => ({
      id: deterministicId("fact", [
        request.analysisId,
        evidence.normalizedItemId,
        evidence.sourceId,
      ]),
      sourceIds: [evidence.sourceId],
      statement: compactText(evidence.text, 4_000),
    }));
    const basisFactIds = facts.map(({ id }) => id);
    const primaryEvidence = request.evidence[0];
    if (primaryEvidence === undefined) {
      return Promise.reject(new AIProviderError("AI_INVALID_REQUEST", false));
    }
    const primaryText = compactText(primaryEvidence.title ?? primaryEvidence.text, 460);
    const sourceCount = new Set(request.evidence.map(({ sourceId }) => sourceId)).size;

    const response = {
      actionability: 75,
      analysisId: request.analysisId,
      analysisVersion: request.analysisVersion,
      businessImpact: Math.round(
        (request.signal.relevanceScore + request.signal.classificationConfidence) / 2,
      ),
      candidateActions: [
        {
          kind: "VERIFY",
          priority: 1,
          rationale: "Подтвердить факты по сохранённым URL до принятия решения.",
          title: "Проверить исходные материалы",
        },
        {
          kind: "REVIEW",
          priority: 2,
          rationale: "Оценить соответствие сигнала профилю компании и текущим приоритетам.",
          title: "Провести внутреннюю оценку",
        },
      ],
      confidence: request.signal.classificationConfidence / 100,
      correlationId: request.signal.correlationId,
      createdAt: request.createdAt,
      deadline: null,
      entities: uniqueEntities(request),
      eventType: request.signal.category,
      facts,
      headline: compactText(`Тестовый анализ: ${primaryText}`, 500),
      inferences: [
        {
          basisFactIds,
          id: deterministicId("inference", [request.analysisId, request.signal.id]),
          statement: `Сигнал категории ${request.signal.category} требует проверки применимости к профилю компании.`,
        },
      ],
      model: this.#model,
      promptVersion: request.promptVersion,
      provider: this.#provider,
      risks: [
        "Анализ создан детерминированным тестовым провайдером.",
        "Перед действием необходимо проверить исходные материалы.",
      ],
      schemaVersion: request.schemaVersion,
      signalId: request.signal.id,
      sourceIds: [...new Set(facts.flatMap(({ sourceIds }) => sourceIds))],
      status: "SUCCEEDED",
      summary: `Сигнал ${request.signal.id} подтверждён ${String(sourceCount)} разрешёнными источниками в тестовом сценарии.`,
      urgency: Math.round(request.signal.classificationConfidence),
      whyImportant: `Категория ${request.signal.category} прошла детерминированную классификацию для вертикали ${request.signal.vertical}.`,
    };
    const rawResponse =
      this.#behavior.mode === "INVALID_RESPONSE" ? { ...response, facts: [] } : response;

    return Promise.resolve(
      analysisFromAIResponseV1(rawResponse, {
        model: this.#model,
        provider: this.#provider,
        request,
      }),
    );
  }

  healthCheck(): Promise<AIProviderHealth> {
    if (this.#healthStatus === "UNHEALTHY") {
      return Promise.resolve(
        Object.freeze({
          failureCode: "AI_UNAVAILABLE",
          model: this.#model,
          provider: this.#provider,
          retryable: true,
          status: "UNHEALTHY",
        }),
      );
    }
    return Promise.resolve(
      Object.freeze({
        failureCode: null,
        model: this.#model,
        provider: this.#provider,
        retryable: false,
        status: "HEALTHY",
      }),
    );
  }

  modelInfo(): Promise<AIProviderModelInfo> {
    return Promise.resolve(
      Object.freeze({
        capabilities: Object.freeze(["STRUCTURED_ANALYSIS"] as const),
        maxInputCharacters: this.#maxInputCharacters,
        model: this.#model,
        provider: this.#provider,
      }),
    );
  }
}
