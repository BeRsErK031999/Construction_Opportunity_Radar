import { readFile } from "node:fs/promises";

import { ingestSource, type RawItemIngestResult, type RawItemRepository } from "@radar/application";
import {
  createSource,
  rawItemId,
  rawItemIdentityKeys,
  sourceId,
  type RawItem,
  type Source,
} from "@radar/core";
import { describe, expect, it } from "vitest";

import {
  HttpTransportError,
  parseRssFeedV1,
  RSS_HTTP_ADAPTER_VERSION_V1,
  RssHttpSourceAdapter,
  type HttpTransport,
  type HttpTransportRequest,
  type HttpTransportResponse,
} from "../src/index.js";

const rssFixture = new URL("../../../../fixtures/rss/v1/rss.xml", import.meta.url);
const atomFixture = new URL("../../../../fixtures/rss/v1/atom.xml", import.meta.url);

const source = (overrides: Partial<Parameters<typeof createSource>[0]> = {}): Source =>
  createSource({
    aiProcessingAllowed: true,
    collectionPolicy: { parserKind: "RSS", pollIntervalMinutes: 30 },
    country: "RU",
    createdAt: "2026-09-01T00:00:00Z",
    enabled: true,
    id: sourceId("approved-rss-source"),
    name: "Approved RSS source",
    regions: ["Алтайский край"],
    reliabilityScore: 85,
    rightsBasis: "Public RSS feed approved for processing",
    rightsStatus: "OPEN_DATA",
    type: "RSS",
    updatedAt: "2026-09-01T00:00:00Z",
    url: "https://approved-source.example/feed.xml",
    verticals: ["CONSTRUCTION"],
    ...overrides,
  });

type HttpOutcome = HttpTransportResponse | Error;

class QueueHttpTransport implements HttpTransport {
  readonly requests: HttpTransportRequest[] = [];
  readonly #outcomes: HttpOutcome[];

  constructor(outcomes: readonly HttpOutcome[]) {
    this.#outcomes = [...outcomes];
  }

  request(request: HttpTransportRequest): Promise<HttpTransportResponse> {
    this.requests.push(request);
    const outcome = this.#outcomes.shift();
    if (outcome === undefined) {
      return Promise.reject(new Error("No queued HTTP outcome"));
    }
    return outcome instanceof Error ? Promise.reject(outcome) : Promise.resolve(outcome);
  }
}

class MemoryRawItemRepository implements RawItemRepository {
  readonly items: RawItem[] = [];
  readonly #byIdentity = new Map<string, RawItem>();

  ingest(rawItem: RawItem): Promise<RawItemIngestResult> {
    for (const identity of rawItemIdentityKeys(rawItem)) {
      const existing = this.#byIdentity.get(identity);
      if (existing !== undefined) {
        return Promise.resolve({ created: false, item: existing, matchedBy: "EXTERNAL_ID" });
      }
    }
    this.items.push(rawItem);
    for (const identity of rawItemIdentityKeys(rawItem)) {
      this.#byIdentity.set(identity, rawItem);
    }
    return Promise.resolve({ created: true, item: rawItem, matchedBy: null });
  }
}

const response = (
  body: string,
  status = 200,
  headers: Readonly<Record<string, string>> = { "content-type": "application/rss+xml" },
): HttpTransportResponse => Object.freeze({ body, headers, status });

