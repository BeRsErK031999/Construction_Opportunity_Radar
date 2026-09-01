import { createRawItem, type JsonValue, type RawItem } from "@radar/core";

import { type Prisma, type RawItem as RawItemRecord } from "../generated/prisma/client.js";

const mutableJson = (value: unknown): JsonValue => structuredClone(value) as JsonValue;
const inputJson = (value: Exclude<RawItem["rawPayload"], null>): Prisma.InputJsonValue =>
  structuredClone(value);

export const rawItemToCreateData = (rawItem: RawItem): Prisma.RawItemCreateInput => ({
  contentHash: rawItem.contentHash,
  correlationId: rawItem.correlationId,
  externalId: rawItem.externalId,
  id: rawItem.id,
  originalUrl: rawItem.originalUrl,
  publishedAt: rawItem.publishedAt === null ? null : new Date(rawItem.publishedAt),
  ...(rawItem.rawPayload === null ? {} : { rawPayload: inputJson(rawItem.rawPayload) }),
  rawText: rawItem.rawText,
  receivedAt: new Date(rawItem.receivedAt),
  source: { connect: { id: rawItem.sourceId } },
});

export const rawItemFromRecord = (record: RawItemRecord): RawItem =>
  createRawItem({
    contentHash: record.contentHash,
    correlationId: record.correlationId as RawItem["correlationId"],
    externalId: record.externalId,
    id: record.id as RawItem["id"],
    originalUrl: record.originalUrl,
    publishedAt: record.publishedAt?.toISOString() ?? null,
    rawPayload: record.rawPayload === null ? null : mutableJson(record.rawPayload),
    rawText: record.rawText,
    receivedAt: record.receivedAt.toISOString(),
    sourceId: record.sourceId as RawItem["sourceId"],
  });
