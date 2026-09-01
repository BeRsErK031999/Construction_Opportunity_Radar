import { createHash } from "node:crypto";

import {
  correlationId,
  createRawItem,
  createSource,
  rawItemId,
  sourceId,
  type RawItem,
  type Source,
} from "@radar/core";

import { type DatabaseClient } from "./client.js";
import { PrismaRawItemRepository } from "./repositories/raw-item-repository.js";
import { PrismaSourceRepository } from "./repositories/source-repository.js";

const SEED_TIMESTAMP = "2026-09-01T00:00:00.000Z";

const uuid = (prefix: string, value: number): string =>
  `${prefix}0000000-0000-4000-8000-${value.toString().padStart(12, "0")}`;

const contentHash = (text: string): string => createHash("sha256").update(text).digest("hex");

export interface DevelopmentSeedData {
  readonly rawItems: readonly RawItem[];
  readonly sources: readonly Source[];
}

export interface DevelopmentSeedSummary {
  readonly createdRawItems: number;
  readonly rawItems: number;
  readonly signals: number;
  readonly sources: number;
}

export const createDevelopmentSeedData = (): DevelopmentSeedData => {
  const sources = Array.from({ length: 10 }, (_, sourceOffset) => {
    const sourceNumber = sourceOffset + 1;
    const sourceLabel = sourceNumber.toString();
    const construction = sourceNumber <= 5;
    return createSource({
      aiProcessingAllowed: true,
      collectionPolicy: { parserKind: "FIXTURE_JSON", pollIntervalMinutes: null },
      country: "RU",
      createdAt: SEED_TIMESTAMP,
      enabled: true,
      id: sourceId(uuid("0", sourceNumber)),
      name: `Fixture ${construction ? "Construction" : "HoReCa"} ${sourceLabel}`,
      regions: [construction ? "Алтайский край" : "Новосибирская область"],
      reliabilityScore: 80 + sourceNumber,
      rightsBasis: "Versioned development fixture created for local testing",
      rightsStatus: "OPEN_DATA",
      type: "FIXTURE",
      updatedAt: SEED_TIMESTAMP,
      url: `https://fixtures.radar.local/sources/${sourceLabel}`,
      verticals: [construction ? "CONSTRUCTION" : "HORECA"],
    });
  });

  const rawItems = sources.flatMap((source, sourceOffset) =>
    Array.from({ length: 10 }, (_, itemOffset) => {
      const sourceNumber = sourceOffset + 1;
      const itemNumber = itemOffset + 1;
      const globalNumber = sourceOffset * 10 + itemNumber;
      const sourceLabel = sourceNumber.toString();
      const itemLabel = itemNumber.toString();
      const globalLabel = globalNumber.toString();
      const rawText = `Fixture material ${globalLabel} for source ${sourceLabel}`;
      return createRawItem({
        contentHash: contentHash(rawText),
        correlationId: correlationId(uuid("2", globalNumber)),
        externalId: `fixture-${sourceLabel}-${itemLabel}`,
        id: rawItemId(uuid("1", globalNumber)),
        originalUrl: `https://fixtures.radar.local/sources/${sourceLabel}/items/${itemLabel}`,
        publishedAt: new Date(Date.parse(SEED_TIMESTAMP) + globalNumber * 60_000).toISOString(),
        rawPayload: { fixture: true, itemNumber, sourceNumber },
        rawText,
        receivedAt: new Date(
          Date.parse(SEED_TIMESTAMP) + globalNumber * 60_000 + 1_000,
        ).toISOString(),
        sourceId: source.id,
      });
    }),
  );

  return Object.freeze({ rawItems: Object.freeze(rawItems), sources: Object.freeze(sources) });
};

export const seedDevelopmentDatabase = async (
  client: DatabaseClient,
): Promise<DevelopmentSeedSummary> => {
  const sourceRepository = new PrismaSourceRepository(client);
  const rawItemRepository = new PrismaRawItemRepository(client);
  const seed = createDevelopmentSeedData();

  for (const source of seed.sources) {
    await sourceRepository.save(source);
  }

  let createdRawItems = 0;
  for (const rawItem of seed.rawItems) {
    const result = await rawItemRepository.ingest(rawItem);
    if (result.created) {
      createdRawItems += 1;
    }
  }

  const [sources, rawItems, signals] = await Promise.all([
    sourceRepository.count(),
    rawItemRepository.count(),
    client.signal.count(),
  ]);

  return Object.freeze({ createdRawItems, rawItems, signals, sources });
};
