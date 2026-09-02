import { createHash } from "node:crypto";

import {
  analysisId,
  correlationId,
  createRecommendationFromScoreV1,
  normalizedItemId,
  rawItemId,
  recommendationId,
  scoreAnalyzedSignalForProfileV1,
  type Analysis,
  type ClassificationCandidate,
  type NormalizedItem,
  type RawItem,
  type Recommendation,
  type Signal,
  type Source,
  type User,
  type UserProfile,
} from "@radar/core";

import { executeAIAnalysis, type AnalysisRepository } from "../analysis/analyze-signal.js";
import {
  executeClassification,
  type ClassificationSignalRepository,
  type Classifier,
} from "../classification/classify-deduplicated-clusters.js";
import {
  executeDeduplication,
  type DeduplicationRepository,
  type Deduplicator,
} from "../deduplication/deduplicate-normalized-items.js";
import { ingestSource } from "../ingestion/ingest-source.js";
import {
  executeNormalization,
  type NormalizationOutcomeRepository,
  type RawItemNormalizer,
} from "../normalization/normalize-raw-item.js";
import {
  AIAnalysisRequestError,
  createAIAnalysisRequest,
} from "../analysis/create-ai-analysis-request.js";
import { type AIProvider } from "../ports/ai-provider.js";
import {
  type IngestionIdentityFactory,
  type RawItemRepository,
  type SourceAdapter,
} from "../ports/source-adapter.js";

const DEFAULT_LIMIT = 10_000;

export interface OfflineSourceRepository {
  count(): Promise<number>;
  save(source: Source): Promise<Source>;
}

export interface OfflineRawItemRepository extends RawItemRepository {
  count(): Promise<number>;
  list(options?: { readonly limit?: number }): Promise<readonly RawItem[]>;
}

export interface OfflineClassificationRepository extends ClassificationSignalRepository {
  listCandidates(options: {
    readonly deduplicatorVersion: string;
    readonly limit?: number;
  }): Promise<readonly ClassificationCandidate[]>;
}

export interface OfflineNormalizationRepository extends NormalizationOutcomeRepository {
  countNormalizedItems(): Promise<number>;
}

export interface AIAnalysisCandidate {
  readonly evidence: readonly {
    readonly normalizedItem: NormalizedItem;
    readonly source: Source;
  }[];
  readonly signal: Signal;
}

export interface OfflineAnalysisRepository extends AnalysisRepository {
  listCandidates(options: {
    readonly classifierVersion: string;
    readonly limit?: number;
  }): Promise<readonly AIAnalysisCandidate[]>;
}

export interface ProfileRegistrationSaveResult {
  readonly createdProfile: boolean;
  readonly createdUser: boolean;
  readonly profile: UserProfile;
  readonly user: User;
}

export interface ProfileRegistrationRepository {
  countProfiles(): Promise<number>;
  save(user: User, profile: UserProfile): Promise<ProfileRegistrationSaveResult>;
}

export interface RecommendationSaveResult {
  readonly created: boolean;
  readonly recommendation: Recommendation;
}

export interface RecommendationRepository {
  count(): Promise<number>;
  save(recommendation: Recommendation): Promise<RecommendationSaveResult>;
}

export interface OfflinePipelineRepositories {
  readonly analyses: OfflineAnalysisRepository;
  readonly classification: OfflineClassificationRepository;
  readonly deduplication: DeduplicationRepository;
  readonly normalization: OfflineNormalizationRepository;
  readonly profiles: ProfileRegistrationRepository;
  readonly rawItems: OfflineRawItemRepository;
  readonly recommendations: RecommendationRepository;
  readonly sources: OfflineSourceRepository;
}

export interface OfflinePipelineProfile {
  readonly profile: UserProfile;
  readonly user: User;
}

export interface ProcessOfflinePipelineInput {
  readonly adapter: SourceAdapter;
  readonly analysisVersion: string;
  readonly classifier: Classifier;
  readonly deduplicator: Deduplicator;
  readonly identityNamespace: string;
  readonly limit?: number;
  readonly normalizer: RawItemNormalizer;
  readonly profiles: readonly OfflinePipelineProfile[];
  readonly promptVersion: string;
  readonly provider: AIProvider;
  readonly repositories: OfflinePipelineRepositories;
  readonly runAt: string;
  readonly schemaVersion: string;
  readonly sources: readonly Source[];
}

export interface OfflinePipelineSummary {
  readonly analysis: {
    readonly candidates: number;
    readonly created: number;
    readonly existing: number;
    readonly failed: number;
    readonly permissionRejected: number;
    readonly providerCalls: number;
    readonly succeeded: number;
    readonly total: number;
  };
  readonly classification: {
    readonly aiEligible: number;
    readonly created: number;
    readonly existing: number;
    readonly inputClusters: number;
    readonly irrelevant: number;
    readonly permissionDenied: number;
    readonly signals: number;
  };
  readonly deduplication: {
    readonly assignments: number;
    readonly clusters: number;
    readonly created: number;
    readonly duplicates: number;
    readonly existing: number;
  };
  readonly ingestion: {
    readonly aiPermissionPassedCreated: number;
    readonly candidates: number;
    readonly created: number;
    readonly existing: number;
    readonly rawItems: number;
    readonly sources: number;
  };
  readonly normalization: {
    readonly attempts: number;
    readonly created: number;
    readonly existing: number;
    readonly normalizedItems: number;
    readonly rejected: number;
    readonly succeeded: number;
  };
  readonly scoring: {
    readonly created: number;
    readonly eligiblePairs: number;
    readonly excluded: number;
    readonly existing: number;
    readonly profiles: number;
    readonly recommendations: number;
    readonly scored: number;
  };
}

