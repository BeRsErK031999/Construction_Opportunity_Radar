import {
  type CorrelationId,
  type DigestId,
  type RecommendationId,
  type UserId,
  type UserProfileId,
} from "../shared/identifiers.js";
import { assertInvariant } from "../shared/invariant.js";
import {
  isoDateTime,
  nonEmptyString,
  positiveInteger,
  version,
  type IsoDateTime,
  type Version,
} from "../shared/primitives.js";

export const DIGEST_KINDS = ["DAILY", "WEEKLY"] as const;
export type DigestKind = (typeof DIGEST_KINDS)[number];

export interface DigestItem {
  readonly rank: number;
  readonly recommendationId: RecommendationId;
}

export interface DigestCategoryTrend {
  readonly category: string;
  readonly currentCount: number;
  readonly delta: number;
  readonly previousCount: number;
  readonly rank: number;
}

export interface DigestWeeklySummary {
  readonly categoryTrends: readonly DigestCategoryTrend[];
  readonly highPriority: number;
  readonly opportunities: number;
  readonly processed: number;
  readonly relevant: number;
  readonly unique: number;
}

export interface Digest {
  readonly correlationId: CorrelationId;
  readonly createdAt: IsoDateTime;
  readonly id: DigestId;
  readonly items: readonly DigestItem[];
  readonly kind: DigestKind;
  readonly periodEnd: IsoDateTime;
  readonly periodStart: IsoDateTime;
  readonly userId: UserId;
  readonly userProfileId: UserProfileId;
  readonly userProfileRevision: number;
  readonly version: Version;
  readonly weeklySummary: DigestWeeklySummary | null;
}

export interface CreateDigestInput {
  readonly correlationId: CorrelationId;
  readonly createdAt: string;
  readonly id: DigestId;
  readonly items: readonly {
    readonly rank: number;
    readonly recommendationId: RecommendationId;
  }[];
  readonly kind: DigestKind;
  readonly periodEnd: string;
  readonly periodStart: string;
  readonly userId: UserId;
  readonly userProfileId: UserProfileId;
  readonly userProfileRevision: number;
  readonly version: string;
  readonly weeklySummary?: {
    readonly categoryTrends: readonly {
      readonly category: string;
      readonly currentCount: number;
      readonly delta: number;
      readonly previousCount: number;
      readonly rank: number;
    }[];
    readonly highPriority: number;
    readonly opportunities: number;
    readonly processed: number;
    readonly relevant: number;
    readonly unique: number;
  } | null;
}

const nonNegativeInteger = (value: number, field: string): number => {
  assertInvariant(
    Number.isInteger(value) && value >= 0,
    "INVALID_NON_NEGATIVE_INTEGER",
    `${field} must be a non-negative integer`,
  );
  return value;
};

const expectedPeriodMilliseconds: Readonly<Record<DigestKind, number>> = {
  DAILY: 24 * 60 * 60 * 1_000,
  WEEKLY: 7 * 24 * 60 * 60 * 1_000,
};

