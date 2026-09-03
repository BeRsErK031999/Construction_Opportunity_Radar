import { createHash } from "node:crypto";

import { createAIAnalysisRequest, type AIAnalysisRequest } from "@radar/application";
import { AI_ANALYSIS_SCHEMA_VERSION_V1, type EvalGoldItemV1 } from "@radar/contracts";
import {
  analysisId,
  correlationId,
  createNormalizedItem,
  createSignal,
  createSource,
  normalizedItemId,
  rawItemId,
  signalId,
  sourceId,
} from "@radar/core";

export const AI_BENCHMARK_ANALYSIS_VERSION_V1 = "benchmark-analysis/v1" as const;
export const AI_BENCHMARK_PROMPT_VERSION_V1 = "benchmark-prompt/v1" as const;

export interface CreateEvalBenchmarkRequestOptions {
  readonly analysisVersion?: string;
  readonly promptVersion?: string;
  readonly schemaVersion?: string;
}

export const createEvalBenchmarkRequest = (
  item: EvalGoldItemV1,
  options: CreateEvalBenchmarkRequestOptions = {},
): AIAnalysisRequest => {
  const itemCorrelationId = correlationId(`benchmark-${item.id}`);
  const itemNormalizedId = normalizedItemId(`benchmark-normalized-${item.id}`);
  const itemSourceId = sourceId(item.source.sourceId);
  const timestamp = item.source.publishedAt;
  const normalizedItem = createNormalizedItem({
    canonicalUrl: item.source.originalUrl,
    correlationId: itemCorrelationId,
    createdAt: timestamp,
    id: itemNormalizedId,
    language: "ru",
    normalizedHash: createHash("sha256").update(item.source.text).digest("hex"),
    normalizerVersion: "eval-input/v1",
    publishedAt: timestamp,
    rawItemId: rawItemId(`benchmark-raw-${item.id}`),
    text: item.source.text,
    title: item.source.title,
  });
  const source = createSource({
    aiProcessingAllowed: true,
    collectionPolicy: { parserKind: "FIXTURE_JSON" },
    country: "RU",
    createdAt: timestamp,
    enabled: true,
    id: itemSourceId,
    name: item.source.sourceName,
    regions: ["UNSPECIFIED"],
    reliabilityScore: 50,
    rightsBasis: item.source.rightsBasis,
    rightsStatus: "CONSENT",
    type: "FIXTURE",
    updatedAt: timestamp,
    url: `https://evals.radar.local/v1/sources/${item.source.sourceId}`,
    verticals: [item.labels.vertical],
  });
  const signal = createSignal({
    category: "UNCLASSIFIED",
    classificationConfidence: 50,
    classificationRuleIds: ["eval.input.vertical-only"],
    classifierVersion: "eval-input/v1",
    correlationId: itemCorrelationId,
    createdAt: timestamp,
    deduplicationRepresentativeNormalizedItemId: itemNormalizedId,
    deduplicatorVersion: "eval-input/v1",
    id: signalId(`benchmark-signal-${item.id}`),
    normalizedItemIds: [itemNormalizedId],
    relevanceScore: 50,
    sourceIds: [itemSourceId],
    status: "CANDIDATE",
    taxonomyVersion: "eval-input/v1",
    updatedAt: timestamp,
    vertical: item.labels.vertical,
  });

  return createAIAnalysisRequest({
    analysisId: analysisId(`benchmark-analysis-${item.id}`),
    analysisVersion: options.analysisVersion ?? AI_BENCHMARK_ANALYSIS_VERSION_V1,
    createdAt: timestamp,
    evidence: [{ normalizedItem, source }],
    promptVersion: options.promptVersion ?? AI_BENCHMARK_PROMPT_VERSION_V1,
    schemaVersion: options.schemaVersion ?? AI_ANALYSIS_SCHEMA_VERSION_V1,
    signal,
  });
};
