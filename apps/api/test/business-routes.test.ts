import { afterEach, describe, expect, it } from "vitest";

import {
  FeedbackWriteConflictError,
  type FeedbackRepository,
  type SignalListFilter,
  type SignalOpportunityRepository,
  type SourceListFilter,
  type SourceRegistryRepository,
  type UserProfileRepository,
} from "@radar/application";
import {
  correlationId,
  createUser,
  createUserProfile,
  recommendationId,
  userId,
  userProfileId,
  type Feedback,
  type Source,
} from "@radar/core";
import { createLogger } from "@radar/observability";

import { buildApi, type ApiRepositories } from "../src/app.js";

const AUTH_TOKEN = "a".repeat(32);
const USER_ID = "10000000-0000-4000-8000-000000000001";
const OTHER_USER_ID = "10000000-0000-4000-8000-000000000002";
const PROFILE_ID = "20000000-0000-4000-8000-000000000001";
const SIGNAL_ID = "30000000-0000-4000-8000-000000000001";
const RECOMMENDATION_ID = "40000000-0000-4000-8000-000000000001";
const FEEDBACK_ID = "50000000-0000-4000-8000-000000000001";
const SOURCE_ID = "60000000-0000-4000-8000-000000000001";
const NOW = "2026-09-02T00:00:00.000Z";

const apps: ReturnType<typeof buildApi>[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map(async (app) => app.close()));
});

const authorizedHeaders = (caller = USER_ID) => ({
  authorization: `Bearer ${AUTH_TOKEN}`,
  "x-radar-user-id": caller,
});

