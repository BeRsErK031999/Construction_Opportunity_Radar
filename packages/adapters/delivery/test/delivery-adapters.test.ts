import { describe, expect, it } from "vitest";

import { type DigestView, type SignalOpportunity } from "@radar/application";
import {
  correlationId,
  createDigest,
  deliveryId,
  digestId,
  normalizedItemId,
  recommendationId,
  sourceId,
  userId,
  userProfileId,
} from "@radar/core";

import {
  FakeDeliveryAdapter,
  TELEGRAM_CALLBACK_DATA_LIMIT_BYTES,
  TELEGRAM_TEXT_LIMIT,
  TelegramDeliveryAdapter,
  feedbackCallbackData,
  renderTelegramDigest,
  renderTelegramOpportunity,
  type TelegramMessageClient,
} from "../src/index.js";

const card = () => ({
  actions: [
    {
      kind: "VERIFY" as const,
      priority: 1,
      rationale: "Уточнить сроки закупки",
      title: "Проверить документацию",
    },
    {
      kind: "PREPARE_OFFER" as const,
      priority: 2,
      rationale: "Выйти к заказчику до публикации закупки",
      title: "Подготовить предложение",
    },
  ],
  deliveryId: deliveryId("10000000-0000-4000-8000-000000000001"),
  headline: "Новый объект <важный>",
  score: 84.4,
  sources: [
    {
      canonicalUrl: "https://example.test/item?a=1&b=2",
      normalizedItemId: normalizedItemId("20000000-0000-4000-8000-000000000001"),
      publishedAt: null,
      sourceId: sourceId("30000000-0000-4000-8000-000000000001"),
      sourceName: "Официальный <реестр>",
      sourceUrl: "https://example.test",
    },
  ],
  summary: "В регионе объявлено строительство объекта.",
  vertical: "CONSTRUCTION" as const,
  whyImportant: "Проекту потребуются материалы и подрядчики.",
});

const digestView = (): DigestView => ({
  digest: createDigest({
    correlationId: correlationId("40000000-0000-4000-8000-000000000001"),
    createdAt: "2026-09-02T12:00:00.000Z",
    id: digestId("50000000-0000-4000-8000-000000000001"),
    items: [
      {
        rank: 1,
        recommendationId: recommendationId("60000000-0000-4000-8000-000000000001"),
      },
    ],
    kind: "WEEKLY",
    periodEnd: "2026-09-07T00:00:00.000Z",
    periodStart: "2026-08-31T00:00:00.000Z",
    userId: userId("70000000-0000-4000-8000-000000000001"),
    userProfileId: userProfileId("80000000-0000-4000-8000-000000000001"),
    userProfileRevision: 1,
    version: "digest-v1",
    weeklySummary: {
      categoryTrends: [
        { category: "PROJECT_START", currentCount: 3, delta: 2, previousCount: 1, rank: 1 },
      ],
      highPriority: 1,
      opportunities: 1,
      processed: 20,
      relevant: 8,
      unique: 12,
    },
  }),
  items: [
    {
      opportunity: {
        analysis: { headline: card().headline },
        recommendation: {
          recommendedActions: card().actions,
          totalScore: card().score,
        },
        signal: { category: "PROJECT_START" },
        sources: card().sources,
      } as unknown as SignalOpportunity,
      rank: 1,
    },
  ],
});

describe("delivery adapters", () => {
  it("captures semantic cards in the fake adapter without network access", async () => {
    const adapter = new FakeDeliveryAdapter();

    const result = await adapter.sendOpportunity({ card: card(), recipientExternalId: "123" });

    expect(result.providerMessageId).toBe("fake-message-1");
    expect(adapter.sent).toHaveLength(1);
  });

  it("renders a bounded escaped Telegram card with compact callbacks", () => {
    const baseCard = card();
    const firstAction = baseCard.actions[0];
    if (firstAction === undefined) {
      throw new Error("Card fixture must contain an action");
    }
    const text = renderTelegramOpportunity({
      ...baseCard,
      actions: [
        ...baseCard.actions,
        { ...firstAction, priority: 3, title: "Третье действие" },
        { ...firstAction, priority: 4, title: "Лишнее четвёртое действие" },
      ],
    });
    const actionCodes = ["a", "k", "n", "s", "u"] as const;
    const callbacks = actionCodes.map((action) => feedbackCallbackData(action, card().deliveryId));

    expect(text).toContain("Возможность: 84/100");
    expect(text).toContain("Новый объект &lt;важный&gt;");
    expect(text).toContain("Официальный &lt;реестр&gt;");
    expect(text).toContain("Третье действие");
    expect(text).not.toContain("Лишнее четвёртое действие");
    expect(text.length).toBeLessThanOrEqual(TELEGRAM_TEXT_LIMIT);
    expect(
      callbacks.every(
        (callback) => Buffer.byteLength(callback, "utf8") <= TELEGRAM_CALLBACK_DATA_LIMIT_BYTES,
      ),
    ).toBe(true);
  });

  it("maps the semantic card to one Telegram sendMessage call", async () => {
    const sent: unknown[] = [];
    const client: TelegramMessageClient = {
      sendMessage(chatId, text, options) {
        sent.push({ chatId, options, text });
        return Promise.resolve({ message_id: 42 });
      },
    };
    const adapter = new TelegramDeliveryAdapter(client);

    const result = await adapter.sendOpportunity({ card: card(), recipientExternalId: "123" });

    expect(result).toEqual({ providerMessageId: "42" });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ chatId: "123", options: { parse_mode: "HTML" } });
    expect(JSON.stringify(sent[0])).toContain("👍 Полезно");
    expect(JSON.stringify(sent[0])).toContain("✅ Взяли в работу");
    expect(JSON.stringify(sent[0])).toContain("🙈 Уже знали");
    expect(JSON.stringify(sent[0])).toContain("https://example.test/item?a=1&b=2");
  });

  it("renders and sends a bounded weekly digest with metrics and source provenance", async () => {
    const sent: unknown[] = [];
    const client: TelegramMessageClient = {
      sendMessage(chatId, text, options) {
        sent.push({ chatId, options, text });
        return Promise.resolve({ message_id: 43 });
      },
    };
    const adapter = new TelegramDeliveryAdapter(client);
    const view = digestView();

    const result = await adapter.sendDigest({ recipientExternalId: "123", view });
    const text = renderTelegramDigest(view);

    expect(result).toEqual({ providerMessageId: "43" });
    expect(text).toContain("Итоги недели");
    expect(text).toContain("Обработано: 20");
    expect(text).toContain("PROJECT START: +2");
    expect(text).toContain("Официальный &lt;реестр&gt;");
    expect(text).toContain("https://example.test/item?a=1&amp;b=2");
    expect(text.length).toBeLessThanOrEqual(TELEGRAM_TEXT_LIMIT);
    expect(sent).toHaveLength(1);
  });
});
