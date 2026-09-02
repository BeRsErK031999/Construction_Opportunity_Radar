import { describe, expect, it } from "vitest";

import {
  FeedbackCreateRequestV1Schema,
  SignalListQueryV1Schema,
  SourceCreateRequestV1Schema,
  SourceListQueryV1Schema,
  UserProfilePatchRequestV1Schema,
} from "../src/index.js";

const validSourceRequest = () => ({
  aiProcessingAllowed: true,
  collectionPolicy: { parserKind: "RSS", pollIntervalMinutes: 30 },
  country: "RU",
  enabled: true,
  name: "Открытый реестр разрешений",
  ownerContact: null,
  regions: ["Алтайский край"],
  reliabilityScore: 90,
  rightsBasis: "Открытая лицензия проверена владельцем источника",
  rightsStatus: "OPEN_DATA",
  signalQualityNotes: null,
  type: "RSS",
  url: "https://example.test/feed.xml",
  verticals: ["CONSTRUCTION"],
});

describe("HTTP API contract v1", () => {
  it("rejects unknown source fields instead of silently accepting them", () => {
    expect(() =>
      SourceCreateRequestV1Schema.parse({ ...validSourceRequest(), secret: "unexpected" }),
    ).toThrow();
  });

  it("coerces bounded list filters and rejects an unbounded limit", () => {
    expect(SourceListQueryV1Schema.parse({ enabled: "true", limit: "100" })).toMatchObject({
      enabled: true,
      limit: 100,
    });
    expect(() => SourceListQueryV1Schema.parse({ limit: "101" })).toThrow();
  });

  it("rejects an inverted signal date range", () => {
    expect(() =>
      SignalListQueryV1Schema.parse({
        dateFrom: "2026-09-02T00:00:00.000Z",
        dateTo: "2026-09-01T00:00:00.000Z",
      }),
    ).toThrow();
  });

  it("requires a non-empty profile patch", () => {
    expect(() => UserProfilePatchRequestV1Schema.parse({})).toThrow();
    expect(UserProfilePatchRequestV1Schema.parse({ keywords: ["генподряд"] })).toEqual({
      keywords: ["генподряд"],
    });
  });

  it("accepts only versioned feedback actions and bounded reasons", () => {
    expect(FeedbackCreateRequestV1Schema.parse({ action: "USEFUL" })).toEqual({
      action: "USEFUL",
    });
    expect(() => FeedbackCreateRequestV1Schema.parse({ action: "LIKE" })).toThrow();
  });
});
