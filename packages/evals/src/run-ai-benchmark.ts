import { performance } from "node:perf_hooks";

import {
  AIProviderError,
  type AIAnalysisRequest,
  type AIProvider,
  type AIProviderModelInfo,
} from "@radar/application";
import {
  AI_ANALYSIS_SCHEMA_VERSION_V1,
  AI_BENCHMARK_REPORT_SCHEMA_VERSION_V1,
  AIBenchmarkReportV1Schema,
  AIAnalysisResponseV1Schema,
  type AIBenchmarkFailureV1,
  type AIBenchmarkReportV1,
  type EvalGoldDatasetV1,
  type EvalGoldItemV1,
} from "@radar/contracts";
import { type Analysis, type SuccessfulAnalysis } from "@radar/core";

import {
  AI_BENCHMARK_ANALYSIS_VERSION_V1,
  AI_BENCHMARK_PROMPT_VERSION_V1,
  createEvalBenchmarkRequest,
} from "./benchmark-request.js";
import { summarizeEvalGoldDataset } from "./eval-gold.js";

export type AIBenchmarkSplit = "ALL" | "CALIBRATION" | "HOLDOUT";

export interface AIBenchmarkTokenUsage {
  readonly generationDurationMs: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
}

export interface AIBenchmarkExecution {
  readonly analysis: Analysis;
  readonly tokenUsage: AIBenchmarkTokenUsage | null;
}

export type AIBenchmarkExecutor = (
  provider: AIProvider,
  request: AIAnalysisRequest,
) => Promise<AIBenchmarkExecution>;

export interface RunAIBenchmarkInput {
  readonly analysisVersion?: string;
  readonly clock?: () => Date;
  readonly dataset: EvalGoldDatasetV1;
  readonly executor?: AIBenchmarkExecutor;
  readonly monotonicNow?: () => number;
  readonly promptVersion?: string;
  readonly provider: AIProvider;
  readonly selectedSplit?: AIBenchmarkSplit;
  readonly vramPeakMiB?: number;
}

interface RelevanceCounts {
  falseNegative: number;
  falsePositive: number;
  trueNegative: number;
  truePositive: number;
}

interface FactualityCounts {
  evaluatedExpectedFacts: number;
  generatedFacts: number;
  matchedExpectedFacts: number;
  supportedGeneratedFacts: number;
}

const defaultExecutor: AIBenchmarkExecutor = async (provider, request) => ({
  analysis: await provider.analyzeSignal(request),
  tokenUsage: null,
});

const round = (value: number, digits: number): number => Number(value.toFixed(digits));

const ratio = (numerator: number, denominator: number): number | null =>
  denominator === 0 ? null : round(numerator / denominator, 6);

const normalizeText = (value: string): string =>
  value.replace(/\s+/gu, " ").trim().toLocaleLowerCase("ru");

const sameStringSet = (left: readonly string[], right: readonly string[]): boolean =>
  left.length === right.length &&
  new Set(left).size === left.length &&
  left.every((value) => right.includes(value));

const validSuccessfulAnalysis = (
  analysis: Analysis,
  request: AIAnalysisRequest,
  modelInfo: AIProviderModelInfo,
  analysisVersion: string,
  promptVersion: string,
): analysis is SuccessfulAnalysis => {
  if (analysis.status !== "SUCCEEDED") {
    return false;
  }
  const { id, ...analysisFields } = analysis;
  return (
    AIAnalysisResponseV1Schema.safeParse({ ...analysisFields, analysisId: id }).success &&
    analysis.id === request.analysisId &&
    analysis.signalId === request.signal.id &&
    analysis.correlationId === request.signal.correlationId &&
    analysis.provider === modelInfo.provider &&
    analysis.model === modelInfo.model &&
    analysis.analysisVersion === analysisVersion &&
    analysis.promptVersion === promptVersion &&
    analysis.schemaVersion === AI_ANALYSIS_SCHEMA_VERSION_V1 &&
    sameStringSet(analysis.sourceIds, request.signal.sourceIds)
  );
};

const selectedItems = (
  dataset: EvalGoldDatasetV1,
  split: AIBenchmarkSplit,
): readonly EvalGoldItemV1[] =>
  split === "ALL" ? dataset.items : dataset.items.filter((item) => item.split === split);

const percentile = (values: readonly number[], fraction: number): number | null => {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.max(0, Math.ceil(fraction * sorted.length) - 1);
  return round(sorted[index] ?? 0, 3);
};

const isPredictedRelevant = (analysis: SuccessfulAnalysis): boolean =>
  normalizeText(analysis.eventType) !== "irrelevant_notice";

const factSupportedByEvidence = (
  fact: SuccessfulAnalysis["facts"][number],
  request: AIAnalysisRequest,
): boolean => {
  const statement = normalizeText(fact.statement);
  return request.evidence.some(
    (evidence) =>
      fact.sourceIds.includes(evidence.sourceId) &&
      normalizeText(evidence.text).includes(statement),
  );
};

