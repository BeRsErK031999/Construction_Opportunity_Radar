import {
  processOfflinePipeline,
  type Classifier,
  type Deduplicator,
  type RawItemNormalizer,
} from "@radar/application";
import { FakeAIProvider } from "@radar/ai-adapters";
import { AI_ANALYSIS_SCHEMA_VERSION_V1 } from "@radar/contracts";
import {
  CLASSIFIER_VERSION_V1,
  classifyCandidateV1,
  createUser,
  createUserProfile,
  DEDUPLICATOR_VERSION_V1,
  deduplicateCandidatesV1,
  NORMALIZER_VERSION_V1,
  normalizeRawItemV1,
  SIGNAL_TAXONOMY_VERSION_V1,
  userId,
  userProfileId,
} from "@radar/core";
import {
  createDatabaseClient,
  PrismaAnalysisRepository,
  PrismaClassificationRepository,
  PrismaDeduplicationRepository,
  PrismaNormalizationOutcomeRepository,
  PrismaProfileRegistrationRepository,
  PrismaRawItemRepository,
  PrismaRecommendationRepository,
  PrismaSourceRepository,
} from "@radar/db";
import {
  createFixtureSources,
  FixtureSourceAdapter,
  loadFixtureDataset,
} from "@radar/source-adapters";

import { databaseUrl } from "./database-url.js";

const fixturePath = new URL("../../../fixtures/ingestion/v1/dataset.json", import.meta.url);
const RUN_AT = "2026-09-10T00:00:00.000Z";
const ANALYSIS_VERSION = "analysis-v1";
const PROMPT_VERSION = "fixture-prompt-v1";

const normalizer: RawItemNormalizer = Object.freeze({
  normalize: normalizeRawItemV1,
  version: NORMALIZER_VERSION_V1,
});
const deduplicator: Deduplicator = Object.freeze({
  deduplicate: deduplicateCandidatesV1,
  version: DEDUPLICATOR_VERSION_V1,
});
const classifier: Classifier = Object.freeze({
  classify: classifyCandidateV1,
  taxonomyVersion: SIGNAL_TAXONOMY_VERSION_V1,
  version: CLASSIFIER_VERSION_V1,
});

const profiles = Object.freeze([
  Object.freeze({
    profile: createUserProfile({
      companySize: "SMALL",
      companyType: "Поставщик строительных материалов",
      createdAt: RUN_AT,
      id: userProfileId("72000000-0000-4000-8000-000000000001"),
      interestedEventTypes: ["CONSTRUCTION_PROJECT", "CONSTRUCTION_TENDER"],
      keywords: ["строительство", "тендер", "подряд"],
      regions: ["Алтайский край", "Новосибирская область"],
      revision: 1,
      servicesAndProducts: ["строительные материалы", "подрядные работы"],
      targetClients: ["застройщики", "генподрядчики"],
      updatedAt: RUN_AT,
      userId: userId("71000000-0000-4000-8000-000000000001"),
      verticals: ["CONSTRUCTION"],
    }),
    user: createUser({
      createdAt: RUN_AT,
      id: userId("71000000-0000-4000-8000-000000000001"),
      revision: 1,
      status: "ACTIVE",
      telegramUserId: "fixture-construction-user",
      updatedAt: RUN_AT,
    }),
  }),
  Object.freeze({
    profile: createUserProfile({
      companySize: "SMALL",
      companyType: "Поставщик оборудования для HoReCa",
      createdAt: RUN_AT,
      id: userProfileId("72000000-0000-4000-8000-000000000002"),
      interestedEventTypes: ["HORECA_OPENING", "HORECA_PROCUREMENT"],
      keywords: ["ресторан", "отель", "закупка"],
      regions: ["Новосибирская область", "Республика Алтай"],
      revision: 1,
      servicesAndProducts: ["оборудование для HoReCa", "оснащение заведений"],
      targetClients: ["рестораны", "отели"],
      updatedAt: RUN_AT,
      userId: userId("71000000-0000-4000-8000-000000000002"),
      verticals: ["HORECA"],
    }),
    user: createUser({
      createdAt: RUN_AT,
      id: userId("71000000-0000-4000-8000-000000000002"),
      revision: 1,
      status: "ACTIVE",
      telegramUserId: "fixture-horeca-user",
      updatedAt: RUN_AT,
    }),
  }),
]);

const main = async (): Promise<void> => {
  const dataset = await loadFixtureDataset(fixturePath);
  const sources = createFixtureSources(dataset);
  const adapter = new FixtureSourceAdapter(dataset, { now: () => RUN_AT });
  const client = createDatabaseClient(databaseUrl());

  await client.$connect();
  try {
    const summary = await processOfflinePipeline({
      adapter,
      analysisVersion: ANALYSIS_VERSION,
      classifier,
      deduplicator,
      identityNamespace: dataset.datasetId,
      normalizer,
      profiles,
      promptVersion: PROMPT_VERSION,
      provider: new FakeAIProvider(),
      repositories: {
        analyses: new PrismaAnalysisRepository(client),
        classification: new PrismaClassificationRepository(client),
        deduplication: new PrismaDeduplicationRepository(client),
        normalization: new PrismaNormalizationOutcomeRepository(client),
        profiles: new PrismaProfileRegistrationRepository(client),
        rawItems: new PrismaRawItemRepository(client),
        recommendations: new PrismaRecommendationRepository(client),
        sources: new PrismaSourceRepository(client),
      },
      runAt: RUN_AT,
      schemaVersion: AI_ANALYSIS_SCHEMA_VERSION_V1,
      sources,
    });
    process.stdout.write(
      `${JSON.stringify({
        analysisVersion: ANALYSIS_VERSION,
        classifierVersion: classifier.version,
        datasetId: dataset.datasetId,
        deduplicatorVersion: deduplicator.version,
        normalizerVersion: normalizer.version,
        promptVersion: PROMPT_VERSION,
        schemaVersion: AI_ANALYSIS_SCHEMA_VERSION_V1,
        ...summary,
      })}\n`,
    );
  } finally {
    await client.$disconnect();
  }
};

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown offline pipeline failure";
  process.stderr.write(`Offline fixture pipeline failed: ${message}\n`);
  process.exitCode = 1;
});
