import { describe, expect, it } from "vitest";

import {
  type DomainInvariantError,
  correlationId,
  createNormalizedItem,
  createRawItem,
  createSource,
  isAiProcessingPermitted,
  normalizedItemId,
  normalizedItemIdentityKey,
  rawItemId,
  rawItemIdentityKey,
  rawItemIdentityKeys,
  sourceId,
} from "../src/index.js";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

const validSourceInput = () => ({
  aiProcessingAllowed: true,
  collectionPolicy: { parserKind: "RSS" as const, pollIntervalMinutes: 30 },
  country: "RU",
  createdAt: "2026-09-01T01:00:00+07:00",
  enabled: true,
  id: sourceId("source-1"),
  name: "Открытый реестр",
  regions: ["Алтайский край"],
  reliabilityScore: 85,
  rightsBasis: "Условия открытой лицензии, проверены 2026-09-01",
  rightsStatus: "OPEN_DATA" as const,
  type: "RSS" as const,
  updatedAt: "2026-09-01T02:00:00+07:00",
  url: "https://example.test/feed",
  verticals: ["CONSTRUCTION" as const],
});

describe("Source", () => {
  it("allows AI processing only for enabled sources with an approved documented basis", () => {
    const source = createSource(validSourceInput());

    expect(source.createdAt).toBe("2026-08-31T18:00:00.000Z");
    expect(isAiProcessingPermitted(source)).toBe(true);
    expect(Object.isFrozen(source)).toBe(true);
  });

  it("rejects AI processing when rights still require review", () => {
    expect(() =>
      createSource({
        ...validSourceInput(),
        rightsStatus: "REVIEW_REQUIRED",
      }),
    ).toThrow(
      expect.objectContaining<Partial<DomainInvariantError>>({
        code: "AI_PROCESSING_RIGHTS_REQUIRED",
      }),
    );
  });

  it("requires partner or consent rights for a Telegram source", () => {
    expect(() =>
      createSource({
        ...validSourceInput(),
        aiProcessingAllowed: false,
        rightsBasis: null,
        rightsStatus: "OPEN_DATA",
        type: "PARTNER_TELEGRAM",
      }),
    ).toThrow(
      expect.objectContaining<Partial<DomainInvariantError>>({
        code: "TELEGRAM_PERMISSION_REQUIRED",
      }),
    );
  });
});

describe("RawItem and NormalizedItem", () => {
  const provenance = {
    correlationId: correlationId("correlation-1"),
    rawId: rawItemId("raw-1"),
    sourceId: sourceId("source-1"),
  };

  it("preserves immutable raw evidence and prefers external identity", () => {
    const rawPayload = { nested: { count: 1 }, tags: ["permit"] };
    const rawItem = createRawItem({
      contentHash: HASH_A,
      correlationId: provenance.correlationId,
      externalId: "notice-42",
      id: provenance.rawId,
      originalUrl: "https://example.test/notices/42",
      rawPayload,
      rawText: "  Исходный текст без нормализации  ",
      receivedAt: "2026-09-01T00:00:00Z",
      sourceId: provenance.sourceId,
    });

    expect(rawItem.rawText).toBe("  Исходный текст без нормализации  ");
    expect(Object.isFrozen(rawItem.rawPayload)).toBe(true);
    expect(Object.isFrozen((rawItem.rawPayload as { nested: object }).nested)).toBe(true);
    expect(rawItemIdentityKey(rawItem)).toContain("externalId");
    expect(rawItemIdentityKeys(rawItem)).toEqual([
      JSON.stringify([provenance.sourceId, "externalId", "notice-42"]),
      JSON.stringify([provenance.sourceId, "contentHash", HASH_A]),
    ]);
  });

  it("falls back to content hash identity and versions normalized derivatives", () => {
    const rawItem = createRawItem({
      contentHash: HASH_A,
      correlationId: provenance.correlationId,
      id: provenance.rawId,
      originalUrl: "https://example.test/notices/42",
      rawText: "Исходный текст",
      receivedAt: "2026-09-01T00:00:00Z",
      sourceId: provenance.sourceId,
    });
    const normalizedItem = createNormalizedItem({
      canonicalUrl: "https://example.test/notices/42",
      correlationId: provenance.correlationId,
      createdAt: "2026-09-01T00:01:00Z",
      id: normalizedItemId("normalized-1"),
      language: "ru-RU",
      normalizedHash: HASH_B,
      normalizerVersion: "normalizer-v1",
      rawItemId: provenance.rawId,
      text: "Исходный текст",
    });

    expect(rawItemIdentityKey(rawItem)).toContain("contentHash");
    expect(normalizedItem.language).toBe("ru-RU");
    expect(normalizedItemIdentityKey(normalizedItem)).toBe(
      JSON.stringify([provenance.rawId, "normalizer-v1"]),
    );
  });

  it("rejects duplicate normalized entities", () => {
    expect(() =>
      createNormalizedItem({
        canonicalUrl: "https://example.test/notices/42",
        correlationId: provenance.correlationId,
        createdAt: "2026-09-01T00:01:00Z",
        entities: [
          { kind: "company", value: "СтройИнвест" },
          { kind: "COMPANY", value: "стройинвест" },
        ],
        id: normalizedItemId("normalized-1"),
        language: "ru",
        normalizedHash: HASH_B,
        normalizerVersion: "normalizer-v1",
        rawItemId: provenance.rawId,
        text: "Исходный текст",
      }),
    ).toThrow(expect.objectContaining<Partial<DomainInvariantError>>({ code: "DUPLICATE_ENTITY" }));
  });
});
