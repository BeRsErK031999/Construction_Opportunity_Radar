import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  canonicalizeUrl,
  correlationId,
  createRawItem,
  detectLanguageV1,
  NORMALIZER_VERSION_V1,
  normalizeRawItemV1,
  normalizedItemId,
  rawItemId,
  sourceId,
} from "../src/index.js";

const rawItem = (rawText: string, originalUrl = "https://Example.test/notices/42") =>
  createRawItem({
    contentHash: createHash("sha256").update(rawText).digest("hex"),
    correlationId: correlationId("normalization-correlation-1"),
    externalId: "notice-42",
    id: rawItemId("normalization-raw-1"),
    originalUrl,
    publishedAt: "2026-09-02T07:15:00+07:00",
    rawPayload: { title: "  Капитальный&nbsp;ремонт  " },
    rawText,
    receivedAt: "2026-09-02T00:16:00Z",
    sourceId: sourceId("normalization-source-1"),
  });

describe("normalizer-v1", () => {
  it("cleans markup, boilerplate, whitespace and consecutive duplicate lines", () => {
    const raw = rawItem(`
      <html><head><title>Ремонт &amp; поставка</title><script>secret()</script></head>
      <body>
        <h1>Капитальный&nbsp;ремонт</h1>
        <p>Приём   заявок до 10 октября.</p>
        <p>Приём   заявок до 10 октября.</p>
        <div>Мы используем файлы cookie для работы сайта</div>
        <p>Бюджет &mdash; 25 млн рублей.</p>
      </body></html>
    `);
    const originalText = raw.rawText;

    const outcome = normalizeRawItemV1({
      createdAt: "2026-09-02T00:20:00Z",
      id: normalizedItemId("normalization-result-1"),
      rawItem: raw,
    });

    expect(outcome.status).toBe("SUCCEEDED");
    if (outcome.status !== "SUCCEEDED") {
      throw new Error("Expected successful normalization");
    }
    expect(outcome.item).toMatchObject({
      language: "ru",
      normalizerVersion: NORMALIZER_VERSION_V1,
      publishedAt: "2026-09-02T00:15:00.000Z",
      text: "Капитальный ремонт\n\nПриём заявок до 10 октября.\n\nБюджет — 25 млн рублей.",
      title: "Капитальный ремонт",
    });
    expect(outcome.item.normalizedHash).toBe(
      createHash("sha256").update(outcome.item.text).digest("hex"),
    );
    expect(raw.rawText).toBe(originalText);
  });

  it("canonicalizes tracking parameters, fragments, credentials and query order", () => {
    expect(
      canonicalizeUrl(
        "https://user:pass@Example.test:443//notices/42/?utm_source=news&b=2&a=3&a=1#details",
      ),
    ).toBe("https://example.test/notices/42?a=1&a=3&b=2");
  });

  it("uses a conservative deterministic language baseline", () => {
    expect(detectLanguageV1("Открытие ресторана в Барнауле")).toBe("ru");
    expect(detectLanguageV1("New hotel opening in Barnaul")).toBe("en");
    expect(detectLanguageV1("12345 — 67890")).toBe("und");
  });

  it("returns an explicit rejection when cleanup removes all meaningful text", () => {
    const raw = rawItem(
      "<html><head><title>Only title</title></head><body><script>ignored()</script></body></html>",
    );

    const outcome = normalizeRawItemV1({
      createdAt: "2026-09-02T00:20:00Z",
      id: normalizedItemId("normalization-result-2"),
      rawItem: raw,
    });

    expect(outcome).toMatchObject({
      normalizerVersion: NORMALIZER_VERSION_V1,
      rawItemId: raw.id,
      rejectionCode: "EMPTY_NORMALIZED_TEXT",
      status: "REJECTED",
    });
  });
});