const deterministicUuid = (namespace: string, kind: string, values: readonly unknown[]): string => {
  const hexadecimal = createHash("sha256")
    .update(JSON.stringify([namespace, kind, ...values]))
    .digest("hex")
    .slice(0, 32)
    .split("");
  hexadecimal[12] = "8";
  hexadecimal[16] = ["8", "9", "a", "b"][Number.parseInt(hexadecimal[16] ?? "0", 16) % 4] ?? "8";
  const compact = hexadecimal.join("");
  return `${compact.slice(0, 8)}-${compact.slice(8, 12)}-${compact.slice(12, 16)}-${compact.slice(16, 20)}-${compact.slice(20)}`;
};

const ingestionIdentities = (namespace: string): IngestionIdentityFactory => ({
  createCorrelationId: (source, candidate, index) =>
    correlationId(
      deterministicUuid(namespace, "correlation", [
        source.id,
        candidate.externalId,
        candidate.originalUrl,
        index,
      ]),
    ),
  createRawItemId: (source, candidate, index) =>
    rawItemId(
      deterministicUuid(namespace, "raw-item", [
        source.id,
        candidate.externalId,
        candidate.originalUrl,
        index,
      ]),
    ),
});

const successful = (
  analysis: Analysis,
): analysis is Extract<Analysis, { readonly status: "SUCCEEDED" }> =>
  analysis.status === "SUCCEEDED";

const sum = <Item>(items: readonly Item[], value: (item: Item) => number): number =>
  items.reduce((total, item) => total + value(item), 0);

