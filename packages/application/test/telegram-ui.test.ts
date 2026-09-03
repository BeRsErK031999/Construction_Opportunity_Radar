import { describe, expect, it } from "vitest";

import {
  analysisId,
  correlationId,
  createRecommendation,
  createSignal,
  createSuccessfulAnalysis,
  createUser,
  createUserProfile,
  deliveryId,
  factId,
  feedbackId,
  inferenceId,
  normalizedItemId,
  recommendationId,
  signalId,
  sourceId,
  userId,
  userProfileId,
  type Delivery,
  type Feedback,
} from "@radar/core";

import {
  DeliveryTransportError,
  deliverTelegramOpportunities,
  getTelegramUserProfile,
  submitTelegramDeliveryFeedback,
  type DeliveryPort,
  type OperationalEvent,
  type BotApplicationError,
  type TelegramUiRepositories,
} from "../src/index.js";

const USER_ID = userId("10000000-0000-4000-8000-000000000001");
const OTHER_USER_ID = userId("10000000-0000-4000-8000-000000000002");
const PROFILE_ID = userProfileId("20000000-0000-4000-8000-000000000001");
const SOURCE_ID = sourceId("30000000-0000-4000-8000-000000000001");
const NORMALIZED_ID = normalizedItemId("40000000-0000-4000-8000-000000000001");
const SIGNAL_ID = signalId("50000000-0000-4000-8000-000000000001");
const ANALYSIS_ID = analysisId("60000000-0000-4000-8000-000000000001");
const RECOMMENDATION_ID = recommendationId("70000000-0000-4000-8000-000000000001");
const DELIVERY_ID = deliveryId("80000000-0000-4000-8000-000000000001");
const FEEDBACK_ID = feedbackId("90000000-0000-4000-8000-000000000001");
const CORRELATION_ID = correlationId("a0000000-0000-4000-8000-000000000001");
const NOW = "2026-09-02T00:00:00.000Z";

const user = createUser({
  createdAt: NOW,
  id: USER_ID,
  revision: 1,
  status: "ACTIVE",
  telegramUserId: "123456789",
  updatedAt: NOW,
});

const profile = createUserProfile({
  companySize: "SMALL",
  companyType: "Поставщик строительных материалов",
  createdAt: NOW,
  id: PROFILE_ID,
  keywords: ["генподряд"],
  regions: ["Алтайский край"],
  revision: 1,
  servicesAndProducts: ["Бетон"],
  updatedAt: NOW,
  userId: USER_ID,
  verticals: ["CONSTRUCTION"],
});

const opportunity = () => {
  const signal = createSignal({
    category: "PROJECT_START",
    classifierVersion: "classifier-v1",
    classificationConfidence: 90,
    classificationRuleIds: ["construction.project"],
    correlationId: CORRELATION_ID,
    createdAt: NOW,
    deduplicationRepresentativeNormalizedItemId: NORMALIZED_ID,
    deduplicatorVersion: "deduplicator-v1",
    id: SIGNAL_ID,
    normalizedItemIds: [NORMALIZED_ID],
    relevanceScore: 90,
    sourceIds: [SOURCE_ID],
    status: "CANDIDATE",
    taxonomyVersion: "taxonomy-v1",
    updatedAt: NOW,
    vertical: "CONSTRUCTION",
  });
  const analysis = createSuccessfulAnalysis({
    actionability: 85,
    analysisVersion: "analysis-v1",
    businessImpact: 90,
    candidateActions: [
      {
        kind: "VERIFY",
        priority: 1,
        rationale: "Подтвердить сроки",
        title: "Проверить документацию",
      },
    ],
    confidence: 0.9,
    correlationId: CORRELATION_ID,
    createdAt: NOW,
    entities: [],
    eventType: "CONSTRUCTION_PROJECT",
    facts: [{ id: factId("fact-1"), sourceIds: [SOURCE_ID], statement: "Объект объявлен" }],
    headline: "Новый строительный объект",
    id: ANALYSIS_ID,
    inferences: [
      {
        basisFactIds: [factId("fact-1")],
        id: inferenceId("inference-1"),
        statement: "Потребуются подрядчики",
      },
    ],
    model: "fake-v1",
    promptVersion: "prompt-v1",
    provider: "fake",
    risks: ["Сроки закупки не подтверждены"],
    schemaVersion: "schema-v1",
    signalId: SIGNAL_ID,
    summary: "В регионе начинается новый проект.",
    urgency: 70,
    whyImportant: "Появляется потенциальный спрос на материалы.",
  });
  const recommendation = createRecommendation({
    analysisId: ANALYSIS_ID,
    band: "HIGH",
    correlationId: CORRELATION_ID,
    createdAt: NOW,
    explanation: "Высокое соответствие профилю.",
    id: RECOMMENDATION_ID,
    recommendedActions: [
      {
        kind: "VERIFY",
        priority: 1,
        rationale: "Подтвердить сроки",
        title: "Проверить документацию",
      },
      {
        kind: "PREPARE_OFFER",
        priority: 2,
        rationale: "Подготовиться заранее",
        title: "Подготовить предложение",
      },
    ],
    scoreBreakdown: {
      actionability: 85,
      businessImpact: 90,
      companyFit: 80,
      confidence: 90,
      urgency: 70,
    },
    scoringVersion: "score-v1",
    signalId: SIGNAL_ID,
    sourceIds: [SOURCE_ID],
    totalScore: 84,
    userProfileId: PROFILE_ID,
    userProfileRevision: 1,
  });
  return Object.freeze({
    analysis,
    recommendation,
    signal,
    sources: Object.freeze([
      {
        canonicalUrl: "https://example.test/projects/1",
        normalizedItemId: NORMALIZED_ID,
        publishedAt: NOW,
        sourceId: SOURCE_ID,
        sourceName: "Официальный реестр",
        sourceUrl: "https://example.test",
      },
    ]),
  });
};

