import { createHash, randomUUID, timingSafeEqual } from "node:crypto";

import {
  ApplicationApiError,
  createSourceEntry,
  getUserFeedbackSummary,
  getSignalOpportunity,
  getUserProfile,
  listSignalOpportunities,
  listSources,
  patchSourceEntry,
  patchUserProfile,
  submitSignalFeedback,
  type FeedbackRepository,
  type FeedbackReadRepository,
  type FeedbackSummary,
  type SignalOpportunity,
  type SignalOpportunityRepository,
  type SourceRegistryRepository,
  type UserProfileRepository,
} from "@radar/application";
import {
  API_CONTRACT_VERSION_V1,
  ApiErrorV1Schema,
  CreatedResourceV1Schema,
  FeedbackCreateRequestV1Schema,
  FeedbackSummaryQueryV1Schema,
  FeedbackSummaryV1Schema,
  HealthResponseSchema,
  SignalListQueryV1Schema,
  SignalListResponseV1Schema,
  SignalOpportunityV1Schema,
  SourceCreateRequestV1Schema,
  SourceListQueryV1Schema,
  SourceListResponseV1Schema,
  SourcePatchRequestV1Schema,
  SourceV1Schema,
  UserProfilePatchRequestV1Schema,
  UserProfileV1Schema,
  type ApiErrorV1,
  type HealthResponse,
} from "@radar/contracts";
import {
  feedbackId,
  recommendationId,
  signalId,
  sourceId,
  userId,
  type Source,
  type UserProfile,
} from "@radar/core";
import { type AppLogger } from "@radar/observability";
import Fastify, { type FastifyRequest } from "fastify";
import { z } from "zod";

export const API_VERSION = "0.1.0";

export interface ApiRepositories {
  readonly feedback: FeedbackRepository;
  readonly feedbackRead: FeedbackReadRepository;
  readonly profiles: UserProfileRepository;
  readonly signals: SignalOpportunityRepository;
  readonly sources: SourceRegistryRepository;
}

export interface BuildApiOptions {
  readonly apiAuthToken?: string | null;
  readonly idFactory?: () => string;
  readonly logger: AppLogger;
  readonly now?: () => Date;
  readonly onClose?: () => Promise<void>;
  readonly repositories?: ApiRepositories | null;
  readonly uptime?: () => number;
  readonly version?: string;
}

type ApiErrorCode =
  | "API_NOT_CONFIGURED"
  | "CONFLICT"
  | "FORBIDDEN"
  | "INTERNAL_ERROR"
  | "NOT_FOUND"
  | "UNAUTHORIZED"
  | "VALIDATION_ERROR";

class HttpApiError extends Error {
  readonly code: ApiErrorCode;
  readonly details: readonly { readonly message: string; readonly path: string }[];
  readonly statusCode: number;

  constructor(
    statusCode: number,
    code: ApiErrorCode,
    message: string,
    details: readonly { readonly message: string; readonly path: string }[] = [],
  ) {
    super(message);
    this.name = "HttpApiError";
    this.code = code;
    this.details = details;
    this.statusCode = statusCode;
  }
}

const secureTokenMatch = (presented: string, expected: string): boolean =>
  timingSafeEqual(
    createHash("sha256").update(presented).digest(),
    createHash("sha256").update(expected).digest(),
  );

const authenticate = (request: FastifyRequest, configuredToken: string | null): void => {
  if (configuredToken === null) {
    throw new HttpApiError(
      503,
      "API_NOT_CONFIGURED",
      "Business API requires API_AUTH_TOKEN configuration",
    );
  }
  const authorization = request.headers.authorization;
  const presented = authorization?.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : null;
  if (presented === null || !secureTokenMatch(presented, configuredToken)) {
    throw new HttpApiError(401, "UNAUTHORIZED", "Valid Bearer credentials are required");
  }
};

const header = (request: FastifyRequest, name: string): string => {
  const value = request.headers[name];
  if (typeof value !== "string" || value.length === 0) {
    throw new HttpApiError(400, "VALIDATION_ERROR", `Header ${name} is required`, [
      { message: "Required header is missing or repeated", path: `headers.${name}` },
    ]);
  }
  return value;
};

const callerUserId = (request: FastifyRequest) =>
  userId(z.uuid().parse(header(request, "x-radar-user-id")));

