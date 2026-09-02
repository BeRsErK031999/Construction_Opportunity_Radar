import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  correlationId,
  createNormalizedItem,
  deduplicateCandidatesV1,
  nearTextSimilarityV1,
  normalizedItemId,
  rawItemId,
  sourceId,
  type DeduplicationCandidate,
  type Vertical,
} from "../src/index.js";

interface CandidateOptions {
  readonly canonicalUrl?: string;
  readonly externalId?: string | null;
  readonly hash?: string;
  readonly id: string;
  readonly publishedAt?: string;
  readonly source?: string;
  readonly text: string;
  readonly vertical?: Vertical;
}

const candidate = (options: CandidateOptions): DeduplicationCandidate =>
  Object.freeze({
    normalizedItem: createNormalizedItem({
      canonicalUrl: options.canonicalUrl ?? `https://fixtures.radar.local/items/${options.id}`,
      correlationId: correlationId(`correlation-${options.id}`),
      createdAt: options.publishedAt ?? "2026-09-01T00:00:00Z",
      id: normalizedItemId(options.id),
      language: "ru",
      normalizedHash: options.hash ?? createHash("sha256").update(options.text).digest("hex"),
      normalizerVersion: "normalizer-v1",
      publishedAt: options.publishedAt ?? "2026-09-01T00:00:00Z",
      rawItemId: rawItemId(`raw-${options.id}`),
      text: options.text,
    }),
    sourceExternalId: options.externalId ?? options.id,
    sourceId: sourceId(options.source ?? `source-${options.id}`),
    verticals: Object.freeze([options.vertical ?? "CONSTRUCTION"]),
  });

const baseText =
  "В городе Барнаул запланированы строительно-монтажные работы. Бюджет 43 млн рублей, приём заявок до 2 октября.";
const nearBaseText =
  "В Новосибирске началась реконструкция складского комплекса. Подрядчиков приглашают подать документы до 15 октября.";

describe("deduplicator-v1", () => {
  it("records exact and bounded near matches while preserving representatives", () => {
    const candidates = [
      candidate({
        externalId: "notice-1",
        id: "source-original",
        publishedAt: "2026-09-01T00:00:00Z",
        source: "source-a",
        text: baseText,
      }),
      candidate({
        externalId: "notice-1",
        id: "source-copy",
        publishedAt: "2026-09-01T01:00:00Z",
        source: "source-a",
        text: `${baseText} Изменён транспортный заголовок.`,
      }),
      candidate({
        id: "url-original",
        publishedAt: "2026-09-01T02:00:00Z",
        text: "Открытие гостиницы в Белокурихе.",
      }),
      candidate({
        canonicalUrl: "https://fixtures.radar.local/items/url-original",
        id: "url-copy",
        publishedAt: "2026-09-01T03:00:00Z",
        text: "Другая выгрузка сообщения об открытии гостиницы.",
      }),
      candidate({
        id: "near-original",
        publishedAt: "2026-09-02T00:00:00Z",
        text: nearBaseText,
      }),
      candidate({
        id: "near-copy",
        publishedAt: "2026-09-04T00:00:00Z",
        text: `${nearBaseText} Обновление: срок ответа продлён на один рабочий день.`,
      }),
    ];

    const result = deduplicateCandidatesV1(candidates);
    const assignments = new Map(
      result.assignments.map((assignment) => [String(assignment.normalizedItemId), assignment]),
    );

    expect(assignments.get("source-copy")).toMatchObject({ matchKind: "SOURCE_IDENTITY" });
    expect(assignments.get("url-copy")).toMatchObject({ matchKind: "CANONICAL_URL" });
    expect(assignments.get("near-copy")).toMatchObject({
      matchKind: "NEAR_TEXT",
      representativeNormalizedItemId: "near-original",
      similarity: 1,
      timeDistanceHours: 48,
    });
    expect(result.metrics).toMatchObject({
      clusters: 3,
      duplicates: 3,
      exactDuplicates: 2,
      inputItems: 6,
      nearDuplicates: 1,
    });
  });

  it("does not near-match across verticals, outside the time window, or below threshold", () => {
    const candidates = [
      candidate({ id: "representative", text: baseText }),
      candidate({
        id: "other-vertical",
        text: `${baseText} Обновление для гостиничного рынка.`,
        vertical: "HORECA",
      }),
      candidate({
        id: "outside-window",
        publishedAt: "2026-09-09T00:00:01Z",
        text: `${baseText} Обновление после недельного окна.`,
      }),
      candidate({
        id: "similar-template",
        text: "В городе Бийск запланированы строительно-монтажные работы. Бюджет 99 млн рублей, приём заявок до 20 ноября.",
      }),
    ];

    const result = deduplicateCandidatesV1(candidates);

    expect(result.metrics).toMatchObject({ clusters: 4, duplicates: 0, nearDuplicates: 0 });
    expect(
      result.assignments.every((assignment) => assignment.matchKind === "REPRESENTATIVE"),
    ).toBe(true);
    expect(
      nearTextSimilarityV1(
        baseText,
        "В городе Бийск запланированы строительно-монтажные работы. Бюджет 99 млн рублей, приём заявок до 20 ноября.",
      ),
    ).toBeLessThan(0.95);
  });

  it("rejects duplicate normalized candidates before comparison", () => {
    const duplicate = candidate({ id: "duplicate-id", text: baseText });

    expect(() => deduplicateCandidatesV1([duplicate, duplicate])).toThrow(
      expect.objectContaining({ code: "DUPLICATE_DEDUP_CANDIDATE" }),
    );
  });
});