const state = () => {
  const deliveries = new Map<string, Delivery>();
  const feedback = new Map<string, Feedback>();
  const repositories: TelegramUiRepositories = {
    digestDeliveries: {
      findByDigest() {
        return Promise.resolve(null);
      },
      findById() {
        return Promise.resolve(null);
      },
      save(delivery) {
        return Promise.resolve({ created: true, delivery });
      },
    },
    digests: {
      collectBuildSnapshot() {
        return Promise.resolve(null);
      },
      findByIdentity() {
        return Promise.resolve(null);
      },
      findView() {
        return Promise.resolve(null);
      },
      save(digest) {
        return Promise.resolve({ created: true, digest });
      },
    },
    deliveries: {
      findById(id) {
        return Promise.resolve(deliveries.get(id) ?? null);
      },
      findByIdempotencyKey(_channel, key) {
        return Promise.resolve(
          [...deliveries.values()].find((delivery) => delivery.idempotencyKey === key) ?? null,
        );
      },
      save(delivery) {
        deliveries.set(delivery.id, delivery);
        return Promise.resolve(delivery);
      },
    },
    feedback: {
      findRecommendationForUser() {
        return Promise.resolve(null);
      },
      save(candidate) {
        const existing = feedback.get(candidate.id);
        if (existing !== undefined) {
          return Promise.resolve({ created: false, feedback: existing });
        }
        feedback.set(candidate.id, candidate);
        return Promise.resolve({ created: true, feedback: candidate });
      },
    },
    profiles: {
      findLatest(id) {
        return Promise.resolve(id === USER_ID ? { profile, user } : null);
      },
      save() {
        return Promise.resolve(null);
      },
    },
    saved: {
      listSavedForUser(id) {
        return Promise.resolve(id === USER_ID ? [opportunity()] : []);
      },
    },
    signals: {
      findForUser() {
        return Promise.resolve(null);
      },
      listForUser(id) {
        return Promise.resolve({
          items: id === USER_ID ? [opportunity()] : [],
          nextCursor: null,
        });
      },
    },
    users: {
      findByTelegramUserId(telegramUserId) {
        if (telegramUserId === user.telegramUserId) {
          return Promise.resolve(user);
        }
        if (telegramUserId === "987654321") {
          return Promise.resolve(
            createUser({ ...user, id: OTHER_USER_ID, telegramUserId: "987654321" }),
          );
        }
        return Promise.resolve(null);
      },
    },
  };
  return { deliveries, feedback, repositories };
};