const requireRepositories = (repositories: ApiRepositories | null): ApiRepositories => {
  if (repositories === null) {
    throw new HttpApiError(503, "API_NOT_CONFIGURED", "Business API database is not configured");
  }
  return repositories;
};

const sourceResponse = (source: Source) => SourceV1Schema.parse(source);

const profileResponse = (profile: UserProfile) => UserProfileV1Schema.parse(profile);

const feedbackSummaryResponse = (summary: FeedbackSummary) =>
  FeedbackSummaryV1Schema.parse({
    actions: {
      acted: summary.actions.ACTED,
      alreadyKnown: summary.actions.ALREADY_KNOWN,
      notUseful: summary.actions.NOT_USEFUL,
      saved: summary.actions.SAVED,
      useful: summary.actions.USEFUL,
    },
    attribution: summary.attribution,
    feedbackCoveragePercent: summary.feedbackCoveragePercent,
    generatedAt: summary.generatedAt,
    highScoreNotUseful: summary.highScoreNotUseful,
    positiveSentimentPercent: summary.positiveSentimentPercent,
    totals: summary.totals,
    userId: summary.userId,
  });

const opportunityResponse = (opportunity: SignalOpportunity) =>
  SignalOpportunityV1Schema.parse({
    analysis: {
      confidence: opportunity.analysis.confidence,
      deadline: opportunity.analysis.deadline,
      eventType: opportunity.analysis.eventType,
      facts: opportunity.analysis.facts,
      headline: opportunity.analysis.headline,
      inferences: opportunity.analysis.inferences,
      risks: opportunity.analysis.risks,
      summary: opportunity.analysis.summary,
      whyImportant: opportunity.analysis.whyImportant,
    },
    recommendation: {
      band: opportunity.recommendation.band,
      explanation: opportunity.recommendation.explanation,
      id: opportunity.recommendation.id,
      recommendedActions: opportunity.recommendation.recommendedActions,
      scoreBreakdown: opportunity.recommendation.scoreBreakdown,
      scoringVersion: opportunity.recommendation.scoringVersion,
      totalScore: opportunity.recommendation.totalScore,
    },
    signal: {
      category: opportunity.signal.category,
      classificationConfidence: opportunity.signal.classificationConfidence,
      createdAt: opportunity.signal.createdAt,
      id: opportunity.signal.id,
      relevanceScore: opportunity.signal.relevanceScore,
      status: opportunity.signal.status,
      updatedAt: opportunity.signal.updatedAt,
      vertical: opportunity.signal.vertical,
    },
    sources: opportunity.sources,
  });

const applicationError = (error: ApplicationApiError): HttpApiError => {
  const statusByCode = {
    CONFLICT: 409,
    FORBIDDEN: 403,
    INVALID_INPUT: 422,
    NOT_FOUND: 404,
  } as const;
  const publicCode: ApiErrorCode = error.code === "INVALID_INPUT" ? "VALIDATION_ERROR" : error.code;
  return new HttpApiError(statusByCode[error.code], publicCode, error.message);
};

const errorResponse = (error: HttpApiError, requestId: string): ApiErrorV1 =>
  ApiErrorV1Schema.parse({
    error: {
      code: error.code,
      details: error.details,
      message: error.message,
      requestId,
    },
  });

const zodError = (error: z.ZodError): HttpApiError =>
  new HttpApiError(
    400,
    "VALIDATION_ERROR",
    "Request validation failed",
    error.issues.map((issue) => ({ message: issue.message, path: issue.path.join(".") })),
  );

