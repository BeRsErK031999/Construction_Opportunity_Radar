import { readFile } from "node:fs/promises";

import { type SourceAdapter, type SourceFetchBatch } from "@radar/application";
import { FixtureIngestionDatasetV1Schema, type FixtureIngestionDatasetV1 } from "@radar/contracts";
import { createSource, sourceId, type Source } from "@radar/core";

const DEFAULT_PAGE_SIZE = 100;

export type FixtureSourceAdapterErrorCode =
  | "FIXTURE_CURSOR_INVALID"
  | "FIXTURE_PAGE_SIZE_INVALID"
  | "FIXTURE_SOURCE_CONFIGURATION_MISMATCH"
  | "FIXTURE_SOURCE_UNSUPPORTED";

export class FixtureSourceAdapterError extends Error {
  readonly code: FixtureSourceAdapterErrorCode;

  constructor(code: FixtureSourceAdapterErrorCode, message: string) {
    super(message);
    this.name = "FixtureSourceAdapterError";
    this.code = code;
  }
}

export interface FixtureSourceAdapterOptions {
  readonly now?: () => string;
  readonly pageSize?: number;
}

const parseCursor = (cursor: string | null, itemCount: number): number => {
  if (cursor === null) {
    return 0;
  }
  if (!/^\d+$/.test(cursor)) {
    throw new FixtureSourceAdapterError("FIXTURE_CURSOR_INVALID", "Fixture cursor must be numeric");
  }
  const offset = Number(cursor);
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > itemCount) {
    throw new FixtureSourceAdapterError(
      "FIXTURE_CURSOR_INVALID",
      "Fixture cursor is outside the source item range",
    );
  }
  return offset;
};

export const loadFixtureDataset = async (
  path: string | URL,
): Promise<FixtureIngestionDatasetV1> => {
  const content = await readFile(path, "utf8");
  return FixtureIngestionDatasetV1Schema.parse(JSON.parse(content) as unknown);
};

export const createFixtureSources = (dataset: FixtureIngestionDatasetV1): readonly Source[] =>
  Object.freeze(
    dataset.sources.map((source) =>
      createSource({
        aiProcessingAllowed: source.aiProcessingAllowed,
        collectionPolicy: { parserKind: "FIXTURE_JSON", pollIntervalMinutes: null },
        country: source.country,
        createdAt: dataset.createdAt,
        enabled: true,
        id: sourceId(source.id),
        name: source.name,
        regions: source.regions,
        reliabilityScore: source.reliabilityScore,
        rightsBasis: source.rightsBasis,
        rightsStatus: source.rightsStatus,
        type: "FIXTURE",
        updatedAt: dataset.createdAt,
        url: source.url,
        verticals: source.verticals,
      }),
    ),
  );

export class FixtureSourceAdapter implements SourceAdapter {
  readonly name = "fixture-json-v1";
  readonly #dataset: FixtureIngestionDatasetV1;
  readonly #now: () => string;
  readonly #pageSize: number;

  constructor(dataset: FixtureIngestionDatasetV1, options: FixtureSourceAdapterOptions = {}) {
    const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 1_000) {
      throw new FixtureSourceAdapterError(
        "FIXTURE_PAGE_SIZE_INVALID",
        "Fixture page size must be an integer between 1 and 1000",
      );
    }
    this.#dataset = dataset;
    this.#now = options.now ?? (() => new Date().toISOString());
    this.#pageSize = pageSize;
  }

  supports(source: Source): boolean {
    return (
      source.type === "FIXTURE" &&
      source.collectionPolicy.parserKind === "FIXTURE_JSON" &&
      this.#dataset.sources.some((candidate) => candidate.id === source.id)
    );
  }

  fetch({ cursor, source }: Parameters<SourceAdapter["fetch"]>[0]): Promise<SourceFetchBatch> {
    return Promise.resolve().then(() => this.#fetch(cursor, source));
  }

  #fetch(cursor: string | null, source: Source): SourceFetchBatch {
    if (!this.supports(source)) {
      throw new FixtureSourceAdapterError(
        "FIXTURE_SOURCE_UNSUPPORTED",
        `Source ${source.id} is not present in fixture dataset ${this.#dataset.datasetId}`,
      );
    }

    const sourceDefinition = this.#dataset.sources.find((candidate) => candidate.id === source.id);
    if (sourceDefinition?.url !== source.url) {
      throw new FixtureSourceAdapterError(
        "FIXTURE_SOURCE_CONFIGURATION_MISMATCH",
        `Source ${source.id} does not match its fixture registry definition`,
      );
    }

    const sourceItems = this.#dataset.items.filter((item) => item.sourceId === source.id);
    const offset = parseCursor(cursor, sourceItems.length);
    const end = Math.min(offset + this.#pageSize, sourceItems.length);
    const candidates = sourceItems.slice(offset, end).map((item) =>
      Object.freeze({
        externalId: item.externalId,
        originalUrl: item.originalUrl,
        publishedAt: item.publishedAt,
        rawPayload: item.rawPayload,
        rawText: item.rawText,
      }),
    );

    return Object.freeze({
      adapter: this.name,
      candidates: Object.freeze(candidates),
      fetchedAt: this.#now(),
      nextCursor: end < sourceItems.length ? String(end) : null,
      sourceId: source.id,
      version: this.#dataset.schemaVersion,
    });
  }
}
