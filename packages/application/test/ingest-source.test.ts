import {
  type RawItemIngestResult,
  type RawItemRepository,
  type SourceAdapter,
  type OperationalEvent,
} from "@radar/application";
import {
  createSource,
  rawItemId,
  rawItemIdentityKeys,
  sourceId,
  type RawItem,
  type Source,
} from "@radar/core";
import { describe, expect, it } from "vitest";

import { ingestSource, type SourceIngestionError } from "../src/index.js";

class MemoryRawItemRepository implements RawItemRepository {
  readonly items: RawItem[] = [];
  readonly #byIdentity = new Map<string, RawItem>();

  ingest(rawItem: RawItem): Promise<RawItemIngestResult> {
    for (const identity of rawItemIdentityKeys(rawItem)) {
      const existing = this.#byIdentity.get(identity);
      if (existing !== undefined) {
        return Promise.resolve(
          Object.freeze({ created: false, item: existing, matchedBy: "EXTERNAL_ID" }),
        );
      }
    }
    this.items.push(rawItem);
    for (const identity of rawItemIdentityKeys(rawItem)) {
      this.#byIdentity.set(identity, rawItem);
    }
    return Promise.resolve(Object.freeze({ created: true, item: rawItem, matchedBy: null }));
  }
}

const source = (overrides: Partial<Parameters<typeof createSource>[0]> = {}): Source =>
  createSource({
    aiProcessingAllowed: true,
    collectionPolicy: { parserKind: "FIXTURE_JSON", pollIntervalMinutes: null },
    country: "RU",
    createdAt: "2026-09-01T00:00:00Z",
    enabled: true,
    id: sourceId("fixture-source-1"),
    name: "Fixture source",
    regions: ["Алтайский край"],
    reliabilityScore: 90,
    rightsBasis: "Versioned project fixture",
    rightsStatus: "OPEN_DATA",
    type: "FIXTURE",
    updatedAt: "2026-09-01T00:00:00Z",
    url: "https://fixtures.radar.local/source-1",
    verticals: ["CONSTRUCTION"],
    ...overrides,
  });

const adapter = (): SourceAdapter & { readonly calls: { count: number } } => {
  const calls = { count: 0 };
  return {
    calls,
    fetch: ({ source: selectedSource }) => {
      calls.count += 1;
      return Promise.resolve({
        adapter: "test-fixture",
        candidates: [
          {
            externalId: "notice-1",
            originalUrl: "https://fixtures.radar.local/items/1",
            publishedAt: "2026-09-01T00:01:00Z",
            rawPayload: { preserved: true },
            rawText: "  Raw fixture evidence  ",
          },
          {
            externalId: null,
            originalUrl: "https://fixtures.radar.local/items/2",
            publishedAt: null,
            rawPayload: null,
            rawText: "Second fixture evidence",
          },
        ],
        fetchedAt: "2026-09-01T00:02:00Z",
        nextCursor: null,
        sourceId: selectedSource.id,
        version: "fixture-ingestion/v1",
      });
    },
    name: "test-fixture",
    supports: () => true,
  };
};

const identities = () => {
  let value = 0;
  return {
    createCorrelationId: () => `correlation-${String(++value)}`,
    createRawItemId: () => rawItemId(`raw-${String(++value)}`),
  };
};

describe("ingestSource", () => {
  it("preserves raw evidence and is idempotent through repository identities", async () => {
    const rawItems = new MemoryRawItemRepository();
    const selectedAdapter = adapter();
    const identityFactory = identities();
    const events: OperationalEvent[] = [];
    const observer = { observe: (event: OperationalEvent) => events.push(event) };

    const first = await ingestSource({
      adapter: selectedAdapter,
      identities: identityFactory,
      observer,
      rawItems,
      source: source(),
    });
    const second = await ingestSource({
      adapter: selectedAdapter,
      identities: identityFactory,
      observer,
      rawItems,
      source: source(),
    });

    expect(first).toMatchObject({ candidates: 2, created: 2, existing: 0, fetches: 1 });
    expect(first.aiProcessingPermittedRawItemIds).toHaveLength(2);
    expect(second).toMatchObject({ candidates: 2, created: 0, existing: 2, fetches: 1 });
    expect(second.aiProcessingPermittedRawItemIds).toHaveLength(0);
    expect(rawItems.items).toHaveLength(2);
    expect(rawItems.items[0]).toMatchObject({
      rawPayload: { preserved: true },
      rawText: "  Raw fixture evidence  ",
      receivedAt: "2026-09-01T00:02:00.000Z",
    });
    expect(events.map(({ name }) => name)).toEqual([
      "raw_item_ingested",
      "raw_item_ingested",
      "source_ingestion_completed",
      "raw_item_ingested",
      "raw_item_ingested",
      "source_ingestion_completed",
    ]);
    expect(events[0]).toMatchObject({
      aiProcessingAllowed: true,
      correlationId: rawItems.items[0]?.correlationId,
      outcome: "CREATED",
      rawItemId: rawItems.items[0]?.id,
      sourceId: "fixture-source-1",
    });
  });

  it("stores review-required evidence without granting AI permission", async () => {
    const rawItems = new MemoryRawItemRepository();
    const reviewSource = source({
      aiProcessingAllowed: false,
      rightsBasis: null,
      rightsStatus: "REVIEW_REQUIRED",
    });

    const result = await ingestSource({
      adapter: adapter(),
      identities: identities(),
      rawItems,
      source: reviewSource,
    });

    expect(result.created).toBe(2);
    expect(result.aiProcessingPermittedRawItemIds).toEqual([]);
  });

  it("keeps the ingestion outcome when an observer fails", async () => {
    const result = await ingestSource({
      adapter: adapter(),
      identities: identities(),
      observer: {
        observe() {
          throw new Error("telemetry unavailable");
        },
      },
      rawItems: new MemoryRawItemRepository(),
      source: source(),
    });

    expect(result).toMatchObject({ candidates: 2, created: 2, existing: 0 });
  });

  it.each([
    source({ aiProcessingAllowed: false, rightsBasis: null, rightsStatus: "BLOCKED" }),
    source({ enabled: false }),
    source({
      aiProcessingAllowed: false,
      collectionPolicy: { parserKind: "RSS", pollIntervalMinutes: 30 },
      rightsBasis: null,
      rightsStatus: "REVIEW_REQUIRED",
      type: "RSS",
    }),
  ])("refuses collection before calling the adapter for source $id", async (selectedSource) => {
    const selectedAdapter = adapter();

    await expect(
      ingestSource({
        adapter: selectedAdapter,
        identities: identities(),
        rawItems: new MemoryRawItemRepository(),
        source: selectedSource,
      }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<SourceIngestionError>>({
        code: "SOURCE_COLLECTION_NOT_PERMITTED",
      }),
    );
    expect(selectedAdapter.calls.count).toBe(0);
  });

  it("rejects an unsupported adapter before fetching", async () => {
    const selectedAdapter = adapter();
    selectedAdapter.supports = () => false;

    await expect(
      ingestSource({
        adapter: selectedAdapter,
        identities: identities(),
        rawItems: new MemoryRawItemRepository(),
        source: source(),
      }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<SourceIngestionError>>({
        code: "SOURCE_ADAPTER_UNSUPPORTED",
      }),
    );
    expect(selectedAdapter.calls.count).toBe(0);
  });
});