const expectedFactMatched = (
  fact: EvalGoldItemV1["labels"]["facts"][number],
  analysis: SuccessfulAnalysis,
): boolean => {
  const evidence = normalizeText(fact.evidenceQuote);
  return analysis.facts.some(({ statement }) => {
    const generated = normalizeText(statement);
    return generated.includes(evidence) || evidence.includes(generated);
  });
};

const failureFromError = (itemId: string, error: unknown): AIBenchmarkFailureV1 =>
  error instanceof AIProviderError
    ? Object.freeze({
        code: error.code,
        itemId,
        kind: "THROWN" as const,
        retryable: error.retryable,
      })
    : Object.freeze({
        code: "AI_INTERNAL_ERROR",
        itemId,
        kind: "THROWN" as const,
        retryable: false,
      });

const tokenMetrics = (
  usages: readonly AIBenchmarkTokenUsage[],
  attempted: number,
): AIBenchmarkReportV1["tokens"] => {
  if (usages.length === 0) {
    return {
      availability: "UNAVAILABLE",
      generationDurationMs: null,
      inputTokens: null,
      outputTokens: null,
      outputTokensPerSecond: null,
      samplesWithUsage: 0,
      totalTokens: null,
    };
  }
  const inputTokens = usages.reduce((total, usage) => total + usage.inputTokens, 0);
  const outputTokens = usages.reduce((total, usage) => total + usage.outputTokens, 0);
  const generationDurationMs = usages.reduce(
    (total, usage) => total + usage.generationDurationMs,
    0,
  );

  return {
    availability: usages.length === attempted ? "COMPLETE" : "PARTIAL",
    generationDurationMs: round(generationDurationMs, 3),
    inputTokens,
    outputTokens,
    outputTokensPerSecond:
      generationDurationMs === 0 ? null : round(outputTokens / (generationDurationMs / 1_000), 3),
    samplesWithUsage: usages.length,
    totalTokens: inputTokens + outputTokens,
  };
};