describe("parseRssFeedV1", () => {
  it("parses RSS 2.0 while preserving item provenance and raw source text", async () => {
    const xml = await readFile(rssFixture, "utf8");

    const parsed = parseRssFeedV1(xml, "https://approved-source.example/feed.xml");

    expect(parsed.format).toBe("RSS");
    expect(parsed.candidates).toHaveLength(2);
    expect(parsed.candidates[0]).toMatchObject({
      externalId: "construction-notice-42",
      originalUrl: "https://approved-source.example/notices/42?utm_source=rss",
      publishedAt: "2026-09-01T03:00:00.000Z",
      rawText: "<p>Объявлен отбор подрядчика на капитальный ремонт школы.</p>",
    });
    expect(parsed.candidates[0]?.rawPayload).toMatchObject({
      adapterVersion: RSS_HTTP_ADAPTER_VERSION_V1,
      feedFormat: "RSS",
      feedUrl: "https://approved-source.example/feed.xml",
      title: "Капитальный ремонт школы",
    });
    expect(parsed.candidates[1]).toMatchObject({
      externalId: "https://approved-source.example/notices/43",
      originalUrl: "https://approved-source.example/notices/43",
      publishedAt: null,
      rawText: "Требуется поставка строительных материалов до 20 октября.",
    });
  });

  it("parses Atom alternate links and canonicalizes timestamps", async () => {
    const xml = await readFile(atomFixture, "utf8");

    const parsed = parseRssFeedV1(xml, "https://approved-source.example/horeca/feed");

    expect(parsed).toMatchObject({
      candidates: [
        {
          externalId: "horeca-opening-7",
          originalUrl: "https://approved-source.example/horeca/7",
          publishedAt: "2026-08-31T21:00:00.000Z",
          rawText: "В Барнауле открывается ресторан на 80 посадочных мест.",
        },
      ],
      format: "ATOM",
    });
  });

  it("rejects malformed XML and items without attributable URLs", () => {
    expect(() =>
      parseRssFeedV1("<rss><channel><item></rss>", "https://approved-source.example/feed"),
    ).toThrow(expect.objectContaining({ code: "RSS_FEED_INVALID" }));
    expect(() =>
      parseRssFeedV1(
        "<rss><channel><item><description>Evidence</description></item></channel></rss>",
        "https://approved-source.example/feed",
      ),
    ).toThrow(expect.objectContaining({ code: "RSS_ITEM_INVALID" }));
  });
});

