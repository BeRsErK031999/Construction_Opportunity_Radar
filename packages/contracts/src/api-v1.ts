import {
  COMPANY_SIZES,
  FEEDBACK_ACTIONS,
  OPPORTUNITY_BANDS,
  PARSER_KINDS,
  PROFILE_VERTICALS,
  RECOMMENDED_ACTION_KINDS,
  RIGHTS_STATUSES,
  SIGNAL_STATUSES,
  SOURCE_TYPES,
  VERTICALS,
} from "@radar/core";
import { z } from "zod";

export const API_CONTRACT_VERSION_V1 = "1" as const;

const IdentifierSchema = z.uuid();
const TimestampSchema = z.iso.datetime();
const NullableText = (maximum: number) => z.string().trim().min(1).max(maximum).nullable();
const UniqueStrings = (maximumItems = 100) =>
  z
    .array(z.string().trim().min(1).max(2_000))
    .min(1)
    .max(maximumItems)
    .refine(
      (values) =>
        new Set(values.map((value) => value.toLocaleLowerCase("ru"))).size === values.length,
      "Values must be unique without regard to case",
    );

export const ApiErrorV1Schema = z.strictObject({
  error: z.strictObject({
    code: z.string().trim().min(1).max(100),
    details: z
      .array(
        z.strictObject({
          message: z.string().trim().min(1).max(500),
          path: z.string().max(500),
        }),
      )
      .max(100),
    message: z.string().trim().min(1).max(500),
    requestId: z.string().trim().min(1).max(200),
  }),
});
export type ApiErrorV1 = z.infer<typeof ApiErrorV1Schema>;

export const SourceV1Schema = z.strictObject({
  aiProcessingAllowed: z.boolean(),
  collectionPolicy: z.strictObject({
    parserKind: z.enum(PARSER_KINDS),
    pollIntervalMinutes: z.number().int().positive().nullable(),
  }),
  country: z.string().trim().min(1).max(100),
  createdAt: TimestampSchema,
  enabled: z.boolean(),
  id: IdentifierSchema,
  lastErrorAt: TimestampSchema.nullable(),
  lastSuccessAt: TimestampSchema.nullable(),
  name: z.string().trim().min(1).max(300),
  ownerContact: NullableText(500),
  regions: UniqueStrings(),
  reliabilityScore: z.number().min(0).max(100),
  rightsBasis: NullableText(4_000),
  rightsStatus: z.enum(RIGHTS_STATUSES),
  signalQualityNotes: NullableText(4_000),
  type: z.enum(SOURCE_TYPES),
  updatedAt: TimestampSchema,
  url: z.url({ protocol: /^https?$/ }),
  verticals: z.array(z.enum(VERTICALS)).min(1).max(3),
});
export type SourceV1 = z.infer<typeof SourceV1Schema>;

export const SourceCreateRequestV1Schema = SourceV1Schema.omit({
  createdAt: true,
  id: true,
  lastErrorAt: true,
  lastSuccessAt: true,
  updatedAt: true,
});
export type SourceCreateRequestV1 = z.infer<typeof SourceCreateRequestV1Schema>;

export const SourcePatchRequestV1Schema = SourceCreateRequestV1Schema.partial().refine(
  (value) => Object.keys(value).length > 0,
  "At least one source field is required",
);
export type SourcePatchRequestV1 = z.infer<typeof SourcePatchRequestV1Schema>;

const BooleanQuerySchema = z.enum(["true", "false"]).transform((value) => value === "true");
export const SourceListQueryV1Schema = z.strictObject({
  after: IdentifierSchema.optional(),
  aiProcessingAllowed: BooleanQuerySchema.optional(),
  enabled: BooleanQuerySchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  rightsStatus: z.enum(RIGHTS_STATUSES).optional(),
  vertical: z.enum(VERTICALS).optional(),
});
export type SourceListQueryV1 = z.infer<typeof SourceListQueryV1Schema>;

export const SourceListResponseV1Schema = z.strictObject({
  items: z.array(SourceV1Schema),
  nextCursor: IdentifierSchema.nullable(),
});
export type SourceListResponseV1 = z.infer<typeof SourceListResponseV1Schema>;

export const CreatedResourceV1Schema = z.strictObject({ id: IdentifierSchema });
export type CreatedResourceV1 = z.infer<typeof CreatedResourceV1Schema>;

const RecommendedActionV1Schema = z.strictObject({
  kind: z.enum(RECOMMENDED_ACTION_KINDS),
  priority: z.number().int().min(1).max(5),
  rationale: z.string().trim().min(1).max(2_000),
  title: z.string().trim().min(1).max(300),
});

const AnalysisFactV1Schema = z.strictObject({
  id: z.string().trim().min(1).max(200),
  sourceIds: z.array(IdentifierSchema).min(1).max(50),
  statement: z.string().trim().min(1).max(4_000),
});