export const createDigest = (input: CreateDigestInput): Digest => {
  const periodStart = isoDateTime(input.periodStart, "periodStart");
  const periodEnd = isoDateTime(input.periodEnd, "periodEnd");
  const createdAt = isoDateTime(input.createdAt, "createdAt");
  assertInvariant(
    Date.parse(periodEnd) - Date.parse(periodStart) === expectedPeriodMilliseconds[input.kind],
    "INVALID_DIGEST_PERIOD",
    `${input.kind} digest must cover one complete UTC period`,
  );
  const startDate = new Date(periodStart);
  assertInvariant(
    startDate.getUTCHours() === 0 &&
      startDate.getUTCMinutes() === 0 &&
      startDate.getUTCSeconds() === 0 &&
      startDate.getUTCMilliseconds() === 0 &&
      (input.kind === "DAILY" || startDate.getUTCDay() === 1),
    "INVALID_DIGEST_PERIOD_ALIGNMENT",
    "Digest period must start at UTC midnight and weekly periods must start on Monday",
  );
  assertInvariant(
    input.items.length <= 5,
    "TOO_MANY_DIGEST_ITEMS",
    "Digest cannot contain more than five recommendations",
  );
  const items = input.items.map((item, index) => {
    assertInvariant(
      item.rank === index + 1,
      "INVALID_DIGEST_ITEM_RANK",
      "Digest item ranks must be contiguous and ordered",
    );
    return Object.freeze({
      rank: positiveInteger(item.rank, "item.rank"),
      recommendationId: item.recommendationId,
    });
  });
  assertInvariant(
    new Set(items.map((item) => item.recommendationId)).size === items.length,
    "DUPLICATE_DIGEST_RECOMMENDATION",
    "Digest recommendations must be unique",
  );

  const weeklySummaryInput = input.weeklySummary ?? null;
  assertInvariant(
    (input.kind === "WEEKLY") === (weeklySummaryInput !== null),
    "INVALID_DIGEST_SUMMARY",
    "Only weekly digests must contain a weekly summary",
  );
  const weeklySummary =
    weeklySummaryInput === null
      ? null
      : (() => {
          const processed = nonNegativeInteger(weeklySummaryInput.processed, "processed");
          const unique = nonNegativeInteger(weeklySummaryInput.unique, "unique");
          const relevant = nonNegativeInteger(weeklySummaryInput.relevant, "relevant");
          const opportunities = nonNegativeInteger(
            weeklySummaryInput.opportunities,
            "opportunities",
          );
          const highPriority = nonNegativeInteger(weeklySummaryInput.highPriority, "highPriority");
          assertInvariant(
            highPriority <= opportunities,
            "INVALID_DIGEST_FUNNEL",
            "High-priority count exceeds opportunity count",
          );
          const categoryTrends = weeklySummaryInput.categoryTrends.map((trend, index) => {
            const currentCount = nonNegativeInteger(trend.currentCount, "trend.currentCount");
            const previousCount = nonNegativeInteger(trend.previousCount, "trend.previousCount");
            assertInvariant(
              trend.rank === index + 1,
              "INVALID_DIGEST_TREND_RANK",
              "Category trend ranks must be contiguous and ordered",
            );
            assertInvariant(
              trend.delta === currentCount - previousCount && trend.delta > 0,
              "INVALID_DIGEST_TREND_DELTA",
              "Category trends must contain a positive exact delta",
            );
            return Object.freeze({
              category: nonEmptyString(trend.category, "trend.category", 200),
              currentCount,
              delta: trend.delta,
              previousCount,
              rank: positiveInteger(trend.rank, "trend.rank"),
            });
          });
          assertInvariant(
            categoryTrends.length <= 5,
            "TOO_MANY_DIGEST_TRENDS",
            "Weekly digest cannot contain more than five category trends",
          );
          assertInvariant(
            new Set(categoryTrends.map((trend) => trend.category.toLocaleLowerCase("ru"))).size ===
              categoryTrends.length,
            "DUPLICATE_DIGEST_CATEGORY",
            "Weekly category trends must be unique",
          );
          return Object.freeze({
            categoryTrends: Object.freeze(categoryTrends),
            highPriority,
            opportunities,
            processed,
            relevant,
            unique,
          });
        })();

  return Object.freeze({
    correlationId: input.correlationId,
    createdAt,
    id: input.id,
    items: Object.freeze(items),
    kind: input.kind,
    periodEnd,
    periodStart,
    userId: input.userId,
    userProfileId: input.userProfileId,
    userProfileRevision: positiveInteger(input.userProfileRevision, "userProfileRevision"),
    version: version(input.version, "digestVersion"),
    weeklySummary,
  });
};

export const digestIdentityKey = (digest: Digest): string =>
  JSON.stringify([
    digest.userId,
    digest.kind,
    digest.periodStart,
    digest.periodEnd,
    digest.version,
  ]);
