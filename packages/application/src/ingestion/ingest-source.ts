import { createHash } from "node:crypto";

import {
  correlationId,
  createRawItem,
  isAiProcessingPermitted,
  isSourceCollectionPermitted,
  type RawItemId,
  type Source,
} from "@radar/core";

import { SourceIngestionError } from "./errors.js";
import {
  observeOperationalEvent,
  type OperationalObserver,
} from "../ports/operational-observer.js";
import {
  type IngestionIdentityFactory,
  type RawItemRepository,
  type SourceAdapter,
} from "../ports/source-adapter.js";

export interface IngestSourceInput {
  readonly adapter: SourceAdapter;
  readonly identities: IngestionIdentityFactory;
  readonly observer?: OperationalObserver;
  readonly rawItems: RawItemRepository;
  readonly source: Source;
}

export interface IngestSourceSummary {
  readonly aiProcessingPermittedRawItemIds: readonly RawItemId[];
  readonly candidates: number;
  readonly created: number;
  readonly existing: number;
  readonly fetches: number;
  readonly sourceId: Source["id"];
}

const hashRawText = (rawText: string): string =>
  createHash("sha256").update(rawText, "utf8").digest("hex");

const runIngestion = async (input: IngestSourceInput): Promise<IngestSourceSummary> => {
  const { adapter, identities, rawItems, source } = input;

  if (!isSourceCollectionPermitted(source)) {
    throw new SourceIngestionError(
      "SOURCE_COLLECTION_NOT_PERMITTED",
      `Collection is not permitted for source ${source.id}`,
    );
  }
  if (!adapter.supports(source)) {
    throw new SourceIngestionError(
      "SOURCE_ADAPTER_UNSUPPORTED",
      `Adapter ${adapter.name} does not support source ${source.id}`,
    );
  }

  const seenCursors = new Set<string>();
  const aiProcessingPermittedRawItemIds: RawItemId[] = [];
  let candidates = 0;
  let created = 0;
  let existing = 0;
  let fetches = 0;
  let cursor: string | null = null;

  do {
    const batch = await adapter.fetch({ cursor, source });
    fetches += 1;

    if (batch.sourceId !== source.id || batch.adapter !== adapter.name) {
      throw new SourceIngestionError(
        "SOURCE_ADAPTER_MISMATCH",
        `Adapter ${adapter.name} returned a batch for a different source or adapter`,
      );
    }

    const batchStartIndex = candidates;
    for (const [index, candidate] of batch.candidates.entries()) {
      const candidateIndex = batchStartIndex + index;
      const result = await rawItems.ingest(
        createRawItem({
          contentHash: hashRawText(candidate.rawText),
          correlationId: correlationId(
            identities.createCorrelationId(source, candidate, candidateIndex),
          ),
          externalId: candidate.externalId,
          id: identities.createRawItemId(source, candidate, candidateIndex),
          originalUrl: candidate.originalUrl,
          publishedAt: candidate.publishedAt,
          rawPayload: candidate.rawPayload,
          rawText: candidate.rawText,
          receivedAt: batch.fetchedAt,
          sourceId: source.id,
        }),
      );

      observeOperationalEvent(input.observer, {
        aiProcessingAllowed: isAiProcessingPermitted(source),
        correlationId: result.item.correlationId,
        name: "raw_item_ingested",
        outcome: result.created ? "CREATED" : "EXISTING",
        rawItemId: result.item.id,
        sourceId: source.id,
      });

      candidates += 1;
      if (result.created) {
        created += 1;
        if (isAiProcessingPermitted(source)) {
          aiProcessingPermittedRawItemIds.push(result.item.id);
        }
      } else {
        existing += 1;
      }
    }

    cursor = batch.nextCursor;
    if (cursor !== null) {
      if (seenCursors.has(cursor)) {
        throw new SourceIngestionError(
          "SOURCE_ADAPTER_CURSOR_LOOP",
          `Adapter ${adapter.name} repeated cursor ${cursor}`,
        );
      }
      seenCursors.add(cursor);
    }
  } while (cursor !== null);

  const summary = Object.freeze({
    aiProcessingPermittedRawItemIds: Object.freeze(aiProcessingPermittedRawItemIds),
    candidates,
    created,
    existing,
    fetches,
    sourceId: source.id,
  });
  observeOperationalEvent(input.observer, {
    adapter: adapter.name,
    candidates,
    created,
    existing,
    fetches,
    name: "source_ingestion_completed",
    sourceId: source.id,
  });
  return summary;
};

export const ingestSource = async (input: IngestSourceInput): Promise<IngestSourceSummary> => {
  try {
    return await runIngestion(input);
  } catch (error) {
    observeOperationalEvent(input.observer, {
      adapter: input.adapter.name,
      errorCode:
        error instanceof SourceIngestionError ? error.code : "SOURCE_INGESTION_INTERNAL_ERROR",
      name: "source_ingestion_failed",
      sourceId: input.source.id,
    });
    throw error;
  }
};