const AnalysisInferenceV1Schema = z.strictObject({
  basisFactIds: z.array(z.string().trim().min(1).max(200)).min(1).max(50),
  id: z.string().trim().min(1).max(200),
  statement: z.string().trim().min(1).max(4_000),
});

const SourceLinkV1Schema = z.strictObject({
  canonicalUrl: z.url({ protocol: /^https?$/ }),
  normalizedItemId: IdentifierSchema,
  publishedAt: TimestampSchema.nullable(),
  sourceId: IdentifierSchema,
  sourceName: z.string().trim().min(1).max(300),
  sourceUrl: z.url({ protocol: /^https?$/ }),
});

export const SignalOpportunityV1Schema = z.strictObject({
  analysis: z.strictObject({
    confidence: z.number().min(0).max(1),
    deadline: TimestampSchema.nullable(),
    eventType: z.string().trim().min(1).max(200),
    facts: z.array(AnalysisFactV1Schema).min(1).max(50),
    headline: z.string().trim().min(1).max(500),
    inferences: z.array(AnalysisInferenceV1Schema).max(50),
    risks: z.array(z.string().trim().min(1).max(2_000)).max(20),
    summary: z.string().trim().min(1).max(4_000),
    whyImportant: z.string().trim().min(1).max(4_000),
  }),
  recommendation: z.strictObject({
    band: z.enum(OPPORTUNITY_BANDS),
    explanation: z.string().trim().min(1).max(4_000),
    id: IdentifierSchema,
    recommendedActions: z.array(RecommendedActionV1Schema).min(2).max(5),
    scoreBreakdown: z.strictObject({
      actionability: z.number().min(0).max(100),
      businessImpact: z.number().min(0).max(100),
      companyFit: z.number().min(0).max(100),
      confidence: z.number().min(0).max(100),
      urgency: z.number().min(0).max(100),
    }),
    scoringVersion: z.string().trim().min(1).max(100),
    totalScore: z.number().min(0).max(100),
  }),
  signal: z.strictObject({
    category: z.string().trim().min(1).max(200),
    classificationConfidence: z.number().min(0).max(100),
    createdAt: TimestampSchema,
    id: IdentifierSchema,
    relevanceScore: z.number().min(0).max(100),
    status: z.enum(SIGNAL_STATUSES),
    updatedAt: TimestampSchema,
    vertical: z.enum(VERTICALS),
  }),
  sources: z.array(SourceLinkV1Schema).min(1).max(50),
});
export type SignalOpportunityV1 = z.infer<typeof SignalOpportunityV1Schema>;

export const SignalListQueryV1Schema = z
  .strictObject({
    after: IdentifierSchema.optional(),
    category: z.string().trim().min(1).max(200).optional(),
    dateFrom: TimestampSchema.optional(),
    dateTo: TimestampSchema.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    score: z.coerce.number().min(0).max(100).optional(),
    status: z.enum(SIGNAL_STATUSES).optional(),
    vertical: z.enum(VERTICALS).optional(),
  })
  .refine(
    (value) =>
      value.dateFrom === undefined || value.dateTo === undefined || value.dateFrom <= value.dateTo,
    { message: "dateFrom must not exceed dateTo", path: ["dateTo"] },
  );
export type SignalListQueryV1 = z.infer<typeof SignalListQueryV1Schema>;

export const SignalListResponseV1Schema = z.strictObject({
  items: z.array(SignalOpportunityV1Schema),
  nextCursor: IdentifierSchema.nullable(),
});
export type SignalListResponseV1 = z.infer<typeof SignalListResponseV1Schema>;

const ProjectValueRangeV1Schema = z.strictObject({
  currency: z.string().regex(/^[A-Z]{3}$/),
  maximum: z.number().nonnegative().nullable(),
  minimum: z.number().nonnegative().nullable(),
});

export const UserProfileV1Schema = z.strictObject({
  companySize: z.enum(COMPANY_SIZES),
  companyType: z.string().trim().min(1).max(300),
  createdAt: TimestampSchema,
  excludedKeywords: z.array(z.string().trim().min(1).max(2_000)).max(100),
  id: IdentifierSchema,
  ignoredEventTypes: z.array(z.string().trim().min(1).max(2_000)).max(100),
  interestedEventTypes: z.array(z.string().trim().min(1).max(2_000)).max(100),
  keywords: z.array(z.string().trim().min(1).max(2_000)).max(100),
  projectValueRange: ProjectValueRangeV1Schema.nullable(),
  regions: UniqueStrings(),
  revision: z.number().int().positive(),
  servicesAndProducts: UniqueStrings(),
  targetClients: z.array(z.string().trim().min(1).max(2_000)).max(100),
  updatedAt: TimestampSchema,
  userId: IdentifierSchema,
  verticals: z.array(z.enum(PROFILE_VERTICALS)).min(1).max(2),
});
export type UserProfileV1 = z.infer<typeof UserProfileV1Schema>;

