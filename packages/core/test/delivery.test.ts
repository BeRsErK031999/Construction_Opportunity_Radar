import { describe, expect, it } from "vitest";

import {
  correlationId,
  createPendingDelivery,
  deliveryId,
  deliveryIdentityKey,
  markDeliveryFailed,
  markDeliverySent,
  recommendationId,
  userId,
} from "../src/index.js";

const pendingDelivery = () =>
  createPendingDelivery({
    channel: "TELEGRAM",
    correlationId: correlationId("10000000-0000-4000-8000-000000000001"),
    createdAt: "2026-09-02T00:00:00.000Z",
    id: deliveryId("20000000-0000-4000-8000-000000000001"),
    idempotencyKey: "telegram-update-42:recommendation-1",
    kind: "OPPORTUNITY",
    recommendationId: recommendationId("30000000-0000-4000-8000-000000000001"),
    userId: userId("40000000-0000-4000-8000-000000000001"),
  });

describe("Delivery", () => {
  it("moves a pending Telegram delivery to a traceable sent outcome", () => {
    const sent = markDeliverySent(
      pendingDelivery(),
      "telegram-message-101",
      "2026-09-02T00:00:01.000Z",
    );

    expect(sent).toMatchObject({ providerMessageId: "telegram-message-101", status: "SENT" });
    expect(deliveryIdentityKey(sent)).toBe(
      JSON.stringify(["TELEGRAM", "telegram-update-42:recommendation-1"]),
    );
  });

  it("stores a safe terminal failure without a provider message id", () => {
    const failed = markDeliveryFailed(
      pendingDelivery(),
      "TELEGRAM_SEND_FAILED",
      "Telegram delivery failed",
      "2026-09-02T00:00:01.000Z",
    );

    expect(failed).toMatchObject({
      failureCode: "TELEGRAM_SEND_FAILED",
      failureReason: "Telegram delivery failed",
      providerMessageId: null,
      status: "FAILED",
    });
  });
});
