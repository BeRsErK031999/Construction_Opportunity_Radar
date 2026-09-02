import {
  createDigest,
  type CorrelationId,
  type Digest,
  type DigestId,
  type DigestKind,
  type OpportunityBand,
  type RecommendationId,
  type SignalId,
  type UserId,
  type UserProfileId,
} from "@radar/core";

import { type SignalOpportunity } from "../api/application-api.js";

export const DIGEST_VERSION_V1 = "digest-v1";

export interface DigestCandidate {
  readonly band: OpportunityBand;
  readonly category: string;
  readonly createdAt: string;
  readonly recommendationId: RecommendationId;
  readonly signalId: SignalId;
  readonly totalScore: number;
}

export interface DigestBuildSnapshot {
  readonly candidates: readonly DigestCandidate[];
  readonly previousCandidates: readonly DigestCandidate[];
  readonly processed: number;
  readonly relevant: number;
  readonly unique: number;
  readonly userProfileId: UserProfileId;
  readonly userProfileRevision: number;
}

export interface DigestViewItem {
  readonly opportunity: SignalOpportunity;
  readonly rank: number;
}

export interface DigestView {
  readonly digest: Digest;
  readonly items: readonly DigestViewItem[];
}

export interface DigestSaveResult {
  readonly created: boolean;
  readonly digest: Digest;
}

export interface DigestRepository {
  collectBuildSnapshot(input: {
    readonly periodEnd: string;
    readonly periodStart: string;
    readonly previousPeriodStart: string;
    readonly userId: UserId;
  }): Promise<DigestBuildSnapshot | null>;
  findByIdentity(input: {
    readonly kind: DigestKind;
    readonly periodEnd: string;
    readonly periodStart: string;
    readonly userId: UserId;
    readonly version: string;
  }): Promise<Digest | null>;
  findView(id: DigestId): Promise<DigestView | null>;
  save(digest: Digest): Promise<DigestSaveResult>;
}

export type DigestBuildErrorCode = "DIGEST_VIEW_NOT_FOUND" | "USER_PROFILE_NOT_FOUND";

export class DigestBuildError extends Error {
  readonly code: DigestBuildErrorCode;

  constructor(code: DigestBuildErrorCode, message: string) {
    super(message);
    this.name = "DigestBuildError";
    this.code = code;
  }
}

export class DigestWriteConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DigestWriteConflictError";
  }
}

const compareText = (left: string, right: string): number =>
  left === right ? 0 : left < right ? -1 : 1;

const compareCandidates = (left: DigestCandidate, right: DigestCandidate): number =>
  right.totalScore - left.totalScore ||
  compareText(right.createdAt, left.createdAt) ||
  compareText(left.recommendationId, right.recommendationId);

const uniqueCandidates = (candidates: readonly DigestCandidate[]): readonly DigestCandidate[] => {
  const signalIds = new Set<SignalId>();
  const result: DigestCandidate[] = [];
  for (const candidate of [...candidates].sort(compareCandidates)) {
    if (!signalIds.has(candidate.signalId)) {
      signalIds.add(candidate.signalId);
      result.push(candidate);
    }
  }
  return Object.freeze(result);
};

const categoryCounts = (candidates: readonly DigestCandidate[]): ReadonlyMap<string, number> => {
  const counts = new Map<string, number>();
  for (const candidate of candidates) {
    counts.set(candidate.category, (counts.get(candidate.category) ?? 0) + 1);
  }
  return counts;
};

const categoryTrends = (
  current: readonly DigestCandidate[],
  previous: readonly DigestCandidate[],
) => {
  const currentCounts = categoryCounts(current);
  const previousCounts = categoryCounts(previous);
  return [...currentCounts.entries()]
    .map(([category, currentCount]) => ({
      category,
      currentCount,
      delta: currentCount - (previousCounts.get(category) ?? 0),
      previousCount: previousCounts.get(category) ?? 0,
    }))
    .filter((trend) => trend.delta > 0)
    .sort(
      (left, right) =>
        right.delta - left.delta ||
        right.currentCount - left.currentCount ||
        compareText(left.category, right.category),
    )
    .slice(0, 5)
    .map((trend, index) => Object.freeze({ ...trend, rank: index + 1 }));
};

