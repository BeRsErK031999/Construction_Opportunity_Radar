import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import {
  executeClassification,
  executeDeduplication,
  executeNormalization,
  deliverTelegramOpportunities,
  getUserFeedbackSummary,
  ingestSource,
  listSignalOpportunities,
  patchUserProfile,
  processOfflinePipeline,
  submitSignalFeedback,
  submitTelegramDeliveryFeedback,
  type Classifier,
  type Deduplicator,
  type RawItemNormalizer,
} from "@radar/application";
import { FakeAIProvider } from "@radar/ai-adapters";
import { FakeDeliveryAdapter } from "@radar/delivery-adapters";
import { AI_ANALYSIS_SCHEMA_VERSION_V1 } from "@radar/contracts";
import {
  CLASSIFIER_VERSION_V1,
  classifyCandidateV1,
  correlationId,
  createPendingDelivery,
  createRawItem,
  createSource,
  createUser,
  createUserProfile,
  DEDUPLICATOR_VERSION_V1,
  deduplicateCandidatesV1,
  deliveryId,
  feedbackId,
  isAiProcessingPermitted,
  markDeliveryFailed,
  markDeliverySent,
  NORMALIZER_VERSION_V1,
  normalizeRawItemV1,
  normalizedItemId,
  rawItemId,
  SIGNAL_TAXONOMY_VERSION_V1,
  sourceId,
  userId,
  userProfileId,
} from "@radar/core";
import {
  createFixtureSources,
  FixtureSourceAdapter,
  loadFixtureDataset,
} from "@radar/source-adapters";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  createDatabaseClient,
  PrismaAnalysisRepository,
  PrismaClassificationRepository,
  PrismaDeduplicationRepository,
  PrismaDeliveryRepository,
  PrismaFeedbackRepository,
  PrismaRawItemRepository,
  PrismaNormalizationOutcomeRepository,
  PrismaProfileRegistrationRepository,
  PrismaSourceRepository,
  PrismaRecommendationRepository,
  PrismaSignalOpportunityRepository,
  RawItemIdentityConflictError,
  seedDevelopmentDatabase,
  type DatabaseClient,
} from "../src/index.js";

const execFileAsync = promisify(execFile);
const dbPackageDirectory = fileURLToPath(new URL("..", import.meta.url));
const fixturePath = new URL("../../../fixtures/ingestion/v1/dataset.json", import.meta.url);
const prismaCli = fileURLToPath(
  new URL("../node_modules/prisma/build/prisma7.js", import.meta.url),
);

let container: StartedPostgreSqlContainer | undefined;
let client: DatabaseClient | undefined;

const database = (): DatabaseClient => {
  if (client === undefined) {
    throw new Error("Integration database is not initialized");
  }
  return client;
};

const migrate = async (databaseUrl: string): Promise<void> => {
  await execFileAsync(
    process.execPath,
    [prismaCli, "migrate", "deploy", "--config", "prisma.config.ts"],
    {
      cwd: dbPackageDirectory,
      env: { ...process.env, DATABASE_URL: databaseUrl },
      timeout: 60_000,
      windowsHide: true,
    },
  );
};

const testSource = () =>
  createSource({
    aiProcessingAllowed: true,
    collectionPolicy: { parserKind: "FIXTURE_JSON", pollIntervalMinutes: null },
    country: "RU",
    createdAt: "2026-09-01T00:00:00Z",
    enabled: true,
    id: sourceId("30000000-0000-4000-8000-000000000001"),
    name: "Integration fixture",
    regions: ["Алтайский край"],
    reliabilityScore: 90,
    rightsBasis: "Versioned integration fixture",
    rightsStatus: "OPEN_DATA",
    type: "FIXTURE",
    updatedAt: "2026-09-01T00:00:00Z",
    url: "https://fixtures.radar.local/integration",
    verticals: ["CONSTRUCTION"],
  });

const testRawItem = (overrides: {
  readonly content?: string;
  readonly externalId?: string;
  readonly id?: string;
}) => {
  const content = overrides.content ?? "Immutable integration evidence";
  return createRawItem({
    contentHash: createHash("sha256").update(content).digest("hex"),
    correlationId: correlationId("40000000-0000-4000-8000-000000000001"),
    externalId: overrides.externalId ?? "integration-1",
    id: rawItemId(overrides.id ?? "50000000-0000-4000-8000-000000000001"),
    originalUrl: "https://fixtures.radar.local/integration/items/1",
    rawPayload: { fixture: true },
    rawText: content,
    receivedAt: "2026-09-01T00:01:00Z",
    sourceId: testSource().id,
  });
};