export const processOfflinePipeline = async (
  input: ProcessOfflinePipelineInput,
): Promise<OfflinePipelineSummary> => {
  const limit = input.limit ?? DEFAULT_LIMIT;
  const repositories = input.repositories;
  for (const source of input.sources) {
    await repositories.sources.save(source);
  }

  const ingestion = [];
  const identities = ingestionIdentities(input.identityNamespace);
  for (const source of input.sources) {
    ingestion.push(
      await ingestSource({
        adapter: input.adapter,
        identities,
        rawItems: repositories.rawItems,
        source,
      }),
    );
  }

  const normalizations = [];
  for (const rawItem of await repositories.rawItems.list({ limit })) {
    normalizations.push(
      await executeNormalization({
        createdAt: input.runAt,
        id: normalizedItemId(
          deterministicUuid(input.identityNamespace, "normalized-item", [
            rawItem.id,
            input.normalizer.version,
          ]),
        ),
        normalizer: input.normalizer,
        rawItem,
        repository: repositories.normalization,
      }),
    );
  }

  const deduplicationCandidates = await repositories.deduplication.listCandidates({
    limit,
    normalizerVersion: input.normalizer.version,
  });
  const deduplication = await executeDeduplication({
    candidates: deduplicationCandidates,
    createdAt: input.runAt,
    deduplicator: input.deduplicator,
    repository: repositories.deduplication,
  });

  const classificationCandidates = await repositories.classification.listCandidates({
    deduplicatorVersion: input.deduplicator.version,
    limit,
  });
  const classification = await executeClassification({
    candidates: classificationCandidates,
    classifier: input.classifier,
    createdAt: input.runAt,
    repository: repositories.classification,
  });

  for (const registration of input.profiles) {
    await repositories.profiles.save(registration.user, registration.profile);
  }

  const modelInfo = await input.provider.modelInfo();
  if (!modelInfo.capabilities.includes("STRUCTURED_ANALYSIS")) {
    throw new Error("AI provider must support structured analysis");
  }
  const analysisCandidates = await repositories.analyses.listCandidates({
    classifierVersion: input.classifier.version,
    limit,
  });
  const analyses: {
    readonly analysis: Analysis;
    readonly created: boolean;
    readonly providerCalled: boolean;
    readonly candidate: AIAnalysisCandidate;
  }[] = [];
  let permissionRejected = 0;
  for (const candidate of analysisCandidates) {
    const identityValues = [
      candidate.signal.id,
      modelInfo.provider,
      modelInfo.model,
      input.promptVersion,
      input.schemaVersion,
      input.analysisVersion,
    ];
    try {
      const request = createAIAnalysisRequest({
        analysisId: analysisId(
          deterministicUuid(input.identityNamespace, "analysis", identityValues),
        ),
        analysisVersion: input.analysisVersion,
        createdAt: input.runAt,
        evidence: candidate.evidence,
        promptVersion: input.promptVersion,
        schemaVersion: input.schemaVersion,
        signal: candidate.signal,
      });
      const result = await executeAIAnalysis({
        modelInfo,
        provider: input.provider,
        repository: repositories.analyses,
        request,
      });
      analyses.push(Object.freeze({ ...result, candidate }));
    } catch (error) {
      if (error instanceof AIAnalysisRequestError && error.code === "AI_EVIDENCE_NOT_PERMITTED") {
        permissionRejected += 1;
        continue;
      }
      throw error;
    }
  }

  let eligiblePairs = 0;
  let scored = 0;
  let excluded = 0;
  let createdRecommendations = 0;
  let existingRecommendations = 0;
  for (const analyzed of analyses) {
    if (!successful(analyzed.analysis)) {
      continue;
    }
    for (const registration of input.profiles) {
      const signalVertical = analyzed.candidate.signal.vertical;
      if (signalVertical === "OTHER" || !registration.profile.verticals.includes(signalVertical)) {
        continue;
      }
      eligiblePairs += 1;
      const score = scoreAnalyzedSignalForProfileV1({
        analysis: analyzed.analysis,
        companyFitContext: {
          regions: [
            ...new Set(analyzed.candidate.evidence.flatMap(({ source }) => source.regions)),
          ],
          terms: analyzed.candidate.evidence.flatMap(({ normalizedItem }) => [
            ...(normalizedItem.title === null ? [] : [normalizedItem.title]),
            normalizedItem.text,
          ]),
        },
        profile: registration.profile,
        signal: analyzed.candidate.signal,
      });
      if (score.status === "EXCLUDED") {
        excluded += 1;
        continue;
      }
      scored += 1;
      const recommendation = createRecommendationFromScoreV1({
        analysisId: analyzed.analysis.id,
        correlationId: analyzed.analysis.correlationId,
        createdAt: input.runAt,
        id: recommendationId(
          deterministicUuid(input.identityNamespace, "recommendation", [
            analyzed.candidate.signal.id,
            analyzed.analysis.id,
            registration.profile.id,
            registration.profile.revision,
            score.scoringVersion,
          ]),
        ),
        recommendedActions: analyzed.analysis.candidateActions,
        score,
        signalId: analyzed.candidate.signal.id,
        sourceIds: analyzed.analysis.sourceIds,
        userProfileId: registration.profile.id,
        userProfileRevision: registration.profile.revision,
      });
      const saved = await repositories.recommendations.save(recommendation);
      if (saved.created) {
        createdRecommendations += 1;
      } else {
        existingRecommendations += 1;
      }
    }
  }

  return Object.freeze({
    analysis: Object.freeze({
      candidates: analysisCandidates.length,
      created: analyses.filter(({ created }) => created).length,
      existing: analyses.filter(({ created }) => !created).length,
      failed: analyses.filter(({ analysis }) => !successful(analysis)).length,
      permissionRejected,
      providerCalls: analyses.filter(({ providerCalled }) => providerCalled).length,
      succeeded: analyses.filter(({ analysis }) => successful(analysis)).length,
      total: await repositories.analyses.count(),
    }),
    classification: Object.freeze({
      aiEligible: classification.metrics.aiEligible,
      created: classification.persistence.created,
      existing: classification.persistence.existing,
      inputClusters: classification.metrics.inputClusters,
      irrelevant: classification.metrics.irrelevant,
      permissionDenied: classification.metrics.permissionDenied,
      signals: await repositories.classification.countSignals(input.classifier.version),
    }),
    deduplication: Object.freeze({
      assignments: await repositories.deduplication.countAssignments(input.deduplicator.version),
      clusters: await repositories.deduplication.countClusters(input.deduplicator.version),
      created: deduplication.persistence.created,
      duplicates: deduplication.deduplication.metrics.duplicates,
      existing: deduplication.persistence.existing,
    }),
    ingestion: Object.freeze({
      aiPermissionPassedCreated: sum(
        ingestion,
        ({ aiProcessingPermittedRawItemIds }) => aiProcessingPermittedRawItemIds.length,
      ),
      candidates: sum(ingestion, ({ candidates }) => candidates),
      created: sum(ingestion, ({ created }) => created),
      existing: sum(ingestion, ({ existing }) => existing),
      rawItems: await repositories.rawItems.count(),
      sources: await repositories.sources.count(),
    }),
    normalization: Object.freeze({
      attempts: await repositories.normalization.count(),
      created: normalizations.filter(({ created }) => created).length,
      existing: normalizations.filter(({ created }) => !created).length,
      normalizedItems: await repositories.normalization.countNormalizedItems(),
      rejected: normalizations.filter(({ outcome }) => outcome.status === "REJECTED").length,
      succeeded: normalizations.filter(({ outcome }) => outcome.status === "SUCCEEDED").length,
    }),
    scoring: Object.freeze({
      created: createdRecommendations,
      eligiblePairs,
      excluded,
      existing: existingRecommendations,
      profiles: await repositories.profiles.countProfiles(),
      recommendations: await repositories.recommendations.count(),
      scored,
    }),
  });
};