describe("Telegram UI application use cases", () => {
  it("delivers one opportunity exactly once for a replayed Telegram update", async () => {
    const testState = state();
    const sent: unknown[] = [];
    const events: OperationalEvent[] = [];
    const port: DeliveryPort = {
      sendOpportunity(input) {
        sent.push(input);
        return Promise.resolve({ providerMessageId: "42" });
      },
    };
    const input = {
      deliveryIdFactory: () => DELIVERY_ID,
      interactionId: "update-42",
      mode: "NEW" as const,
      now: () => NOW,
      observer: { observe: (event: OperationalEvent) => events.push(event) },
      port,
      repositories: testState.repositories,
      telegramUserId: user.telegramUserId,
    };

    const first = await deliverTelegramOpportunities(input);
    const replayed = await deliverTelegramOpportunities(input);

    expect(first.deliveries[0]).toMatchObject({ providerMessageId: "42", status: "SENT" });
    expect(replayed.deliveries[0]?.id).toBe(first.deliveries[0]?.id);
    expect(sent).toHaveLength(1);
    expect(testState.deliveries.size).toBe(1);
    expect(events).toEqual([
      expect.objectContaining({
        correlationId: CORRELATION_ID,
        kind: "OPPORTUNITY",
        name: "delivery_completed",
        outcome: "SENT",
        reused: false,
      }),
      expect.objectContaining({
        kind: "OPPORTUNITY",
        name: "delivery_completed",
        outcome: "SENT",
        reused: true,
      }),
    ]);
  });

  it("persists a safe failed outcome when the transport rejects a card", async () => {
    const testState = state();
    const events: OperationalEvent[] = [];
    const port: DeliveryPort = {
      sendOpportunity() {
        throw new DeliveryTransportError(
          "TELEGRAM_UNAVAILABLE",
          "Telegram временно недоступен",
          true,
        );
      },
    };

    const result = await deliverTelegramOpportunities({
      deliveryIdFactory: () => DELIVERY_ID,
      interactionId: "update-43",
      mode: "NEW",
      now: () => NOW,
      observer: { observe: (event: OperationalEvent) => events.push(event) },
      port,
      repositories: testState.repositories,
      telegramUserId: user.telegramUserId,
    });

    expect(result.deliveries[0]).toMatchObject({
      failureCode: "TELEGRAM_UNAVAILABLE",
      failureReason: "Telegram временно недоступен",
      status: "FAILED",
    });
    expect(events).toEqual([
      expect.objectContaining({
        failureCode: "TELEGRAM_UNAVAILABLE",
        name: "delivery_completed",
        outcome: "FAILED",
        reused: false,
      }),
    ]);
  });

  it("attaches idempotent callback feedback to the sent delivery", async () => {
    const testState = state();
    const sentDelivery = await deliverTelegramOpportunities({
      deliveryIdFactory: () => DELIVERY_ID,
      interactionId: "update-44",
      mode: "NEW",
      now: () => NOW,
      port: { sendOpportunity: () => Promise.resolve({ providerMessageId: "44" }) },
      repositories: testState.repositories,
      telegramUserId: user.telegramUserId,
    });
    expect(sentDelivery.deliveries[0]?.status).toBe("SENT");
    const input = {
      action: "SAVED" as const,
      deliveryId: DELIVERY_ID,
      feedbackId: FEEDBACK_ID,
      now: NOW,
      repositories: testState.repositories,
      telegramUserId: user.telegramUserId,
    };

    const first = await submitTelegramDeliveryFeedback(input);
    const replayed = await submitTelegramDeliveryFeedback(input);

    expect(first).toMatchObject({ created: true, feedback: { deliveryId: DELIVERY_ID } });
    expect(replayed.created).toBe(false);
    expect(testState.feedback.size).toBe(1);
  });

  it("does not expose another user's delivery", async () => {
    const testState = state();
    await deliverTelegramOpportunities({
      deliveryIdFactory: () => DELIVERY_ID,
      interactionId: "update-45",
      mode: "NEW",
      now: () => NOW,
      port: { sendOpportunity: () => Promise.resolve({ providerMessageId: "45" }) },
      repositories: testState.repositories,
      telegramUserId: user.telegramUserId,
    });

    await expect(
      submitTelegramDeliveryFeedback({
        action: "USEFUL",
        deliveryId: DELIVERY_ID,
        feedbackId: FEEDBACK_ID,
        now: NOW,
        repositories: testState.repositories,
        telegramUserId: "987654321",
      }),
    ).rejects.toMatchObject({ code: "DELIVERY_NOT_FOUND" } satisfies Partial<BotApplicationError>);
  });

  it("reads the registered user's latest profile and rejects unknown identities", async () => {
    const testState = state();

    await expect(
      getTelegramUserProfile({
        repositories: testState.repositories,
        telegramUserId: user.telegramUserId,
      }),
    ).resolves.toMatchObject({ id: PROFILE_ID, revision: 1 });
    await expect(
      getTelegramUserProfile({
        repositories: testState.repositories,
        telegramUserId: "missing",
      }),
    ).rejects.toMatchObject({ code: "USER_NOT_REGISTERED" } satisfies Partial<BotApplicationError>);
  });
});
