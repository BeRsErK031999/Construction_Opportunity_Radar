import { describe, expect, it } from "vitest";

import {
  buildDigest,
  deliverTelegramDigest,
  digestPeriodFor,
  type DigestBuildSnapshot,
  type DigestRepository,
  type DigestView,
  type SignalOpportunity,
} from "../src/index.js";
import {
  correlationId,
  createUser,
  digestDeliveryId,
  digestId,
  recommendationId,
  signalId,
  userId,
  userProfileId,
  type Digest,
  type DigestDelivery,
} from "@radar/core";

const USER_ID = userId("10000000-0000-4000-8000-000000000001");
const PROFILE_ID = userProfileId("20000000-0000-4000-8000-000000000001");

const candidate = (
  suffix: string,
  score: number,
  createdAt: string,
  category = "CONSTRUCTION_PROJECT",
) => ({
  band: score >= 85 ? ("CRITICAL" as const) : score >= 70 ? ("HIGH" as const) : ("MEDIUM" as const),
  category,
  createdAt,
  recommendationId: recommendationId(`30000000-0000-4000-8000-0000000000${suffix}`),
  signalId: signalId(`40000000-0000-4000-8000-0000000000${suffix}`),
  totalScore: score,
});

const snapshot = (): DigestBuildSnapshot => ({
  candidates: [
    candidate("03", 72, "2026-09-02T02:00:00.000Z"),
    candidate("01", 91, "2026-09-02T01:00:00.000Z", "TENDER"),
    candidate("02", 91, "2026-09-02T03:00:00.000Z", "TENDER"),
    candidate("04", 68, "2026-09-02T04:00:00.000Z"),
    candidate("05", 67, "2026-09-02T05:00:00.000Z"),
    candidate("06", 66, "2026-09-02T06:00:00.000Z"),
  ],
  previousCandidates: [candidate("07", 70, "2026-08-26T01:00:00.000Z", "TENDER")],
  processed: 20,
  relevant: 8,
  unique: 12,
  userProfileId: PROFILE_ID,
  userProfileRevision: 2,
});

const fakeRepository = (buildSnapshot: DigestBuildSnapshot | null = snapshot()) => {
  let stored: Digest | null = null;
  let saves = 0;
  const repository: DigestRepository = {
    collectBuildSnapshot() {
      return Promise.resolve(buildSnapshot);
    },
    findByIdentity() {
      return Promise.resolve(stored);
    },
    findView(id) {
      if (stored?.id !== id) {
        return Promise.resolve(null);
      }
      return Promise.resolve({
        digest: stored,
        items: stored.items.map((item) => ({
          opportunity: {} as SignalOpportunity,
          rank: item.rank,
        })),
      } satisfies DigestView);
    },
    save(digest) {
      saves += 1;
      stored = digest;
      return Promise.resolve({ created: true, digest });
    },
  };
  return { repository, saves: () => saves };
};

