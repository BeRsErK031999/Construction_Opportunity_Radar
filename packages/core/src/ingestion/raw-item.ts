import { type CorrelationId, type RawItemId, type SourceId } from "../shared/identifiers.js";
import {
  freezeJson,
  httpUrl,
  isoDateTime,
  nonBlankText,
  optionalString,
  sha256,
  type HttpUrl,
  type IsoDateTime,
  type JsonValue,
  type ReadonlyJsonValue,
  type Sha256,
} from "../shared/primitives.js";

export interface RawItem {
  readonly contentHash: Sha256;
  readonly correlationId: CorrelationId;
  readonly externalId: string | null;
  readonly id: RawItemId;
  readonly originalUrl: HttpUrl;
  readonly publishedAt: IsoDateTime | null;
  readonly rawPayload: ReadonlyJsonValue | null;
  readonly rawText: string;
  readonly receivedAt: IsoDateTime;
  readonly sourceId: SourceId;
}

export interface CreateRawItemInput {
  readonly contentHash: string;
  readonly correlationId: CorrelationId;
  readonly externalId?: string | null;
  readonly id: RawItemId;
  readonly originalUrl: string;
  readonly publishedAt?: string | null;
  readonly rawPayload?: JsonValue | null;
  readonly rawText: string;
  readonly receivedAt: string;
  readonly sourceId: SourceId;
}

export const createRawItem = (input: CreateRawItemInput): RawItem =>
  Object.freeze({
    contentHash: sha256(input.contentHash, "contentHash"),
    correlationId: input.correlationId,
    externalId: optionalString(input.externalId, "externalId", 500),
    id: input.id,
    originalUrl: httpUrl(input.originalUrl, "originalUrl"),
    publishedAt:
      input.publishedAt === null || input.publishedAt === undefined
        ? null
        : isoDateTime(input.publishedAt, "publishedAt"),
    rawPayload:
      input.rawPayload === null || input.rawPayload === undefined
        ? null
        : freezeJson(input.rawPayload),
    rawText: nonBlankText(input.rawText, "rawText"),
    receivedAt: isoDateTime(input.receivedAt, "receivedAt"),
    sourceId: input.sourceId,
  });

export const rawItemIdentityKey = (rawItem: RawItem): string =>
  rawItem.externalId === null
    ? JSON.stringify([rawItem.sourceId, "contentHash", rawItem.contentHash])
    : JSON.stringify([rawItem.sourceId, "externalId", rawItem.externalId]);

export const rawItemIdentityKeys = (rawItem: RawItem): readonly string[] =>
  Object.freeze([
    ...(rawItem.externalId === null
      ? []
      : [JSON.stringify([rawItem.sourceId, "externalId", rawItem.externalId])]),
    JSON.stringify([rawItem.sourceId, "contentHash", rawItem.contentHash]),
  ]);
