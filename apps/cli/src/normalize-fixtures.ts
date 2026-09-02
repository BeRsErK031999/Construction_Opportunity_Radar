import { randomUUID } from "node:crypto";

import { executeNormalization, type RawItemNormalizer } from "@radar/application";
import { NORMALIZER_VERSION_V1, normalizeRawItemV1, normalizedItemId } from "@radar/core";
import {
  createDatabaseClient,
  PrismaNormalizationOutcomeRepository,
  PrismaRawItemRepository,
} from "@radar/db";

import { databaseUrl } from "./database-url.js";

const normalizer: RawItemNormalizer = Object.freeze({
  normalize: normalizeRawItemV1,
  version: NORMALIZER_VERSION_V1,
});

const main = async (): Promise<void> => {
  const client = createDatabaseClient(databaseUrl());
  const rawItems = new PrismaRawItemRepository(client);
  const outcomes = new PrismaNormalizationOutcomeRepository(client);

  await client.$connect();
  try {
    const rawItemBatch = await rawItems.list({ limit: 10_000 });
    const results = [];
    for (const rawItem of rawItemBatch) {
      results.push(
        await executeNormalization({
          createdAt: new Date().toISOString(),
          id: normalizedItemId(randomUUID()),
          normalizer,
          rawItem,
          repository: outcomes,
        }),
      );
    }

    const summary = {
      attempts: await outcomes.count(),
      created: results.filter((result) => result.created).length,
      existing: results.filter((result) => !result.created).length,
      normalizedItems: await outcomes.countNormalizedItems(),
      normalizerVersion: normalizer.version,
      rawItems: await rawItems.count(),
      rejected: results.filter((result) => result.outcome.status === "REJECTED").length,
      signals: await client.signal.count(),
      succeeded: results.filter((result) => result.outcome.status === "SUCCEEDED").length,
    };
    process.stdout.write(`${JSON.stringify(summary)}\n`);
  } finally {
    await client.$disconnect();
  }
};

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown normalization failure";
  process.stderr.write(`Fixture normalization failed: ${message}\n`);
  process.exitCode = 1;
});