const testProfiles = () => [
  {
    profile: createUserProfile({
      companySize: "SMALL",
      companyType: "Construction fixture company",
      createdAt: "2026-09-10T00:00:00Z",
      id: userProfileId("72000000-0000-4000-8000-000000000001"),
      interestedEventTypes: ["CONSTRUCTION_PROJECT", "CONSTRUCTION_TENDER"],
      regions: ["Алтайский край", "Новосибирская область"],
      revision: 1,
      servicesAndProducts: ["Строительные материалы"],
      updatedAt: "2026-09-10T00:00:00Z",
      userId: userId("71000000-0000-4000-8000-000000000001"),
      verticals: ["CONSTRUCTION"],
    }),
    user: createUser({
      createdAt: "2026-09-10T00:00:00Z",
      id: userId("71000000-0000-4000-8000-000000000001"),
      revision: 1,
      status: "ACTIVE",
      telegramUserId: "integration-construction-user",
      updatedAt: "2026-09-10T00:00:00Z",
    }),
  },
  {
    profile: createUserProfile({
      companySize: "SMALL",
      companyType: "HoReCa fixture company",
      createdAt: "2026-09-10T00:00:00Z",
      id: userProfileId("72000000-0000-4000-8000-000000000002"),
      interestedEventTypes: ["HORECA_OPENING", "HORECA_PROCUREMENT"],
      regions: ["Новосибирская область", "Республика Алтай"],
      revision: 1,
      servicesAndProducts: ["Оборудование для HoReCa"],
      updatedAt: "2026-09-10T00:00:00Z",
      userId: userId("71000000-0000-4000-8000-000000000002"),
      verticals: ["HORECA"],
    }),
    user: createUser({
      createdAt: "2026-09-10T00:00:00Z",
      id: userId("71000000-0000-4000-8000-000000000002"),
      revision: 1,
      status: "ACTIVE",
      telegramUserId: "integration-horeca-user",
      updatedAt: "2026-09-10T00:00:00Z",
    }),
  },
];

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:17.6-alpine")
    .withDatabase("radar_test")
    .withPassword("radar_test")
    .withUsername("radar_test")
    .start();
  const databaseUrl = container.getConnectionUri();
  await migrate(databaseUrl);
  client = createDatabaseClient(databaseUrl);
  await client.$connect();
}, 120_000);

beforeEach(async () => {
  await database().feedback.deleteMany();
  await database().delivery.deleteMany();
  await database().recommendationSource.deleteMany();
  await database().recommendation.deleteMany();
  await database().analysisSource.deleteMany();
  await database().analysis.deleteMany();
  await database().companyProfileRevision.deleteMany();
  await database().user.deleteMany();
  await database().signalEvidence.deleteMany();
  await database().signal.deleteMany();
  await database().deduplicationAssignment.deleteMany();
  await database().normalizationAttempt.deleteMany();
  await database().normalizedItem.deleteMany();
  await database().rawItem.deleteMany();
  await database().source.deleteMany();
});

afterAll(async () => {
  if (client !== undefined) {
    await client.$disconnect();
  }
  if (container !== undefined) {
    await container.stop();
  }
});

