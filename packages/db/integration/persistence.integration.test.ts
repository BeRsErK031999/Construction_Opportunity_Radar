import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import {
  executeClassification,
  executeDeduplication,
  executeNormalization,
  ingestSource,
  type Classifier,
  type Deduplicator,
  type RawItemNormalizer,
} from "@radar/application";
import {
  CLASSIFIER_VERSION_V1,
  classifyCandidateV1,
  correlationId,
  createRawItem,
  createSource,
  DEDUPLICATOR_VERSION_V1,
  deduplicateCandidatesV1,
  isAiProcessingPermitted,
  NORMALIZER_VERSION_V1,
  normalizeRawItemV1,
  normalizedItemId,
  rawItemId,
  SIGNAL_TAXONOMY_VERSION_V1,
  sourceId,
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
  PrismaClassificationRepository,
  PrismaDeduplicationRepository,
  PrismaRawItemRepository,
  PrismaNormalizationOutcomeRepository,
  PrismaSourceRepository,
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
});
