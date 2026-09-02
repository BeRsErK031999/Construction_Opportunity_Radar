import {
  createNormalizedItem,
  type JsonValue,
  type NormalizedEntity,
  type NormalizedItem,
} from "@radar/core";

import { PersistenceError } from "../errors.js";
import {
  type NormalizedItem as NormalizedItemRecord,
  type Prisma,
} from "../generated/prisma/client.js";

const inputJson = (value: readonly NormalizedEntity[]): Prisma.InputJsonArray =>
  value.map((entity) => ({ kind: entity.kind, value: entity.value }));

const entitiesFromJson = (value: unknown): JsonValue => structuredClone(value) as JsonValue;

export const normalizedItemToCreateData = (
  item: NormalizedItem,
): Prisma.NormalizedItemCreateInput => ({
  canonicalUrl: item.canonicalUrl,
  correlationId: item.correlationId,
  createdAt: new Date(item.createdAt),
  entities: inputJson(item.entities),
  id: item.id,
  language: item.language,
  normalizedHash: item.normalizedHash,
  normalizerVersion: item.normalizerVersion,
  publishedAt: item.publishedAt === null ? null : new Date(item.publishedAt),
  rawItem: { connect: { id: item.rawItemId } },
  text: item.text,
  title: item.title,
});

export const normalizedItemFromRecord = (record: NormalizedItemRecord): NormalizedItem => {
  const entities = entitiesFromJson(record.entities);
  if (!Array.isArray(entities)) {
    throw new PersistenceError(
      "NORMALIZED_ITEM_MAPPING_FAILED",
      "Normalized item entities must be an array",
    );
  }

  return createNormalizedItem({
    canonicalUrl: record.canonicalUrl,
    correlationId: record.correlationId as NormalizedItem["correlationId"],
    createdAt: record.createdAt.toISOString(),
    entities: entities.map((entity) => {
      if (
        entity === null ||
        typeof entity !== "object" ||
        Array.isArray(entity) ||
        typeof entity.kind !== "string" ||
        typeof entity.value !== "string"
      ) {
        throw new PersistenceError(
          "NORMALIZED_ITEM_MAPPING_FAILED",
          "Normalized item entity has an invalid shape",
        );
      }
      return { kind: entity.kind, value: entity.value };
    }),
    id: record.id as NormalizedItem["id"],
    language: record.language,
    normalizedHash: record.normalizedHash,
    normalizerVersion: record.normalizerVersion,
    publishedAt: record.publishedAt?.toISOString() ?? null,
    rawItemId: record.rawItemId as NormalizedItem["rawItemId"],
    text: record.text,
    title: record.title,
  });
};