describe("digest application", () => {
  it("creates UTC daily and Monday-based weekly periods", () => {
    expect(digestPeriodFor("DAILY", "2026-09-02T18:45:00+07:00")).toEqual({
      end: "2026-09-03T00:00:00.000Z",
      previousStart: "2026-09-01T00:00:00.000Z",
      start: "2026-09-02T00:00:00.000Z",
    });
    expect(digestPeriodFor("WEEKLY", "2026-09-02T11:45:00.000Z")).toEqual({
      end: "2026-09-07T00:00:00.000Z",
      previousStart: "2026-08-24T00:00:00.000Z",
      start: "2026-08-31T00:00:00.000Z",
    });
  });

  it("builds a deterministic daily top five and reuses the persisted snapshot", async () => {
    const fake = fakeRepository();
    const input = {
      correlationId: correlationId("50000000-0000-4000-8000-000000000001"),
      digestId: digestId("60000000-0000-4000-8000-000000000001"),
      kind: "DAILY" as const,
      now: "2026-09-02T12:00:00.000Z",
      period: digestPeriodFor("DAILY", "2026-09-02T12:00:00.000Z"),
      repository: fake.repository,
      userId: USER_ID,
    };

    const first = await buildDigest(input);
    const replay = await buildDigest({
      ...input,
      digestId: digestId("60000000-0000-4000-8000-000000000002"),
    });

    expect(first.view.digest.items.map((item) => item.recommendationId)).toEqual([
      recommendationId("30000000-0000-4000-8000-000000000002"),
      recommendationId("30000000-0000-4000-8000-000000000001"),
      recommendationId("30000000-0000-4000-8000-000000000003"),
      recommendationId("30000000-0000-4000-8000-000000000004"),
      recommendationId("30000000-0000-4000-8000-000000000005"),
    ]);
    expect(first.created).toBe(true);
    expect(replay.created).toBe(false);
    expect(replay.view.digest.id).toBe(first.view.digest.id);
    expect(fake.saves()).toBe(1);
  });

  it("adds an explainable weekly funnel and category growth", async () => {
    const fake = fakeRepository();
    const result = await buildDigest({
      correlationId: correlationId("50000000-0000-4000-8000-000000000002"),
      digestId: digestId("60000000-0000-4000-8000-000000000003"),
      kind: "WEEKLY",
      now: "2026-09-02T12:00:00.000Z",
      period: digestPeriodFor("WEEKLY", "2026-09-02T12:00:00.000Z"),
      repository: fake.repository,
      userId: USER_ID,
    });

    expect(result.view.digest.weeklySummary).toMatchObject({
      categoryTrends: [
        { category: "CONSTRUCTION_PROJECT", currentCount: 4, delta: 4, previousCount: 0 },
        { category: "TENDER", currentCount: 2, delta: 1, previousCount: 1 },
      ],
      highPriority: 3,
      opportunities: 6,
      processed: 20,
      relevant: 8,
      unique: 12,
    });
  });

  it("does not freeze an empty in-progress daily period", async () => {
    const fake = fakeRepository({
      ...snapshot(),
      candidates: [],
      previousCandidates: [],
      processed: 0,
      relevant: 0,
      unique: 0,
    });

    const result = await buildDigest({
      correlationId: correlationId("50000000-0000-4000-8000-000000000004"),
      digestId: digestId("60000000-0000-4000-8000-000000000006"),
      kind: "DAILY",
      now: "2026-09-02T12:00:00.000Z",
      period: digestPeriodFor("DAILY", "2026-09-02T12:00:00.000Z"),
      repository: fake.repository,
      userId: USER_ID,
    });

    expect(result).toMatchObject({ created: false, view: { items: [] } });
    expect(fake.saves()).toBe(0);
  });

  it("persists one Telegram delivery for a replayed digest build", async () => {
    const fake = fakeRepository();
    let storedDelivery: DigestDelivery | null = null;
    let sends = 0;
    const repositories = {
      digestDeliveries: {
        findByDigest() {
          return Promise.resolve(storedDelivery);
        },
        findById() {
          return Promise.resolve(storedDelivery);
        },
        save(delivery: DigestDelivery) {
          const created = storedDelivery === null;
          storedDelivery = delivery;
          return Promise.resolve({ created, delivery });
        },
      },
      digests: fake.repository,
      users: {
        findByTelegramUserId(telegramUserId: string) {
          return Promise.resolve(
            telegramUserId === "123"
              ? createUser({
                  createdAt: "2026-09-02T00:00:00.000Z",
                  id: USER_ID,
                  revision: 1,
                  status: "ACTIVE",
                  telegramUserId,
                  updatedAt: "2026-09-02T00:00:00.000Z",
                })
              : null,
          );
        },
      },
    };
    const input = {
      correlationId: correlationId("50000000-0000-4000-8000-000000000003"),
      digestDeliveryId: digestDeliveryId("70000000-0000-4000-8000-000000000001"),
      digestId: digestId("60000000-0000-4000-8000-000000000004"),
      kind: "DAILY" as const,
      now: () => "2026-09-02T12:00:00.000Z",
      port: {
        sendDigest() {
          sends += 1;
          return Promise.resolve({ providerMessageId: "message-1" });
        },
      },
      repositories,
      telegramUserId: "123",
    };

    const first = await deliverTelegramDigest(input);
    const replay = await deliverTelegramDigest({
      ...input,
      digestDeliveryId: digestDeliveryId("70000000-0000-4000-8000-000000000002"),
      digestId: digestId("60000000-0000-4000-8000-000000000005"),
    });

    expect(first).toMatchObject({ deliveryCreated: true, delivery: { status: "SENT" } });
    expect(replay).toMatchObject({ deliveryCreated: false, delivery: { status: "SENT" } });
    expect(sends).toBe(1);
    expect(fake.saves()).toBe(1);
  });
});
