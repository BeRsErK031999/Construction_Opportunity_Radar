import { randomUUID } from "node:crypto";

import { ingestSource, type IngestionIdentityFactory } from "@radar/application";
import { rawItemId } from "@radar/core";
import { createDatabaseClient, PrismaRawItemRepository, PrismaSourceRepository } from "@radar/db";
import {
  createFixtureSources,
  FixtureSourceAdapter,
  loadFixtureDataset,
} from "@radar/source-adapters";

import { databaseUrl } from "./database-url.js";

const fixturePath = new URL("../../../fixtures/ingestion/v1/dataset.json", import.meta.url);

const identities: IngestionIdentityFactory = {
  createCorrelationId: () => randomUUID(),
  createRawItemId: () => rawItemId(randomUUID()),
};

const main = async (): Promise<void> => {
  const dataset = await loadFixtureDataset(fixturePath);
  const sources = createFixtureSources(dataset);
  const adapter = new FixtureSourceAdapter(dataset);
  const client = createDatabaseClient(databaseUrl());
  const sourceRepository = new PrismaSourceRepository(client);
  const rawItemRepository = new PrismaRawItemRepository(client);

  await client.$connect();
  try {
    for (const source of sources) {
      await sourceRepository.save(source);
    }

    const results = [];
    for (const source of sources) {
      results.push(
        await ingestSource({
          adapter,
          identities,
          rawItems: rawItemRepository,
          source,
        }),
      );
    }

    const summary = {
      aiPermissionPassedCreated: results.reduce(
        (total, result) => total + result.aiProcessingPermittedRawItemIds.length,
        0,
      ),
      created: results.reduce((total, result) => total + result.created, 0),
      datasetId: dataset.datasetId,
      existing: results.reduce((total, result) => total + result.existing, 0),
      rawItems: await rawItemRepository.count(),
      signals: await client.signal.count(),
      sources: await sourceRepository.count(),
    };
    process.stdout.write(`${JSON.stringify(summary)}\n`);
  } finally {
    await client.$disconnect();
  }
};

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown fixture ingestion failure";
  process.stderr.write(`Fixture ingestion failed: ${message}\n`);
  process.exitCode = 1;
});