export const UserProfilePatchRequestV1Schema = UserProfileV1Schema.omit({
  createdAt: true,
  id: true,
  revision: true,
  updatedAt: true,
  userId: true,
})
  .partial()
  .refine((value) => Object.keys(value).length > 0, "At least one profile field is required");
export type UserProfilePatchRequestV1 = z.infer<typeof UserProfilePatchRequestV1Schema>;

export const FeedbackCreateRequestV1Schema = z.strictObject({
  action: z.enum(FEEDBACK_ACTIONS),
  reason: NullableText(2_000).optional(),
});
export type FeedbackCreateRequestV1 = z.infer<typeof FeedbackCreateRequestV1Schema>;

export const FeedbackSummaryQueryV1Schema = z.strictObject({
  highScoreLimit: z.coerce.number().int().min(1).max(100).default(20),
});
export type FeedbackSummaryQueryV1 = z.infer<typeof FeedbackSummaryQueryV1Schema>;

const HighScoreNotUsefulFeedbackV1Schema = z
  .strictObject({
    attribution: z.enum(["DIRECT", "TELEGRAM"]),
    band: z.enum(["HIGH", "CRITICAL"]),
    correlationId: IdentifierSchema,
    deliveryId: IdentifierSchema.nullable(),
    feedbackAt: TimestampSchema,
    feedbackId: IdentifierSchema,
    headline: z.string().trim().min(1).max(500),
    reason: NullableText(2_000),
    recommendationId: IdentifierSchema,
    signalId: IdentifierSchema,
    totalScore: z.number().min(0).max(100),
    vertical: z.enum(VERTICALS),
  })
  .refine(
    (value) =>
      (value.attribution === "DIRECT" && value.deliveryId === null) ||
      (value.attribution === "TELEGRAM" && value.deliveryId !== null),
    { message: "Attribution must match deliveryId", path: ["deliveryId"] },
  );

const roundedPercent = (numerator: number, denominator: number): number =>
  denominator === 0 ? 0 : Math.round((numerator / denominator) * 10_000) / 100;

export const FeedbackSummaryV1Schema = z
  .strictObject({
    actions: z.strictObject({
      acted: z.number().int().nonnegative(),
      alreadyKnown: z.number().int().nonnegative(),
      notUseful: z.number().int().nonnegative(),
      saved: z.number().int().nonnegative(),
      useful: z.number().int().nonnegative(),
    }),
    attribution: z.strictObject({
      direct: z.number().int().nonnegative(),
      telegram: z.number().int().nonnegative(),
    }),
    feedbackCoveragePercent: z.number().min(0).max(100),
    generatedAt: TimestampSchema,
    highScoreNotUseful: z.array(HighScoreNotUsefulFeedbackV1Schema).max(100),
    positiveSentimentPercent: z.number().min(0).max(100).nullable(),
    totals: z.strictObject({
      actions: z.number().int().nonnegative(),
      deliveredRecommendations: z.number().int().nonnegative(),
      evaluatedDeliveredRecommendations: z.number().int().nonnegative(),
      recommendationsWithFeedback: z.number().int().nonnegative(),
    }),
    userId: IdentifierSchema,
  })
  .superRefine((value, context) => {
    const actionTotal = Object.values(value.actions).reduce((total, count) => total + count, 0);
    if (value.totals.actions !== actionTotal) {
      context.addIssue({
        code: "custom",
        message: "Action total must equal the sum of action counts",
        path: ["totals", "actions"],
      });
    }
    if (value.attribution.direct + value.attribution.telegram !== value.totals.actions) {
      context.addIssue({
        code: "custom",
        message: "Attribution counts must equal the action total",
        path: ["attribution"],
      });
    }
    if (value.totals.evaluatedDeliveredRecommendations > value.totals.deliveredRecommendations) {
      context.addIssue({
        code: "custom",
        message: "Evaluated deliveries cannot exceed delivered recommendations",
        path: ["totals", "evaluatedDeliveredRecommendations"],
      });
    }
    const expectedCoverage = roundedPercent(
      value.totals.evaluatedDeliveredRecommendations,
      value.totals.deliveredRecommendations,
    );
    if (value.feedbackCoveragePercent !== expectedCoverage) {
      context.addIssue({
        code: "custom",
        message: "Coverage must match evaluated and delivered recommendation totals",
        path: ["feedbackCoveragePercent"],
      });
    }
    const sentimentTotal = value.actions.useful + value.actions.notUseful;
    const expectedSentiment =
      sentimentTotal === 0 ? null : roundedPercent(value.actions.useful, sentimentTotal);
    if (value.positiveSentimentPercent !== expectedSentiment) {
      context.addIssue({
        code: "custom",
        message: "Positive sentiment must match useful and not-useful counts",
        path: ["positiveSentimentPercent"],
      });
    }
  });
export type FeedbackSummaryV1 = z.infer<typeof FeedbackSummaryV1Schema>;