export interface DigestPeriod {
  readonly end: string;
  readonly previousStart: string;
  readonly start: string;
}

export const digestPeriodFor = (kind: DigestKind, at: string): DigestPeriod => {
  const instant = new Date(at);
  if (!Number.isFinite(instant.getTime())) {
    throw new RangeError("Digest instant must be an ISO date-time");
  }
  const start = new Date(
    Date.UTC(instant.getUTCFullYear(), instant.getUTCMonth(), instant.getUTCDate()),
  );
  if (kind === "WEEKLY") {
    const daysSinceMonday = (start.getUTCDay() + 6) % 7;
    start.setUTCDate(start.getUTCDate() - daysSinceMonday);
  }
  const durationDays = kind === "DAILY" ? 1 : 7;
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + durationDays);
  const previousStart = new Date(start);
  previousStart.setUTCDate(previousStart.getUTCDate() - durationDays);
  return Object.freeze({
    end: end.toISOString(),
    previousStart: previousStart.toISOString(),
    start: start.toISOString(),
  });
};

export const buildDigest = async (input: {
  readonly correlationId: CorrelationId;
  readonly digestId: DigestId;
  readonly kind: DigestKind;
  readonly now: string;
  readonly period: DigestPeriod;
  readonly repository: DigestRepository;
  readonly userId: UserId;
  readonly version?: string;
}): Promise<{ readonly created: boolean; readonly view: DigestView }> => {
  const version = input.version ?? DIGEST_VERSION_V1;
  const existing = await input.repository.findByIdentity({
    kind: input.kind,
    periodEnd: input.period.end,
    periodStart: input.period.start,
    userId: input.userId,
    version,
  });
  if (existing !== null) {
    const view = await input.repository.findView(existing.id);
    if (view === null) {
      throw new DigestBuildError("DIGEST_VIEW_NOT_FOUND", "Persisted digest content is missing");
    }
    return Object.freeze({ created: false, view });
  }

  const snapshot = await input.repository.collectBuildSnapshot({
    periodEnd: input.period.end,
    periodStart: input.period.start,
    previousPeriodStart: input.period.previousStart,
    userId: input.userId,
  });
  if (snapshot === null) {
    throw new DigestBuildError("USER_PROFILE_NOT_FOUND", "User profile is required for a digest");
  }
  const candidates = uniqueCandidates(snapshot.candidates);
  const previousCandidates = uniqueCandidates(snapshot.previousCandidates);
  const items = candidates.slice(0, 5).map((candidate, index) => ({
    rank: index + 1,
    recommendationId: candidate.recommendationId,
  }));
  const digest = createDigest({
    correlationId: input.correlationId,
    createdAt: input.now,
    id: input.digestId,
    items,
    kind: input.kind,
    periodEnd: input.period.end,
    periodStart: input.period.start,
    userId: input.userId,
    userProfileId: snapshot.userProfileId,
    userProfileRevision: snapshot.userProfileRevision,
    version,
    ...(input.kind === "WEEKLY"
      ? {
          weeklySummary: {
            categoryTrends: categoryTrends(candidates, previousCandidates),
            highPriority: candidates.filter(
              (candidate) => candidate.band === "HIGH" || candidate.band === "CRITICAL",
            ).length,
            opportunities: candidates.length,
            processed: snapshot.processed,
            relevant: snapshot.relevant,
            unique: snapshot.unique,
          },
        }
      : {}),
  });
  if (digest.kind === "DAILY" && digest.items.length === 0) {
    return Object.freeze({
      created: false,
      view: Object.freeze({ digest, items: Object.freeze([]) }),
    });
  }
  const saved = await input.repository.save(digest);
  const view = await input.repository.findView(saved.digest.id);
  if (view === null) {
    throw new DigestBuildError("DIGEST_VIEW_NOT_FOUND", "Saved digest content is missing");
  }
  return Object.freeze({ created: saved.created, view });
};