describe("RssHttpSourceAdapter", () => {
  it("ingests the same RSS feed idempotently without changing raw evidence", async () => {
    const xml = await readFile(rssFixture, "utf8");
    const http = new QueueHttpTransport([response(xml), response(xml)]);
    const adapter = new RssHttpSourceAdapter({ http, minimumRequestIntervalMs: 0 });
    const rawItems = new MemoryRawItemRepository();
    let identity = 0;
    const identities = {
      createCorrelationId: () => `rss-correlation-${String(++identity)}`,
      createRawItemId: () => rawItemId(`rss-raw-${String(++identity)}`),
    };

    const first = await ingestSource({ adapter, identities, rawItems, source: source() });
    const second = await ingestSource({ adapter, identities, rawItems, source: source() });

    expect(first).toMatchObject({ candidates: 2, created: 2, existing: 0, fetches: 1 });
    expect(second).toMatchObject({ candidates: 2, created: 0, existing: 2, fetches: 1 });
    expect(first.aiProcessingPermittedRawItemIds).toHaveLength(2);
    expect(second.aiProcessingPermittedRawItemIds).toEqual([]);
    expect(rawItems.items).toHaveLength(2);
    expect(rawItems.items[0]?.rawText).toBe(
      "<p>Объявлен отбор подрядчика на капитальный ремонт школы.</p>",
    );
  });

  it("sends bounded identifying HTTP metadata and returns a versioned source batch", async () => {
    const xml = await readFile(rssFixture, "utf8");
    const http = new QueueHttpTransport([response(xml)]);
    const adapter = new RssHttpSourceAdapter({
      http,
      minimumRequestIntervalMs: 0,
      now: () => new Date("2026-09-02T00:00:00Z"),
      timeoutMs: 2_500,
      userAgent: "RadarCollector/1.0 (+https://radar.example/contact)",
    });

    const batch = await adapter.fetch({ cursor: null, source: source() });

    expect(batch).toMatchObject({
      adapter: "rss-http-v1",
      fetchedAt: "2026-09-02T00:00:00.000Z",
      nextCursor: null,
      sourceId: source().id,
      version: RSS_HTTP_ADAPTER_VERSION_V1,
    });
    expect(batch.candidates).toHaveLength(2);
    expect(http.requests).toEqual([
      {
        headers: {
          Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9",
          "User-Agent": "RadarCollector/1.0 (+https://radar.example/contact)",
        },
        timeoutMs: 2_500,
        url: source().url,
      },
    ]);
    expect(adapter.metrics()).toEqual({
      candidates: 2,
      failedFetches: 0,
      rateLimitWaitMs: 0,
      requestAttempts: 1,
      retries: 0,
      successfulFetches: 1,
    });
  });

  it("retries retryable status with backoff and per-origin rate limiting", async () => {
    const xml = await readFile(rssFixture, "utf8");
    const http = new QueueHttpTransport([
      response("temporarily unavailable", 503, {
        "content-type": "text/plain",
        "retry-after": "0",
      }),
      response(xml),
    ]);
    let now = Date.parse("2026-09-02T00:00:00Z");
    const delays: number[] = [];
    const adapter = new RssHttpSourceAdapter({
      http,
      maxAttempts: 2,
      maxRetryDelayMs: 1_000,
      minimumRequestIntervalMs: 1_000,
      now: () => new Date(now),
      retryBaseDelayMs: 100,
      sleep: (milliseconds) => {
        delays.push(milliseconds);
        now += milliseconds;
        return Promise.resolve();
      },
    });

    const batch = await adapter.fetch({ cursor: null, source: source() });

    expect(batch.candidates).toHaveLength(2);
    expect(delays).toEqual([100, 900]);
    expect(adapter.metrics()).toMatchObject({
      failedFetches: 0,
      rateLimitWaitMs: 900,
      requestAttempts: 2,
      retries: 1,
      successfulFetches: 1,
    });
  });

  it("exhausts timeout retries and exposes a safe terminal error", async () => {
    const http = new QueueHttpTransport([
      new HttpTransportError("HTTP_TIMEOUT", "sensitive upstream detail"),
      new HttpTransportError("HTTP_TIMEOUT", "sensitive upstream detail"),
    ]);
    const adapter = new RssHttpSourceAdapter({
      http,
      maxAttempts: 2,
      maxRetryDelayMs: 0,
      minimumRequestIntervalMs: 0,
      retryBaseDelayMs: 0,
      sleep: () => Promise.resolve(),
    });

    await expect(adapter.fetch({ cursor: null, source: source() })).rejects.toMatchObject({
      attempts: 2,
      code: "RSS_REQUEST_FAILED",
      message: "RSS request timed out after 2 attempts",
      retryable: true,
      statusCode: null,
    });
    expect(adapter.metrics()).toMatchObject({ failedFetches: 1, requestAttempts: 2, retries: 1 });
  });

  it("does not retry non-retryable status or unsupported content", async () => {
    const missing = new QueueHttpTransport([response("not found", 404)]);
    const missingAdapter = new RssHttpSourceAdapter({
      http: missing,
      minimumRequestIntervalMs: 0,
    });
    await expect(missingAdapter.fetch({ cursor: null, source: source() })).rejects.toMatchObject({
      attempts: 1,
      code: "RSS_HTTP_STATUS",
      retryable: false,
      statusCode: 404,
    });
    expect(missing.requests).toHaveLength(1);

    const html = new QueueHttpTransport([
      response("<html>sensitive response body</html>", 200, { "content-type": "text/html" }),
    ]);
    const htmlAdapter = new RssHttpSourceAdapter({ http: html, minimumRequestIntervalMs: 0 });
    await expect(htmlAdapter.fetch({ cursor: null, source: source() })).rejects.toEqual(
      expect.objectContaining({ code: "RSS_CONTENT_TYPE_UNSUPPORTED" }),
    );

    const oversized = new QueueHttpTransport([
      new HttpTransportError("HTTP_RESPONSE_TOO_LARGE", "private body metadata"),
    ]);
    const oversizedAdapter = new RssHttpSourceAdapter({
      http: oversized,
      maxAttempts: 3,
      minimumRequestIntervalMs: 0,
    });
    await expect(oversizedAdapter.fetch({ cursor: null, source: source() })).rejects.toMatchObject({
      attempts: 1,
      code: "RSS_REQUEST_FAILED",
      message: "RSS response exceeds the configured size limit",
      retryable: false,
    });
    expect(oversized.requests).toHaveLength(1);
  });

  it("refuses a live review-required source before any HTTP request", async () => {
    const http = new QueueHttpTransport([]);
    const adapter = new RssHttpSourceAdapter({ http });
    const reviewSource = source({
      aiProcessingAllowed: false,
      rightsBasis: null,
      rightsStatus: "REVIEW_REQUIRED",
    });

    await expect(adapter.fetch({ cursor: null, source: reviewSource })).rejects.toMatchObject({
      code: "RSS_SOURCE_NOT_PERMITTED",
    });
    expect(http.requests).toEqual([]);
  });
});
