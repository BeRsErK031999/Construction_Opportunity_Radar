import { describe, expect, it } from "vitest";

import {
  correlationId,
  createDigest,
  createPendingDigestDelivery,
  digestDeliveryId,
  digestId,
  digestIdentityKey,
  markDigestDeliveryFailed,
  markDigestDeliverySent,
  recommendationId,
  userId,
  userProfileId,
} from "../src/index.js";

const dailyDigest = () =>
  createDigest({
    correlationId: correlationId("10000000-0000-4000-8000-000000000001"),
    createdAt: "2026-09-02T12:00:00.000Z",
    id: digestId("20000000-0000-4000-8000-000000000001"),
    items: [
      {
        rank: 1,
        recommendationId: recommendationId("30000000-0000-4000-8000-000000000001"),
      },
    ],
    kind: "DAILY",
    periodEnd: "2026-09-03T00:00:00.000Z",
    periodStart: "2026-09-02T00:00:00.000Z",
    userId: userId("40000000-0000-4000-8000-000000000001"),
    userProfileId: userProfileId("50000000-0000-4000-8000-000000000001"),
    userProfileRevision: 1,
    version: "digest-v1",
  });

describe("Digest", () => {
  it("keeps a versioned daily top list with a stable period identity", () => {
    const digest = dailyDigest();

    expect(digest.items).toHaveLength(1);
    expect(digest.weeklySummary).toBeNull();
    expect(digestIdentityKey(digest)).toBe(
      JSON.stringify([
        digest.userId,
        "DAILY",
        "2026-09-02T00:00:00.000Z",
        "2026-09-03T00:00:00.000Z",
        "digest-v1",
      ]),
    );
  });

  it("validates the weekly funnel and positive category growth", () => {
    const digest = createDigest({
      ...dailyDigest(),
      id: digestId("20000000-0000-4000-8000-000000000002"),
      kind: "WEEKLY",
      periodEnd: "2026-09-07T00:00:00.000Z",
      periodStart: "2026-08-31T00:00:00.000Z",
      weeklySummary: {
        categoryTrends: [
          {
            category: "CONSTRUCTION_PROJECT",
            currentCount: 4,
            delta: 3,
            previousCount: 1,
            rank: 1,
          },
        ],
        highPriority: 2,
        opportunities: 4,
        processed: 20,
        relevant: 8,
        unique: 12,
      },
    });

    expect(digest.weeklySummary).toMatchObject({
      categoryTrends: [{ category: "CONSTRUCTION_PROJECT", delta: 3 }],
      highPriority: 2,
      opportunities: 4,
    });
  });

  it("rejects duplicate recommendations and invalid summary placement", () => {
    const firstItem = dailyDigest().items[0];
    if (firstItem === undefined) {
      throw new Error("Digest fixture item is required");
    }
    expect(() =>
      createDigest({
        ...dailyDigest(),
        items: [firstItem, { ...firstItem, rank: 2 }],
      }),
    ).toThrow("Digest recommendations must be unique");
    expect(() =>
      createDigest({
        ...dailyDigest(),
        weeklySummary: {
          categoryTrends: [],
          highPriority: 0,
          opportunities: 0,
          processed: 0,
          relevant: 0,
          unique: 0,
        },
      }),
    ).toThrow("Only weekly digests must contain a weekly summary");
  });

  it("records one terminal digest-delivery outcome", () => {
    const pending = createPendingDigestDelivery({
      channel: "TELEGRAM",
      correlationId: dailyDigest().correlationId,
      createdAt: "2026-09-02T12:00:00.000Z",
      digestId: dailyDigest().id,
      id: digestDeliveryId("60000000-0000-4000-8000-000000000001"),
      idempotencyKey: `digest:${dailyDigest().id}`,
      userId: dailyDigest().userId,
    });

    expect(markDigestDeliverySent(pending, "message-42", "2026-09-02T12:00:01.000Z")).toMatchObject(
      {
        providerMessageId: "message-42",
        status: "SENT",
      },
    );
    expect(
      markDigestDeliveryFailed(
        pending,
        "TELEGRAM_SEND_FAILED",
        "Safe failure",
        "2026-09-02T12:00:01.000Z",
      ),
    ).toMatchObject({ failureCode: "TELEGRAM_SEND_FAILED", status: "FAILED" });
  });
});
