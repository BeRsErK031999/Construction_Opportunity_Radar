import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { correlationId, createRawItem, createSource, rawItemId, sourceId } from "@radar/core";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  createDatabaseClient,
  PrismaRawItemRepository,
  PrismaSourceRepository,
  RawItemIdentityConflictError,
  seedDevelopmentDatabase,
  type DatabaseClient,
} from "../src/index.js";

const execFileAsync = promisify(execFile);
const dbPackageDirectory = fileURLToPath(new URL("..", import.meta.url));
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
});