export const runAIBenchmark = async (input: RunAIBenchmarkInput): Promise<AIBenchmarkReportV1> => {
  const selectedSplit = input.selectedSplit ?? "ALL";
  const items = selectedItems(input.dataset, selectedSplit);
  const analysisVersion = input.analysisVersion ?? AI_BENCHMARK_ANALYSIS_VERSION_V1;
  const promptVersion = input.promptVersion ?? AI_BENCHMARK_PROMPT_VERSION_V1;
  const executor = input.executor ?? defaultExecutor;
  const clock = input.clock ?? (() => new Date());
  const monotonicNow = input.monotonicNow ?? (() => performance.now());
  const startedAt = clock();
  const runStarted = monotonicNow();
  const modelInfo = await input.provider.modelInfo();
  const health = await input.provider.healthCheck();

  if (!modelInfo.capabilities.includes("STRUCTURED_ANALYSIS")) {
    throw new Error("AI provider does not support structured analysis");
  }

  const failures: AIBenchmarkFailureV1[] = [];
  const latencies: number[] = [];
  const usages: AIBenchmarkTokenUsage[] = [];
  const relevance: RelevanceCounts = {
    falseNegative: 0,
    falsePositive: 0,
    trueNegative: 0,
    truePositive: 0,
  };
  const factuality: FactualityCounts = {
    evaluatedExpectedFacts: 0,
    generatedFacts: 0,
    matchedExpectedFacts: 0,
    supportedGeneratedFacts: 0,
  };
  let eventTypeCorrect = 0;
  let succeeded = 0;

  for (const item of items) {
    const request = createEvalBenchmarkRequest(item, { analysisVersion, promptVersion });
    const itemStarted = monotonicNow();
    try {
      const execution = await executor(input.provider, request);
      if (execution.tokenUsage !== null) {
        usages.push(execution.tokenUsage);
      }
      const { analysis } = execution;
      if (analysis.status === "FAILED") {
        failures.push(
          Object.freeze({
            code: analysis.failureCode,
            itemId: item.id,
            kind: "FAILED_ANALYSIS",
            retryable: analysis.retryable,
          }),
        );
      } else if (
        validSuccessfulAnalysis(analysis, request, modelInfo, analysisVersion, promptVersion)
      ) {
        succeeded += 1;
        if (normalizeText(analysis.eventType) === normalizeText(item.labels.eventType)) {
          eventTypeCorrect += 1;
        }

        const predictedRelevant = isPredictedRelevant(analysis);
        if (predictedRelevant && item.labels.relevant) {
          relevance.truePositive += 1;
        } else if (predictedRelevant) {
          relevance.falsePositive += 1;
        } else if (item.labels.relevant) {
          relevance.falseNegative += 1;
        } else {
          relevance.trueNegative += 1;
        }

        factuality.evaluatedExpectedFacts += item.labels.facts.length;
        factuality.matchedExpectedFacts += item.labels.facts.filter((fact) =>
          expectedFactMatched(fact, analysis),
        ).length;
        factuality.generatedFacts += analysis.facts.length;
        factuality.supportedGeneratedFacts += analysis.facts.filter((fact) =>
          factSupportedByEvidence(fact, request),
        ).length;
      } else {
        failures.push(
          Object.freeze({
            code: "AI_INVALID_RESPONSE",
            itemId: item.id,
            kind: "INVALID_ANALYSIS",
            retryable: false,
          }),
        );
      }
    } catch (error: unknown) {
      failures.push(failureFromError(item.id, error));
    } finally {
      latencies.push(round(Math.max(0, monotonicNow() - itemStarted), 3));
    }
  }

  const completedAt = clock();
  const attempted = items.length;
  const invalidResponses = failures.filter(({ code }) => code === "AI_INVALID_RESPONSE").length;
  const relevanceEvaluated =
    relevance.truePositive +
    relevance.trueNegative +
    relevance.falsePositive +
    relevance.falseNegative;
  const datasetSummary = summarizeEvalGoldDataset(input.dataset);
  const expectedFacts = items.reduce((total, item) => total + item.labels.facts.length, 0);
  const unsupportedGeneratedFacts = factuality.generatedFacts - factuality.supportedGeneratedFacts;
  const latencyTotal = latencies.reduce((total, latency) => total + latency, 0);

  return AIBenchmarkReportV1Schema.parse({
    classification: {
      eventType: {
        accuracy: ratio(eventTypeCorrect, succeeded),
        correct: eventTypeCorrect,
        evaluated: succeeded,
        unscored: attempted - succeeded,
      },
      relevance: {
        accuracy: ratio(relevance.truePositive + relevance.trueNegative, relevanceEvaluated),
        evaluated: relevanceEvaluated,
        f1: ratio(
          2 * relevance.truePositive,
          2 * relevance.truePositive + relevance.falsePositive + relevance.falseNegative,
        ),
        falseNegative: relevance.falseNegative,
        falsePositive: relevance.falsePositive,
        precision: ratio(relevance.truePositive, relevance.truePositive + relevance.falsePositive),
        recall: ratio(relevance.truePositive, relevance.truePositive + relevance.falseNegative),
        trueNegative: relevance.trueNegative,
        truePositive: relevance.truePositive,
        unscored: attempted - relevanceEvaluated,
      },
    },
    completedAt: completedAt.toISOString(),
    durationMs: round(Math.max(0, monotonicNow() - runStarted), 3),
    factuality: {
      evaluatedExpectedFacts: factuality.evaluatedExpectedFacts,
      expectedFactRecall: ratio(factuality.matchedExpectedFacts, factuality.evaluatedExpectedFacts),
      expectedFacts,
      generatedFactSupportRate: ratio(
        factuality.supportedGeneratedFacts,
        factuality.generatedFacts,
      ),
      generatedFacts: factuality.generatedFacts,
      hallucinationCount: unsupportedGeneratedFacts,
      matchedExpectedFacts: factuality.matchedExpectedFacts,
      supportedGeneratedFacts: factuality.supportedGeneratedFacts,
      unsupportedGeneratedFacts,
    },
    failures,
    health: {
      failureCode: health.failureCode,
      retryable: health.retryable,
      status: health.status,
    },
    latencyMs: {
      maximum: latencies.length === 0 ? null : round(Math.max(...latencies), 3),
      mean: latencies.length === 0 ? null : round(latencyTotal / latencies.length, 3),
      minimum: latencies.length === 0 ? null : round(Math.min(...latencies), 3),
      p50: percentile(latencies, 0.5),
      p95: percentile(latencies, 0.95),
      samples: latencies.length,
    },
    run: {
      analysisVersion,
      datasetId: input.dataset.datasetId,
      datasetSchemaVersion: input.dataset.schemaVersion,
      datasetSha256: datasetSummary.contentSha256,
      items: attempted,
      model: modelInfo.model,
      promptVersion,
      provider: modelInfo.provider,
      selectedSplit,
      structuredAnalysisSchemaVersion: AI_ANALYSIS_SCHEMA_VERSION_V1,
    },
    resources:
      input.vramPeakMiB === undefined
        ? { vramAvailability: "UNAVAILABLE", vramPeakMiB: null }
        : { vramAvailability: "MEASURED", vramPeakMiB: input.vramPeakMiB },
    schemaVersion: AI_BENCHMARK_REPORT_SCHEMA_VERSION_V1,
    startedAt: startedAt.toISOString(),
    tokens: tokenMetrics(usages, attempted),
    validity: {
      attempted,
      coverage: ratio(succeeded, attempted),
      invalidResponses,
      providerFailures: failures.length - invalidResponses,
      succeeded,
      validRate: ratio(succeeded, succeeded + invalidResponses),
    },
  });
};