const sourceRequest = () => ({
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

const repositories = () => {
  const sources = new Map<string, Source>();
  const feedbackById = new Map<string, Feedback>();
  let latestSignalFilter: SignalListFilter | null = null;
  const user = createUser({
    createdAt: NOW,
    id: userId(USER_ID),
    revision: 1,
    status: "ACTIVE",
    telegramUserId: "123456789",
    updatedAt: NOW,
  });
  let profile = createUserProfile({
    companySize: "SMALL",
    companyType: "Поставщик стройматериалов",
    createdAt: NOW,
    id: userProfileId(PROFILE_ID),
    regions: ["Алтайский край"],
    revision: 1,
    servicesAndProducts: ["Бетон"],
    updatedAt: NOW,
    userId: user.id,
    verticals: ["CONSTRUCTION"],
  });

  const sourceRepository: SourceRegistryRepository = {
    findById(id) {
      return Promise.resolve(sources.get(id) ?? null);
    },
    listPage(filter: SourceListFilter) {
      const items = [...sources.values()].filter(
        (source) =>
          (filter.enabled === undefined || source.enabled === filter.enabled) &&
          (filter.rightsStatus === undefined || source.rightsStatus === filter.rightsStatus),
      );
      return Promise.resolve({ items, nextCursor: null });
    },
    save(source) {
      sources.set(source.id, source);
      return Promise.resolve(source);
    },
  };
  const profileRepository: UserProfileRepository = {
    findLatest(id) {
      return Promise.resolve(id === user.id ? { profile, user } : null);
    },
    save(_savedUser, savedProfile) {
      profile = savedProfile;
      return Promise.resolve({ profile });
    },
  };
  const signalRepository: SignalOpportunityRepository = {
    findForUser() {
      return Promise.resolve(null);
    },
    listForUser(_id, filter) {
      latestSignalFilter = filter;
      return Promise.resolve({ items: [], nextCursor: null });
    },
  };
  const feedbackRepository: FeedbackRepository = {
    findRecommendationForUser(id, requestedSignalId) {
      return Promise.resolve(
        id === user.id && requestedSignalId === SIGNAL_ID
          ? {
              correlationId: correlationId("70000000-0000-4000-8000-000000000001"),
              recommendationId: recommendationId(RECOMMENDATION_ID),
            }
          : null,
      );
    },
    save(feedback) {
      const existing = feedbackById.get(feedback.id);
      if (existing !== undefined) {
        if (existing.action !== feedback.action || existing.reason !== feedback.reason) {
          throw new FeedbackWriteConflictError("Feedback id is already attached to another action");
        }
        return Promise.resolve({ created: false, feedback: existing });
      }
      feedbackById.set(feedback.id, feedback);
      return Promise.resolve({ created: true, feedback });
    },
  };

  return {
    api: {
      feedback: feedbackRepository,
      profiles: profileRepository,
      signals: signalRepository,
      sources: sourceRepository,
    } satisfies ApiRepositories,
    getLatestSignalFilter: () => latestSignalFilter,
    getProfile: () => profile,
    sources,
  };
};

const createTestApi = (apiRepositories: ApiRepositories | null = repositories().api) => {
  const app = buildApi({
    apiAuthToken: AUTH_TOKEN,
    idFactory: () => SOURCE_ID,
    logger: createLogger({ level: "silent", service: "api-business-test" }),
    now: () => new Date(NOW),
    repositories: apiRepositories,
  });
  apps.push(app);
  return app;
};

describe("private HTTP API v1", () => {
  it("requires Bearer authentication before accessing repositories", async () => {
    const app = createTestApi(null);

    const unauthorized = await app.inject({ method: "GET", url: "/sources" });
    const unavailable = await app.inject({
      headers: authorizedHeaders(),
      method: "GET",
      url: "/sources",
    });

    expect(unauthorized.statusCode).toBe(401);
    expect(unauthorized.headers["www-authenticate"]).toBe("Bearer");
    expect(unauthorized.headers["x-radar-api-version"]).toBe("1");
    expect(unavailable.statusCode).toBe(503);
  });

  it("creates a source and enforces its AI rights invariant on patch", async () => {
    const state = repositories();
    const app = createTestApi(state.api);

    const created = await app.inject({
      headers: authorizedHeaders(),
      method: "POST",
      payload: sourceRequest(),
      url: "/sources",
    });
    const unsafePatch = await app.inject({
      headers: authorizedHeaders(),
      method: "PATCH",
      payload: { rightsStatus: "REVIEW_REQUIRED" },
      url: `/sources/${SOURCE_ID}`,
    });

    expect(created.statusCode).toBe(201);
    expect(created.json()).toEqual({ id: SOURCE_ID });
    expect(state.sources.get(SOURCE_ID)?.aiProcessingAllowed).toBe(true);
    expect(unsafePatch.statusCode).toBe(422);
    expect(unsafePatch.json()).toMatchObject({ error: { code: "VALIDATION_ERROR" } });
    expect(state.sources.get(SOURCE_ID)?.rightsStatus).toBe("OPEN_DATA");
  });

  it("rejects unknown request fields", async () => {
    const app = createTestApi();

    const response = await app.inject({
      headers: authorizedHeaders(),
      method: "POST",
      payload: { ...sourceRequest(), undocumented: true },
      url: "/sources",
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: "VALIDATION_ERROR" } });
  });

  it("maps bounded signal filters to the personalized recommendation query", async () => {
    const state = repositories();
    const app = createTestApi(state.api);

    const response = await app.inject({
      headers: authorizedHeaders(),
      method: "GET",
      url: "/signals?vertical=CONSTRUCTION&status=ACTIVE&score=75&limit=10",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ items: [], nextCursor: null });
    expect(state.getLatestSignalFilter()).toMatchObject({
      limit: 10,
      minimumScore: 75,
      status: "ACTIVE",
      vertical: "CONSTRUCTION",
    });
  });

  it("prevents cross-user profile access and appends a new profile revision", async () => {
    const state = repositories();
    const app = createTestApi(state.api);

    const forbidden = await app.inject({
      headers: authorizedHeaders(OTHER_USER_ID),
      method: "GET",
      url: `/users/${USER_ID}/profile`,
    });
    const updated = await app.inject({
      headers: authorizedHeaders(),
      method: "PATCH",
      payload: { keywords: ["генподряд"] },
      url: `/users/${USER_ID}/profile`,
    });
    const read = await app.inject({
      headers: authorizedHeaders(),
      method: "GET",
      url: `/users/${USER_ID}/profile`,
    });

    expect(forbidden.statusCode).toBe(403);
    expect(updated.statusCode).toBe(204);
    expect(state.getProfile()).toMatchObject({ keywords: ["генподряд"], revision: 2 });
    expect(read.statusCode).toBe(200);
    expect(read.json()).toMatchObject({ keywords: ["генподряд"], revision: 2, userId: USER_ID });
  });

  it("creates feedback idempotently and reports a reused-key conflict", async () => {
    const app = createTestApi();
    const request = (action: "NOT_USEFUL" | "USEFUL") =>
      app.inject({
        headers: { ...authorizedHeaders(), "idempotency-key": FEEDBACK_ID },
        method: "POST",
        payload: { action },
        url: `/signals/${SIGNAL_ID}/feedback`,
      });

    const created = await request("USEFUL");
    const repeated = await request("USEFUL");
    const conflict = await request("NOT_USEFUL");

    expect(created.statusCode).toBe(201);
    expect(created.json()).toEqual({ id: FEEDBACK_ID });
    expect(repeated.statusCode).toBe(200);
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json()).toMatchObject({ error: { code: "CONFLICT" } });
  });
});
