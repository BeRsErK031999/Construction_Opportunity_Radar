import {
  type JsonValue,
  type RawItem,
  type RawItemId,
  type Source,
  type SourceId,
} from "@radar/core";

export interface RawItemCandidate {
  readonly externalId: string | null;
  readonly originalUrl: string;
  readonly publishedAt: string | null;
  readonly rawPayload: JsonValue | null;
  readonly rawText: string;
}

export interface SourceFetchRequest {
  readonly cursor: string | null;
  readonly source: Source;
}

export interface SourceFetchBatch {
  readonly adapter: string;
  readonly candidates: readonly RawItemCandidate[];
  readonly fetchedAt: string;
  readonly nextCursor: string | null;
  readonly sourceId: SourceId;
  readonly version: string;
}

export interface SourceAdapter {
  readonly name: string;
  fetch(request: SourceFetchRequest): Promise<SourceFetchBatch>;
  supports(source: Source): boolean;
}

export type RawItemMatch = "CONTENT_HASH" | "EXTERNAL_ID" | "ID";

export interface RawItemIngestResult {
  readonly created: boolean;
  readonly item: RawItem;
  readonly matchedBy: RawItemMatch | null;
}

export interface RawItemRepository {
  ingest(rawItem: RawItem): Promise<RawItemIngestResult>;
}

export interface IngestionIdentityFactory {
  createCorrelationId(source: Source, candidate: RawItemCandidate, index: number): string;
  createRawItemId(source: Source, candidate: RawItemCandidate, index: number): RawItemId;
}
