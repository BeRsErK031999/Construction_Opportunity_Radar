import { executeDeduplication, type Deduplicator } from "@radar/application";
import {
  DEDUPLICATOR_VERSION_V1,
  deduplicateCandidatesV1,
  NORMALIZER_VERSION_V1,
} from "@radar/core";
import { createDatabaseClient, PrismaDeduplicationRepository } from "@radar/db";

import { databaseUrl } from "./database-url.js";

const deduplicator: Deduplicator = Object.freeze({
  deduplicate: deduplicateCandidatesV1,
  version: DEDUPLICATOR_VERSION_V1,
});

const main = async (): Promise<void> => {
  const client = createDatabaseClient(databaseUrl());
  const repository = new PrismaDeduplicationRepository(client);

  await client.$connect();
  try {
    const candidates = await repository.listCandidates({
      limit: 10_000,
      normalizerVersion: NORMALIZER_VERSION_V1,
    });
    const result = await executeDeduplication({
      candidates,
      createdAt: new Date().toISOString(),
      deduplicator,
      repository,
    });
    const summary = {
      assignments: await repository.countAssignments(deduplicator.version),
      clusters: await repository.countClusters(deduplicator.version),
      created: result.persistence.created,
      deduplicatorVersion: deduplicator.version,
      duplicates: result.deduplication.metrics.duplicates,
      exactDuplicates: result.deduplication.metrics.exactDuplicates,
      existing: result.persistence.existing,
      inputItems: result.deduplication.metrics.inputItems,
      nearComparisons: result.deduplication.metrics.nearComparisons,
      nearDuplicates: result.deduplication.metrics.nearDuplicates,
    };
    process.stdout.write(`${JSON.stringify(summary)}\n`);
  } finally {
    await client.$disconnect();
  }
};

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown deduplication failure";
  process.stderr.write(`Fixture deduplication failed: ${message}\n`);
  process.exitCode = 1;
});