export const buildApi = (options: BuildApiOptions) => {
  const now = options.now ?? (() => new Date());
  const uptime = options.uptime ?? (() => process.uptime());
  const version = options.version ?? API_VERSION;
  const configuredToken = options.apiAuthToken ?? null;
  const repositories = options.repositories ?? null;
  const idFactory = options.idFactory ?? randomUUID;
  const app = Fastify({ loggerInstance: options.logger });

  app.addHook("onSend", async (_request, reply) => {
    void reply.header("x-radar-api-version", API_CONTRACT_VERSION_V1);
  });
  if (options.onClose !== undefined) {
    app.addHook("onClose", options.onClose);
  }

  app.setErrorHandler((error, request, reply) => {
    const mapped =
      error instanceof HttpApiError
        ? error
        : error instanceof ApplicationApiError
          ? applicationError(error)
          : error instanceof z.ZodError
            ? zodError(error)
            : new HttpApiError(500, "INTERNAL_ERROR", "Unexpected internal error");
    if (mapped.statusCode >= 500 && !(error instanceof HttpApiError)) {
      request.log.error(
        { err: error, event: "api_request_failed", request_id: request.id },
        "API request failed",
      );
    }
    if (mapped.statusCode === 401) {
      void reply.header("www-authenticate", "Bearer");
    }
    return reply.code(mapped.statusCode).send(errorResponse(mapped, request.id));
  });

  app.get<{ Reply: HealthResponse }>("/health", () =>
    HealthResponseSchema.parse({
      service: "api",
      status: "ok",
      timestamp: now().toISOString(),
      uptimeSeconds: uptime(),
      version,
    }),
  );

  app.get("/sources", async (request) => {
    authenticate(request, configuredToken);
    const query = SourceListQueryV1Schema.parse(request.query);
    const page = await listSources(requireRepositories(repositories).sources, {
      ...(query.after === undefined ? {} : { after: sourceId(query.after) }),
      ...(query.aiProcessingAllowed === undefined
        ? {}
        : { aiProcessingAllowed: query.aiProcessingAllowed }),
      ...(query.enabled === undefined ? {} : { enabled: query.enabled }),
      limit: query.limit,
      ...(query.rightsStatus === undefined ? {} : { rightsStatus: query.rightsStatus }),
      ...(query.vertical === undefined ? {} : { vertical: query.vertical }),
    });
    return SourceListResponseV1Schema.parse({
      items: page.items.map(sourceResponse),
      nextCursor: page.nextCursor,
    });
  });

  app.post("/sources", async (request, reply) => {
    authenticate(request, configuredToken);
    const body = SourceCreateRequestV1Schema.parse(request.body);
    const id = sourceId(idFactory());
    await createSourceEntry({
      fields: body,
      id,
      now: now().toISOString(),
      repository: requireRepositories(repositories).sources,
    });
    return reply.code(201).send(CreatedResourceV1Schema.parse({ id }));
  });

  app.patch("/sources/:id", async (request, reply) => {
    authenticate(request, configuredToken);
    const path = z.strictObject({ id: z.uuid() }).parse(request.params);
    const body = SourcePatchRequestV1Schema.parse(request.body);
    await patchSourceEntry({
      id: sourceId(path.id),
      now: now().toISOString(),
      patch: {
        ...(body.aiProcessingAllowed === undefined
          ? {}
          : { aiProcessingAllowed: body.aiProcessingAllowed }),
        ...(body.collectionPolicy === undefined ? {} : { collectionPolicy: body.collectionPolicy }),
        ...(body.country === undefined ? {} : { country: body.country }),
        ...(body.enabled === undefined ? {} : { enabled: body.enabled }),
        ...(body.name === undefined ? {} : { name: body.name }),
        ...(body.ownerContact === undefined ? {} : { ownerContact: body.ownerContact }),
        ...(body.regions === undefined ? {} : { regions: body.regions }),
        ...(body.reliabilityScore === undefined ? {} : { reliabilityScore: body.reliabilityScore }),
        ...(body.rightsBasis === undefined ? {} : { rightsBasis: body.rightsBasis }),
        ...(body.rightsStatus === undefined ? {} : { rightsStatus: body.rightsStatus }),
        ...(body.signalQualityNotes === undefined
          ? {}
          : { signalQualityNotes: body.signalQualityNotes }),
        ...(body.type === undefined ? {} : { type: body.type }),
        ...(body.url === undefined ? {} : { url: body.url }),
        ...(body.verticals === undefined ? {} : { verticals: body.verticals }),
      },
      repository: requireRepositories(repositories).sources,
    });
    return reply.code(204).send();
  });

  app.get("/signals", async (request) => {
    authenticate(request, configuredToken);
    const query = SignalListQueryV1Schema.parse(request.query);
    const page = await listSignalOpportunities({
      callerUserId: callerUserId(request),
      filter: {
        ...(query.after === undefined ? {} : { after: recommendationId(query.after) }),
        ...(query.category === undefined ? {} : { category: query.category }),
        ...(query.dateFrom === undefined ? {} : { dateFrom: query.dateFrom }),
        ...(query.dateTo === undefined ? {} : { dateTo: query.dateTo }),
        limit: query.limit,
        ...(query.score === undefined ? {} : { minimumScore: query.score }),
        ...(query.status === undefined ? {} : { status: query.status }),
        ...(query.vertical === undefined ? {} : { vertical: query.vertical }),
      },
      repository: requireRepositories(repositories).signals,
    });
    return SignalListResponseV1Schema.parse({
      items: page.items.map(opportunityResponse),
      nextCursor: page.nextCursor,
    });
  });

  app.get("/signals/:id", async (request) => {
    authenticate(request, configuredToken);
    const path = z.strictObject({ id: z.uuid() }).parse(request.params);
    return opportunityResponse(
      await getSignalOpportunity({
        callerUserId: callerUserId(request),
        repository: requireRepositories(repositories).signals,
        signalId: signalId(path.id),
      }),
    );
  });

  app.get("/users/:id/profile", async (request) => {
    authenticate(request, configuredToken);
    const path = z.strictObject({ id: z.uuid() }).parse(request.params);
    return profileResponse(
      await getUserProfile({
        callerUserId: callerUserId(request),
        repository: requireRepositories(repositories).profiles,
        userId: userId(path.id),
      }),
    );
  });

  app.patch("/users/:id/profile", async (request, reply) => {
    authenticate(request, configuredToken);
    const path = z.strictObject({ id: z.uuid() }).parse(request.params);
    const body = UserProfilePatchRequestV1Schema.parse(request.body);
    await patchUserProfile({
      callerUserId: callerUserId(request),
      now: now().toISOString(),
      patch: {
        ...(body.companySize === undefined ? {} : { companySize: body.companySize }),
        ...(body.companyType === undefined ? {} : { companyType: body.companyType }),
        ...(body.excludedKeywords === undefined ? {} : { excludedKeywords: body.excludedKeywords }),
        ...(body.ignoredEventTypes === undefined
          ? {}
          : { ignoredEventTypes: body.ignoredEventTypes }),
        ...(body.interestedEventTypes === undefined
          ? {}
          : { interestedEventTypes: body.interestedEventTypes }),
        ...(body.keywords === undefined ? {} : { keywords: body.keywords }),
        ...(body.projectValueRange === undefined
          ? {}
          : { projectValueRange: body.projectValueRange }),
        ...(body.regions === undefined ? {} : { regions: body.regions }),
        ...(body.servicesAndProducts === undefined
          ? {}
          : { servicesAndProducts: body.servicesAndProducts }),
        ...(body.targetClients === undefined ? {} : { targetClients: body.targetClients }),
        ...(body.verticals === undefined ? {} : { verticals: body.verticals }),
      },
      repository: requireRepositories(repositories).profiles,
      userId: userId(path.id),
    });
    return reply.code(204).send();
  });

  app.get("/users/:id/feedback-summary", async (request) => {
    authenticate(request, configuredToken);
    const path = z.strictObject({ id: z.uuid() }).parse(request.params);
    const query = FeedbackSummaryQueryV1Schema.parse(request.query);
    return feedbackSummaryResponse(
      await getUserFeedbackSummary({
        callerUserId: callerUserId(request),
        generatedAt: now().toISOString(),
        highScoreLimit: query.highScoreLimit,
        repository: requireRepositories(repositories).feedbackRead,
        userId: userId(path.id),
      }),
    );
  });

  app.post("/signals/:id/feedback", async (request, reply) => {
    authenticate(request, configuredToken);
    const path = z.strictObject({ id: z.uuid() }).parse(request.params);
    const body = FeedbackCreateRequestV1Schema.parse(request.body);
    const idempotencyKey = z.uuid().parse(header(request, "idempotency-key"));
    const result = await submitSignalFeedback({
      action: body.action,
      callerUserId: callerUserId(request),
      feedbackId: feedbackId(idempotencyKey),
      now: now().toISOString(),
      ...(body.reason === undefined ? {} : { reason: body.reason }),
      repository: requireRepositories(repositories).feedback,
      signalId: signalId(path.id),
    });
    return reply
      .code(result.created ? 201 : 200)
      .send(CreatedResourceV1Schema.parse({ id: result.feedback.id }));
  });

  return app;
};
