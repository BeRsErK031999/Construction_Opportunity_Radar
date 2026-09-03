import { executeClassification, type Classifier } from "@radar/application";
import {
  CLASSIFIER_VERSION_V2,
  classifyCandidateV2,
  DEDUPLICATOR_VERSION_V1,
  SIGNAL_TAXONOMY_VERSION_V1,
} from "@radar/core";
import { createDatabaseClient, PrismaClassificationRepository } from "@radar/db";

import { databaseUrl } from "./database-url.js";

const classifier: Classifier = Object.freeze({
  classify: classifyCandidateV2,
  taxonomyVersion: SIGNAL_TAXONOMY_VERSION_V1,
  version: CLASSIFIER_VERSION_V2,
});

const main = async (): Promise<void> => {
  const client = createDatabaseClient(databaseUrl());
  const repository = new PrismaClassificationRepository(client);

  await client.$connect();
  try {
    const candidates = await repository.listCandidates({
      deduplicatorVersion: DEDUPLICATOR_VERSION_V1,
      limit: 10_000,
    });
    const result = await executeClassification({
      candidates,
      classifier,
      createdAt: new Date().toISOString(),
      repository,
    });
    const summary = {
      aiEligible: result.metrics.aiEligible,
      classifierVersion: classifier.version,
      construction: result.metrics.construction,
      created: result.persistence.created,
      deduplicatorVersion: DEDUPLICATOR_VERSION_V1,
      existing: result.persistence.existing,
      horeca: result.metrics.horeca,
      inputClusters: result.metrics.inputClusters,
      irrelevant: result.metrics.irrelevant,
      other: result.metrics.other,
      permissionDenied: result.metrics.permissionDenied,
      signals: await repository.countSignals(classifier.version),
      taxonomyVersion: classifier.taxonomyVersion,
    };
    process.stdout.write(`${JSON.stringify(summary)}\n`);
  } finally {
    await client.$disconnect();
  }
};

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown classification failure";
  process.stderr.write(`Fixture classification failed: ${message}\n`);
  process.exitCode = 1;
});