describe("PostgreSQL persistence", () => {
  it("round-trips Source and keeps its original creation timestamp on update", async () => {
    const repository = new PrismaSourceRepository(database());
    const source = testSource();
    await repository.save(source);

    const updated = createSource({
      ...source,
      name: "Updated integration fixture",
      updatedAt: "2026-09-01T01:00:00Z",
    });
    const saved = await repository.save(updated);

    expect(saved.name).toBe("Updated integration fixture");
    expect(saved.createdAt).toBe(source.createdAt);
    expect(await repository.count()).toBe(1);
  });

  it("enforces source AI permissions in PostgreSQL as well as in the domain", async () => {
    const source = testSource();

    await expect(
      database().source.create({
        data: {
          aiProcessingAllowed: true,
          country: source.country,
          createdAt: new Date(source.createdAt),
          enabled: true,
          id: source.id,
          name: source.name,
          parserKind: "FIXTURE_JSON",
          pollIntervalMinutes: null,
          regions: [...source.regions],
          reliabilityScore: 90,
          rightsBasis: null,
          rightsStatus: "REVIEW_REQUIRED",
          type: "FIXTURE",
          updatedAt: new Date(source.updatedAt),
          url: source.url,
          verticals: ["CONSTRUCTION"],
        },
      }),
    ).rejects.toThrow();
  });

  it("deduplicates RawItem by external ID and content hash without overwriting evidence", async () => {
    await new PrismaSourceRepository(database()).save(testSource());
    const repository = new PrismaRawItemRepository(database());
    const first = testRawItem({});

    expect((await repository.ingest(first)).created).toBe(true);
    expect(
      (await repository.ingest(testRawItem({ id: "50000000-0000-4000-8000-000000000002" })))
        .matchedBy,
    ).toBe("EXTERNAL_ID");
    expect(
      (
        await repository.ingest(
          testRawItem({
            externalId: "integration-2",
            id: "50000000-0000-4000-8000-000000000003",
          }),
        )
      ).matchedBy,
    ).toBe("CONTENT_HASH");
    expect(await repository.count()).toBe(1);

    await expect(
      repository.ingest(
        testRawItem({
          content: "Changed content behind a reused external identity",
          id: "50000000-0000-4000-8000-000000000004",
        }),
      ),
    ).rejects.toBeInstanceOf(RawItemIdentityConflictError);
  });

  it("seeds exactly 10 sources, 100 raw items, and zero signals repeatably", async () => {
    const first = await seedDevelopmentDatabase(database());
    const second = await seedDevelopmentDatabase(database());

    expect(first).toEqual({ createdRawItems: 100, rawItems: 100, signals: 0, sources: 10 });
    expect(second).toEqual({ createdRawItems: 0, rawItems: 100, signals: 0, sources: 10 });
  });

  it("ingests the complete fixture corpus repeatably and enforces AI permission", async () => {
    const dataset = await loadFixtureDataset(fixturePath);
    const sources = createFixtureSources(dataset);
    const adapter = new FixtureSourceAdapter(dataset, {
      now: () => "2026-09-01T12:00:00.000Z",
    });
    const sourceRepository = new PrismaSourceRepository(database());
    const rawItemRepository = new PrismaRawItemRepository(database());
    const identities = {
      createCorrelationId: () => randomUUID(),
      createRawItemId: () => rawItemId(randomUUID()),
    };

    for (const source of sources) {
      await sourceRepository.save(source);
    }

    const first = [];
    const second = [];
    for (const source of sources) {
      first.push(
        await ingestSource({
          adapter,
          identities,
          rawItems: rawItemRepository,
          source,
        }),
      );
    }
    for (const source of sources) {
      second.push(
        await ingestSource({
          adapter,
          identities,
          rawItems: rawItemRepository,
          source,
        }),
      );
    }

    expect(first.reduce((total, result) => total + result.created, 0)).toBe(200);
    expect(second.reduce((total, result) => total + result.created, 0)).toBe(0);
    expect(second.reduce((total, result) => total + result.existing, 0)).toBe(200);
    const aiProcessingPermitted = first.reduce(
      (total, result) => total + result.aiProcessingPermittedRawItemIds.length,
      0,
    );
    const permittedSourceIds: ReadonlySet<string> = new Set(
      sources.filter(isAiProcessingPermitted).map((source) => source.id),
    );
    const expectedAiProcessingPermitted = dataset.items.filter((item) =>
      permittedSourceIds.has(item.sourceId),
    ).length;

    expect(aiProcessingPermitted).toBe(expectedAiProcessingPermitted);
    expect(aiProcessingPermitted).toBe(176);
    expect(await sourceRepository.count()).toBe(10);
    expect(await rawItemRepository.count()).toBe(200);
    expect(await database().signal.count()).toBe(0);
  });

  it("normalizes all fixtures repeatably without changing raw evidence", async () => {
    const dataset = await loadFixtureDataset(fixturePath);
    const sources = createFixtureSources(dataset);
    const adapter = new FixtureSourceAdapter(dataset, {
      now: () => "2026-09-02T00:00:00.000Z",
    });
    const sourceRepository = new PrismaSourceRepository(database());
    const rawItemRepository = new PrismaRawItemRepository(database());
    const outcomeRepository = new PrismaNormalizationOutcomeRepository(database());
    const normalizer: RawItemNormalizer = {
      normalize: normalizeRawItemV1,
      version: NORMALIZER_VERSION_V1,
    };

    for (const source of sources) {
      await sourceRepository.save(source);
      await ingestSource({
        adapter,
        identities: {
          createCorrelationId: () => randomUUID(),
          createRawItemId: () => rawItemId(randomUUID()),
        },
        rawItems: rawItemRepository,
        source,
      });
    }

    const rawItems = await rawItemRepository.list({ limit: 1_000 });
    const rawEvidence = new Map(rawItems.map((item) => [item.id, item.rawText]));
    const first = [];
    const second = [];
    for (const rawItem of rawItems) {
      first.push(
        await executeNormalization({
          createdAt: "2026-09-02T00:01:00.000Z",
          id: normalizedItemId(randomUUID()),
          normalizer,
          rawItem,
          repository: outcomeRepository,
        }),
      );
    }
    for (const rawItem of rawItems) {
      second.push(
        await executeNormalization({
          createdAt: "2026-09-02T00:02:00.000Z",
          id: normalizedItemId(randomUUID()),
          normalizer,
          rawItem,
          repository: outcomeRepository,
        }),
      );
    }

    expect(first.filter((result) => result.created)).toHaveLength(200);
    expect(first.every((result) => result.outcome.status === "SUCCEEDED")).toBe(true);
    expect(second.filter((result) => result.created)).toHaveLength(0);
    expect(await outcomeRepository.count()).toBe(200);
    expect(await outcomeRepository.countNormalizedItems()).toBe(200);
    const persistedRawItems = await rawItemRepository.list({ limit: 1_000 });
    expect(persistedRawItems).toHaveLength(200);
    expect(persistedRawItems.every((item) => rawEvidence.get(item.id) === item.rawText)).toBe(true);
  });

  it("persists an explicit rejection when normalized text is empty", async () => {
    const source = testSource();
    await new PrismaSourceRepository(database()).save(source);
    const rawItemRepository = new PrismaRawItemRepository(database());
    const outcomeRepository = new PrismaNormalizationOutcomeRepository(database());
    const rawItem = testRawItem({
      content: "<html><body><script>ignored()</script></body></html>",
      id: "50000000-0000-4000-8000-000000000099",
    });
    await rawItemRepository.ingest(rawItem);

    const result = await executeNormalization({
      createdAt: "2026-09-02T00:01:00.000Z",
      id: normalizedItemId("70000000-0000-4000-8000-000000000001"),
      normalizer: { normalize: normalizeRawItemV1, version: NORMALIZER_VERSION_V1 },
      rawItem,
      repository: outcomeRepository,
    });

    expect(result).toMatchObject({
      created: true,
      outcome: { rejectionCode: "EMPTY_NORMALIZED_TEXT", status: "REJECTED" },
    });
    expect(await outcomeRepository.count()).toBe(1);
    expect(await outcomeRepository.countNormalizedItems()).toBe(0);
    expect((await rawItemRepository.findById(rawItem.id))?.rawText).toBe(rawItem.rawText);
  });

  it("deduplicates the 200-item fixture corpus into 150 evidence-backed clusters", async () => {
    const dataset = await loadFixtureDataset(fixturePath);
    const sources = createFixtureSources(dataset);
    const adapter = new FixtureSourceAdapter(dataset, {
      now: () => "2026-09-02T00:00:00.000Z",
    });
    const sourceRepository = new PrismaSourceRepository(database());
    const rawItemRepository = new PrismaRawItemRepository(database());
    const normalizationRepository = new PrismaNormalizationOutcomeRepository(database());
    const deduplicationRepository = new PrismaDeduplicationRepository(database());
    const deduplicator: Deduplicator = {
      deduplicate: deduplicateCandidatesV1,
      version: DEDUPLICATOR_VERSION_V1,
    };

    for (const source of sources) {
      await sourceRepository.save(source);
      await ingestSource({
        adapter,
        identities: {
          createCorrelationId: () => randomUUID(),
          createRawItemId: () => rawItemId(randomUUID()),
        },
        rawItems: rawItemRepository,
        source,
      });
    }
    for (const rawItem of await rawItemRepository.list({ limit: 1_000 })) {
      await executeNormalization({
        createdAt: "2026-09-02T00:01:00.000Z",
        id: normalizedItemId(randomUUID()),
        normalizer: { normalize: normalizeRawItemV1, version: NORMALIZER_VERSION_V1 },
        rawItem,
        repository: normalizationRepository,
      });
    }

    const candidates = await deduplicationRepository.listCandidates({
      limit: 1_000,
      normalizerVersion: NORMALIZER_VERSION_V1,
    });
    const first = await executeDeduplication({
      candidates,
      createdAt: "2026-09-02T00:02:00.000Z",
      deduplicator,
      repository: deduplicationRepository,
    });
    const second = await executeDeduplication({
      candidates,
      createdAt: "2026-09-02T00:03:00.000Z",
      deduplicator,
      repository: deduplicationRepository,
    });

    expect(first.deduplication.metrics).toMatchObject({
      clusters: 150,
      duplicates: 50,
      exactDuplicates: 25,
      inputItems: 200,
      nearDuplicates: 25,
    });
    expect(first.persistence).toMatchObject({ assignments: 200, created: 200, existing: 0 });
    expect(second.persistence).toMatchObject({ assignments: 200, created: 0, existing: 200 });
    expect(await deduplicationRepository.countAssignments(deduplicator.version)).toBe(200);
    expect(await deduplicationRepository.countClusters(deduplicator.version)).toBe(150);
    expect(await database().signal.count()).toBe(0);
  });

  it("classifies 150 fixture clusters repeatably and persists only permitted relevant signals", async () => {
    const dataset = await loadFixtureDataset(fixturePath);
    const sources = createFixtureSources(dataset);
    const adapter = new FixtureSourceAdapter(dataset, {
      now: () => "2026-09-02T00:00:00.000Z",
    });
    const sourceRepository = new PrismaSourceRepository(database());
    const rawItemRepository = new PrismaRawItemRepository(database());
    const normalizationRepository = new PrismaNormalizationOutcomeRepository(database());
    const deduplicationRepository = new PrismaDeduplicationRepository(database());
    const classificationRepository = new PrismaClassificationRepository(database());
    const deduplicator: Deduplicator = {
      deduplicate: deduplicateCandidatesV1,
      version: DEDUPLICATOR_VERSION_V1,
    };
    const classifier: Classifier = {
      classify: classifyCandidateV1,
      taxonomyVersion: SIGNAL_TAXONOMY_VERSION_V1,
      version: CLASSIFIER_VERSION_V1,
    };

    for (const source of sources) {
      await sourceRepository.save(source);
      await ingestSource({
        adapter,
        identities: {
          createCorrelationId: () => randomUUID(),
          createRawItemId: () => rawItemId(randomUUID()),
        },
        rawItems: rawItemRepository,
        source,
      });
    }
    for (const rawItem of await rawItemRepository.list({ limit: 1_000 })) {
      await executeNormalization({
        createdAt: "2026-09-02T00:01:00.000Z",
        id: normalizedItemId(randomUUID()),
        normalizer: { normalize: normalizeRawItemV1, version: NORMALIZER_VERSION_V1 },
        rawItem,
        repository: normalizationRepository,
      });
    }
    const deduplicationCandidates = await deduplicationRepository.listCandidates({
      limit: 1_000,
      normalizerVersion: NORMALIZER_VERSION_V1,
    });
    await executeDeduplication({
      candidates: deduplicationCandidates,
      createdAt: "2026-09-02T00:02:00.000Z",
      deduplicator,
      repository: deduplicationRepository,
    });

    const classificationCandidates = await classificationRepository.listCandidates({
      deduplicatorVersion: deduplicator.version,
      limit: 1_000,
    });
    const first = await executeClassification({
      candidates: classificationCandidates,
      classifier,
      createdAt: "2026-09-02T00:03:00.000Z",
      repository: classificationRepository,
    });
    const second = await executeClassification({
      candidates: classificationCandidates,
      classifier,
      createdAt: "2026-09-02T00:04:00.000Z",
      repository: classificationRepository,
    });

    expect(first.metrics).toEqual({
      aiEligible: 110,
      construction: 63,
      horeca: 60,
      inputClusters: 150,
      irrelevant: 28,
      other: 15,
      permissionDenied: 12,
    });
    expect(first.persistence).toEqual({ created: 110, existing: 0, signals: 110 });
    expect(second.persistence).toEqual({ created: 0, existing: 110, signals: 110 });
    expect(await classificationRepository.countSignals(classifier.version)).toBe(110);
    expect(
      await database().signal.count({
        where: { evidence: { some: { source: { aiProcessingAllowed: false } } } },
      }),
    ).toBe(0);
    const persistedSignals = await database().signal.findMany({
      select: { classificationRuleIds: true },
    });
    expect(persistedSignals.every((signal) => signal.classificationRuleIds.length > 0)).toBe(true);
  });

  it("processes fixtures through fake analysis and scoring exactly once", async () => {
    const runAt = "2026-09-10T00:00:00.000Z";
    const dataset = await loadFixtureDataset(fixturePath);
    const sources = createFixtureSources(dataset);
    const client = database();
    const repositories = {
      analyses: new PrismaAnalysisRepository(client),
      classification: new PrismaClassificationRepository(client),
      deduplication: new PrismaDeduplicationRepository(client),
      normalization: new PrismaNormalizationOutcomeRepository(client),
      profiles: new PrismaProfileRegistrationRepository(client),
      rawItems: new PrismaRawItemRepository(client),
      recommendations: new PrismaRecommendationRepository(client),
      sources: new PrismaSourceRepository(client),
    };
    const input = {
      adapter: new FixtureSourceAdapter(dataset, { now: () => runAt }),
      analysisVersion: "analysis-v1",
      classifier: {
        classify: classifyCandidateV1,
        taxonomyVersion: SIGNAL_TAXONOMY_VERSION_V1,
        version: CLASSIFIER_VERSION_V1,
      },
      deduplicator: {
        deduplicate: deduplicateCandidatesV1,
        version: DEDUPLICATOR_VERSION_V1,
      },
      identityNamespace: dataset.datasetId,
      normalizer: { normalize: normalizeRawItemV1, version: NORMALIZER_VERSION_V1 },
      profiles: testProfiles(),
      promptVersion: "fixture-prompt-v1",
      provider: new FakeAIProvider(),
      repositories,
      runAt,
      schemaVersion: AI_ANALYSIS_SCHEMA_VERSION_V1,
      sources,
    } as const;

    const first = await processOfflinePipeline(input);
    const second = await processOfflinePipeline({
      ...input,
      adapter: new FixtureSourceAdapter(dataset, { now: () => "2026-09-10T01:00:00.000Z" }),
      runAt: "2026-09-10T01:00:00.000Z",
    });

    expect(first).toMatchObject({
      analysis: {
        candidates: 110,
        created: 110,
        failed: 0,
        providerCalls: 110,
        succeeded: 110,
        total: 110,
      },
      classification: { aiEligible: 110, created: 110, signals: 110 },
      deduplication: { assignments: 200, clusters: 150, created: 200 },
      ingestion: { aiPermissionPassedCreated: 176, created: 200, rawItems: 200, sources: 10 },
      normalization: { attempts: 200, created: 200, normalizedItems: 200 },
      scoring: { created: 110, eligiblePairs: 110, profiles: 2, recommendations: 110 },
    });
    expect(second).toMatchObject({
      analysis: { created: 0, existing: 110, providerCalls: 0, total: 110 },
      classification: { created: 0, existing: 110, signals: 110 },
      deduplication: { created: 0, existing: 200 },
      ingestion: { created: 0, existing: 200, rawItems: 200 },
      normalization: { created: 0, existing: 200, normalizedItems: 200 },
      scoring: { created: 0, existing: 110, recommendations: 110 },
    });
    expect(
      await client.analysis.count({
        where: { sources: { some: { source: { aiProcessingAllowed: false } } } },
      }),
    ).toBe(0);

    const constructionRegistration = input.profiles[0];
    if (constructionRegistration === undefined) {
      throw new Error("Construction profile fixture is required");
    }
    const opportunityRepository = new PrismaSignalOpportunityRepository(client);
    const opportunities = await listSignalOpportunities({
      callerUserId: constructionRegistration.user.id,
      filter: {
        limit: 2,
        minimumScore: 0,
        status: "CANDIDATE",
        vertical: "CONSTRUCTION",
      },
      repository: opportunityRepository,
    });
    const firstOpportunity = opportunities.items[0];
    const secondOpportunity = opportunities.items[1];
    if (firstOpportunity === undefined || secondOpportunity === undefined) {
      throw new Error("At least two persisted opportunities are required");
    }
    expect(opportunities.items).toHaveLength(2);
    expect(opportunities.items.every((item) => item.analysis.facts.length > 0)).toBe(true);
    expect(firstOpportunity.sources.length).toBeGreaterThan(0);
    expect(
      await opportunityRepository.findForUser(
        constructionRegistration.user.id,
        firstOpportunity.signal.id,
      ),
    ).toMatchObject({ signal: { id: firstOpportunity.signal.id } });

    const feedbackRepository = new PrismaFeedbackRepository(client);
    const deliveryRepository = new PrismaDeliveryRepository(client);
    const deliveryAdapter = new FakeDeliveryAdapter();
    const deliveryInput = {
      deliveryIdFactory: () => deliveryId("74000000-0000-4000-8000-000000000001"),
      interactionId: "telegram-update-1",
      limit: 1,
      mode: "NEW" as const,
      now: () => "2026-09-10T01:30:00.000Z",
      port: deliveryAdapter,
      repositories: {
        deliveries: deliveryRepository,
        saved: opportunityRepository,
        signals: opportunityRepository,
        users: repositories.profiles,
      },
      telegramUserId: constructionRegistration.user.telegramUserId,
    };
    const delivered = await deliverTelegramOpportunities(deliveryInput);
    const replayedDelivery = await deliverTelegramOpportunities(deliveryInput);
    expect(delivered.deliveries[0]).toMatchObject({ status: "SENT" });
    expect(replayedDelivery.deliveries[0]?.id).toBe(delivered.deliveries[0]?.id);
    expect(deliveryAdapter.sent).toHaveLength(1);
    expect(await client.delivery.count()).toBe(1);

    const pendingRace = await deliveryRepository.save(
      createPendingDelivery({
        channel: "TELEGRAM",
        correlationId: firstOpportunity.recommendation.correlationId,
        createdAt: "2026-09-10T01:32:00.000Z",
        id: deliveryId("74000000-0000-4000-8000-000000000002"),
        idempotencyKey: "telegram-terminal-race",
        kind: "OPPORTUNITY",
        recommendationId: firstOpportunity.recommendation.id,
        userId: constructionRegistration.user.id,
      }),
    );
    const racedOutcomes = await Promise.allSettled([
      deliveryRepository.save(
        markDeliverySent(pendingRace, "race-provider-message", "2026-09-10T01:33:00.000Z"),
      ),
      deliveryRepository.save(
        markDeliveryFailed(
          pendingRace,
          "RACE_FAILURE",
          "Safe concurrent failure",
          "2026-09-10T01:33:00.000Z",
        ),
      ),
    ]);
    expect(racedOutcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    expect(racedOutcomes.filter((outcome) => outcome.status === "rejected")).toHaveLength(1);
    expect((await deliveryRepository.findById(pendingRace.id))?.status).toMatch(/^(FAILED|SENT)$/);
    await expect(
      client.feedback.create({
        data: {
          action: "SAVED",
          correlationId: firstOpportunity.recommendation.correlationId,
          createdAt: new Date("2026-09-10T01:30:15.000Z"),
          deliveryId: deliveryId("74000000-0000-4000-8000-000000000001"),
          id: feedbackId("76000000-0000-4000-8000-000000000001"),
          recommendationId: secondOpportunity.recommendation.id,
          userId: constructionRegistration.user.id,
        },
      }),
    ).rejects.toMatchObject({ code: "P2003" });

    const directNotUseful = await submitSignalFeedback({
      action: "NOT_USEFUL",
      callerUserId: constructionRegistration.user.id,
      feedbackId: feedbackId("73000000-0000-4000-8000-000000000001"),
      now: "2026-09-10T01:30:30.000Z",
      reason: "Потребность уже закрыта",
      repository: feedbackRepository,
      signalId: firstOpportunity.signal.id,
    });
    expect(directNotUseful.feedback.reason).toBe("Потребность уже закрыта");

    const telegramFeedback = (action: "ACTED" | "ALREADY_KNOWN" | "SAVED", id: string) =>
      submitTelegramDeliveryFeedback({
        action,
        deliveryId: deliveryId("74000000-0000-4000-8000-000000000001"),
        feedbackId: feedbackId(id),
        now: "2026-09-10T01:31:00.000Z",
        repositories: {
          deliveries: deliveryRepository,
          feedback: feedbackRepository,
          users: repositories.profiles,
        },
        telegramUserId: constructionRegistration.user.telegramUserId,
      });
    const savedFeedback = await telegramFeedback("SAVED", "75000000-0000-4000-8000-000000000001");
    const actedRace = await Promise.all([
      telegramFeedback("ACTED", "75000000-0000-4000-8000-000000000002"),
      telegramFeedback("ACTED", "75000000-0000-4000-8000-000000000003"),
    ]);
    const alreadyKnownFeedback = await telegramFeedback(
      "ALREADY_KNOWN",
      "75000000-0000-4000-8000-000000000004",
    );
    expect([
      savedFeedback.feedback.action,
      ...actedRace.map((outcome) => outcome.feedback.action),
      alreadyKnownFeedback.feedback.action,
    ]).toEqual(["SAVED", "ACTED", "ACTED", "ALREADY_KNOWN"]);
    expect(actedRace.map((outcome) => outcome.created).sort()).toEqual([false, true]);
    expect(
      await opportunityRepository.listSavedForUser(constructionRegistration.user.id, 5),
    ).toHaveLength(1);

    const updatedProfile = await patchUserProfile({
      callerUserId: constructionRegistration.user.id,
      now: "2026-09-10T02:00:00.000Z",
      patch: { keywords: ["бетон", "генподряд"] },
      repository: repositories.profiles,
      userId: constructionRegistration.user.id,
    });
    expect(updatedProfile.revision).toBe(2);
    expect(
      (await repositories.profiles.findLatest(constructionRegistration.user.id))?.profile,
    ).toMatchObject({
      keywords: ["бетон", "генподряд"],
      revision: 2,
    });
    expect(
      (
        await listSignalOpportunities({
          callerUserId: constructionRegistration.user.id,
          filter: { limit: 2 },
          repository: opportunityRepository,
        })
      ).items,
    ).toHaveLength(0);

    const feedbackInput = {
      action: "USEFUL" as const,
      callerUserId: constructionRegistration.user.id,
      feedbackId: feedbackId("73000000-0000-4000-8000-000000000002"),
      reason: "Передали менеджеру по продажам",
      repository: feedbackRepository,
      signalId: secondOpportunity.signal.id,
    };
    const feedbackCreated = await submitSignalFeedback({
      ...feedbackInput,
      now: "2026-09-10T02:01:00.000Z",
    });
    const feedbackRepeated = await submitSignalFeedback({
      ...feedbackInput,
      now: "2026-09-10T02:02:00.000Z",
    });
    expect(feedbackCreated.created).toBe(true);
    expect(feedbackRepeated.created).toBe(false);
    expect(await client.feedback.count()).toBe(5);
    const feedbackSummary = await getUserFeedbackSummary({
      callerUserId: constructionRegistration.user.id,
      generatedAt: "2026-09-10T02:02:30.000Z",
      highScoreLimit: 5,
      repository: feedbackRepository,
      userId: constructionRegistration.user.id,
    });
    expect(feedbackSummary).toMatchObject({
      actions: {
        ACTED: 1,
        ALREADY_KNOWN: 1,
        NOT_USEFUL: 1,
        SAVED: 1,
        USEFUL: 1,
      },
      attribution: { direct: 2, telegram: 3 },
      feedbackCoveragePercent: 100,
      positiveSentimentPercent: 50,
      totals: {
        actions: 5,
        deliveredRecommendations: 1,
        evaluatedDeliveredRecommendations: 1,
        recommendationsWithFeedback: 2,
      },
    });
    expect(feedbackSummary.highScoreNotUseful).toMatchObject([
      {
        attribution: "DIRECT",
        reason: "Потребность уже закрыта",
        recommendationId: firstOpportunity.recommendation.id,
      },
    ]);
    await expect(
      submitSignalFeedback({
        action: "NOT_USEFUL",
        callerUserId: constructionRegistration.user.id,
        feedbackId: feedbackId("73000000-0000-4000-8000-000000000003"),
        now: "2026-09-10T02:03:00.000Z",
        repository: feedbackRepository,
        signalId: secondOpportunity.signal.id,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
});
