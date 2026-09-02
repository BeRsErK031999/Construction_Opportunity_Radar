import { type SuccessfulAnalysis } from "../analysis/analysis.js";
import {
  createRecommendation,
  createScoreBreakdown,
  type CreateRecommendationInput,
  type OpportunityBand,
  type Recommendation,
  type ScoreBreakdown,
} from "../recommendation/recommendation.js";
import { assertInvariant } from "../shared/invariant.js";
import { probability, score, version, type Score, type Version } from "../shared/primitives.js";
import { type Signal } from "../signal/signal.js";
import { type UserProfile } from "../user/user-profile.js";

export const SCORING_VERSION_V1 = "opportunity-score-v1";

export const OPPORTUNITY_SCORE_WEIGHTS_V1 = Object.freeze({
  actionability: 0.1,
  businessImpact: 0.35,
  companyFit: 0.25,
  confidence: 0.1,
  urgency: 0.2,
});

export const OPPORTUNITY_BAND_THRESHOLDS_V1 = Object.freeze({
  critical: 85,
  high: 70,
  low: 40,
  medium: 55,
});

export const COMPANY_FIT_WEIGHTS_V1 = Object.freeze({
  eventType: 0.2,
  offering: 0.15,
  projectValue: 0.1,
  region: 0.25,
  vertical: 0.3,
});

export const COMPANY_FIT_CRITERIA_V1 = [
  "VERTICAL",
  "REGION",
  "EVENT_TYPE",
  "OFFERING",
  "PROJECT_VALUE",
] as const;
export type CompanyFitCriterionV1 = (typeof COMPANY_FIT_CRITERIA_V1)[number];

export const COMPANY_FIT_REASON_CODES_V1 = [
  "EVENT_IGNORED",
  "EVENT_MATCH",
  "EVENT_MISMATCH",
  "EVENT_UNKNOWN",
  "EXCLUDED_TERM_MATCH",
  "OFFERING_MATCH",
  "OFFERING_MISMATCH",
  "OFFERING_UNKNOWN",
  "PROJECT_VALUE_CURRENCY_MISMATCH",
  "PROJECT_VALUE_MATCH",
  "PROJECT_VALUE_OUTSIDE_RANGE",
  "PROJECT_VALUE_UNKNOWN",
  "REGION_MATCH",
  "REGION_MISMATCH",
  "REGION_UNKNOWN",
  "VERTICAL_MATCH",
  "VERTICAL_MISMATCH",
] as const;
export type CompanyFitReasonCodeV1 = (typeof COMPANY_FIT_REASON_CODES_V1)[number];
type CompanyFitExclusionReasonV1 = "EVENT_IGNORED" | "EXCLUDED_TERM_MATCH";

export interface CandidateProjectValueV1 {
  readonly amount: number;
  readonly currency: string;
}

export interface CompanyFitCandidateV1 {
  readonly eventType?: string | null;
  readonly projectValue?: CandidateProjectValueV1 | null;
  readonly regions?: readonly string[];
  readonly terms?: readonly string[];
  readonly vertical: Signal["vertical"];
}

export interface CompanyFitCriterionResultV1 {
  readonly contribution: number;
  readonly criterion: CompanyFitCriterionV1;
  readonly matchedValues: readonly string[];
  readonly reasonCode: CompanyFitReasonCodeV1;
  readonly score: number;
  readonly weight: number;
}

export interface CompanyFitResultV1 {
  readonly criteria: readonly CompanyFitCriterionResultV1[];
  readonly excluded: boolean;
  readonly exclusionReasonCode: CompanyFitExclusionReasonV1 | null;
  readonly score: Score;
  readonly version: Version;
}

export interface OpportunityScoreInputV1 {
  readonly actionability: number;
  readonly businessImpact: number;
  readonly companyFit: number;
  readonly confidence: number;
  readonly urgency: number;
}

export interface OpportunityScoreContributionsV1 {
  readonly actionability: number;
  readonly businessImpact: number;
  readonly companyFit: number;
  readonly confidence: number;
  readonly urgency: number;
}

export interface OpportunityScoreResultV1 {
  readonly band: OpportunityBand;
  readonly contributions: OpportunityScoreContributionsV1;
  readonly explanation: string;
  readonly scoreBreakdown: ScoreBreakdown;
  readonly scoringVersion: Version;
  readonly totalScore: Score;
}

export interface ScoreAnalyzedSignalInputV1 {
  readonly analysis: SuccessfulAnalysis;
  readonly companyFitContext?: Omit<CompanyFitCandidateV1, "eventType" | "vertical">;
  readonly profile: UserProfile;
  readonly signal: Signal;
}

export interface ScoredAnalyzedSignalResultV1 extends OpportunityScoreResultV1 {
  readonly companyFit: CompanyFitResultV1;
  readonly status: "SCORED";
}

export interface ExcludedAnalyzedSignalResultV1 {
  readonly companyFit: CompanyFitResultV1;
  readonly explanation: string;
  readonly scoringVersion: Version;
  readonly status: "EXCLUDED";
}

export type ScoreAnalyzedSignalResultV1 =
  ExcludedAnalyzedSignalResultV1 | ScoredAnalyzedSignalResultV1;

export interface CreateRecommendationFromScoreInputV1 extends Omit<
  CreateRecommendationInput,
  "band" | "explanation" | "scoreBreakdown" | "scoringVersion" | "totalScore"
> {
  readonly score: ScoredAnalyzedSignalResultV1;
}

const round = (value: number, decimalPlaces = 2): number => {
  const factor = 10 ** decimalPlaces;
  return Math.round((value + Number.EPSILON) * factor) / factor;
};

const normalize = (value: string): string =>
  value
    .toLocaleLowerCase("ru")
    .replace(/ё/gu, "е")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

const normalizedValues = (values: readonly string[]): readonly string[] =>
  Object.freeze([...new Set(values.map(normalize).filter((value) => value.length > 0))]);

const matchesTerm = (left: string, right: string): boolean => {
  if (left.length < 3 || right.length < 3) {
    return left === right;
  }
  if (left.includes(right) || right.includes(left)) {
    return true;
  }
  const leftTokens = left.split(" ");
  const rightTokens = right.split(" ");
  return rightTokens.every((rightToken) =>
    leftTokens.some((leftToken) => {
      const prefixLength = Math.min(5, leftToken.length, rightToken.length);
      return (
        prefixLength >= 3 && leftToken.slice(0, prefixLength) === rightToken.slice(0, prefixLength)
      );
    }),
  );
};

const intersectingValues = (
  candidateValues: readonly string[],
  profileValues: readonly string[],
): readonly string[] => {
  const candidates = normalizedValues(candidateValues);
  const profile = normalizedValues(profileValues);
  return Object.freeze(
    candidates.filter((candidate) => profile.some((value) => matchesTerm(candidate, value))),
  );
};

const criterion = (
  name: CompanyFitCriterionV1,
  weight: number,
  factorScore: number,
  reasonCode: CompanyFitReasonCodeV1,
  matchedValues: readonly string[] = [],
): CompanyFitCriterionResultV1 =>
  Object.freeze({
    contribution: round(weight * factorScore),
    criterion: name,
    matchedValues: Object.freeze([...matchedValues]),
    reasonCode,
    score: factorScore,
    weight,
  });

const verticalCriterion = (
  profile: UserProfile,
  candidate: CompanyFitCandidateV1,
): CompanyFitCriterionResultV1 => {
  const matches = candidate.vertical !== "OTHER" && profile.verticals.includes(candidate.vertical);
  return criterion(
    "VERTICAL",
    COMPANY_FIT_WEIGHTS_V1.vertical,
    matches ? 100 : 0,
    matches ? "VERTICAL_MATCH" : "VERTICAL_MISMATCH",
    matches ? [candidate.vertical] : [],
  );
};

const regionCriterion = (
  profile: UserProfile,
  candidate: CompanyFitCandidateV1,
): CompanyFitCriterionResultV1 => {
  const regions = candidate.regions ?? [];
  if (regions.length === 0) {
    return criterion("REGION", COMPANY_FIT_WEIGHTS_V1.region, 50, "REGION_UNKNOWN");
  }
  const matches = intersectingValues(regions, profile.regions);
  return criterion(
    "REGION",
    COMPANY_FIT_WEIGHTS_V1.region,
    matches.length > 0 ? 100 : 0,
    matches.length > 0 ? "REGION_MATCH" : "REGION_MISMATCH",
    matches,
  );
};

const eventTypeCriterion = (
  profile: UserProfile,
  candidate: CompanyFitCandidateV1,
): CompanyFitCriterionResultV1 => {
  const eventType = normalize(candidate.eventType ?? "");
  if (eventType.length === 0 || profile.interestedEventTypes.length === 0) {
    return criterion("EVENT_TYPE", COMPANY_FIT_WEIGHTS_V1.eventType, 50, "EVENT_UNKNOWN");
  }
  const interested = normalizedValues(profile.interestedEventTypes);
  const matches = interested.includes(eventType);
  return criterion(
    "EVENT_TYPE",
    COMPANY_FIT_WEIGHTS_V1.eventType,
    matches ? 100 : 25,
    matches ? "EVENT_MATCH" : "EVENT_MISMATCH",
    matches ? [eventType] : [],
  );
};

const offeringCriterion = (
  profile: UserProfile,
  candidate: CompanyFitCandidateV1,
): CompanyFitCriterionResultV1 => {
  const terms = candidate.terms ?? [];
  if (terms.length === 0) {
    return criterion("OFFERING", COMPANY_FIT_WEIGHTS_V1.offering, 50, "OFFERING_UNKNOWN");
  }
  const matches = intersectingValues(terms, [
    ...profile.servicesAndProducts,
    ...profile.keywords,
    ...profile.targetClients,
  ]);
  return criterion(
    "OFFERING",
    COMPANY_FIT_WEIGHTS_V1.offering,
    matches.length > 0 ? 100 : 25,
    matches.length > 0 ? "OFFERING_MATCH" : "OFFERING_MISMATCH",
    matches,
  );
};

const projectValueCriterion = (
  profile: UserProfile,
  candidate: CompanyFitCandidateV1,
): CompanyFitCriterionResultV1 => {
  const value = candidate.projectValue ?? null;
  const range = profile.projectValueRange;
  if (value === null) {
    return criterion(
      "PROJECT_VALUE",
      COMPANY_FIT_WEIGHTS_V1.projectValue,
      50,
      "PROJECT_VALUE_UNKNOWN",
    );
  }
  assertInvariant(
    Number.isFinite(value.amount) && value.amount >= 0,
    "INVALID_CANDIDATE_PROJECT_VALUE",
    "Candidate project value must be finite and non-negative",
  );
  const currency = value.currency.trim().toUpperCase();
  assertInvariant(
    /^[A-Z]{3}$/.test(currency),
    "INVALID_CANDIDATE_PROJECT_CURRENCY",
    "Candidate project currency must be an ISO 4217 code",
  );
  if (range === null) {
    return criterion(
      "PROJECT_VALUE",
      COMPANY_FIT_WEIGHTS_V1.projectValue,
      50,
      "PROJECT_VALUE_UNKNOWN",
    );
  }
  if (currency !== range.currency) {
    return criterion(
      "PROJECT_VALUE",
      COMPANY_FIT_WEIGHTS_V1.projectValue,
      0,
      "PROJECT_VALUE_CURRENCY_MISMATCH",
    );
  }
  const withinMinimum = range.minimum === null || value.amount >= range.minimum;
  const withinMaximum = range.maximum === null || value.amount <= range.maximum;
  const matches = withinMinimum && withinMaximum;
  return criterion(
    "PROJECT_VALUE",
    COMPANY_FIT_WEIGHTS_V1.projectValue,
    matches ? 100 : 0,
    matches ? "PROJECT_VALUE_MATCH" : "PROJECT_VALUE_OUTSIDE_RANGE",
    matches ? [`${String(value.amount)} ${currency}`] : [],
  );
};

const excludedReason = (
  profile: UserProfile,
  candidate: CompanyFitCandidateV1,
): CompanyFitExclusionReasonV1 | null => {
  const eventType = normalize(candidate.eventType ?? "");
  if (eventType.length > 0 && normalizedValues(profile.ignoredEventTypes).includes(eventType)) {
    return "EVENT_IGNORED";
  }
  const excludedMatches = intersectingValues(candidate.terms ?? [], profile.excludedKeywords);
  return excludedMatches.length > 0 ? "EXCLUDED_TERM_MATCH" : null;
};

export const calculateCompanyFitV1 = (
  profile: UserProfile,
  candidate: CompanyFitCandidateV1,
): CompanyFitResultV1 => {
  const criteria = Object.freeze([
    verticalCriterion(profile, candidate),
    regionCriterion(profile, candidate),
    eventTypeCriterion(profile, candidate),
    offeringCriterion(profile, candidate),
    projectValueCriterion(profile, candidate),
  ]);
  const exclusion = excludedReason(profile, candidate);
  const calculated =
    exclusion === null ? criteria.reduce((total, item) => total + item.contribution, 0) : 0;
  const fitScore = score(round(calculated), "companyFit");

  if (exclusion === null) {
    return Object.freeze({
      criteria,
      excluded: false,
      exclusionReasonCode: null,
      score: fitScore,
      version: version(SCORING_VERSION_V1, "scoringVersion"),
    });
  }
  return Object.freeze({
    criteria,
    excluded: true,
    exclusionReasonCode: exclusion,
    score: fitScore,
    version: version(SCORING_VERSION_V1, "scoringVersion"),
  });
};

export const opportunityBandV1 = (totalScore: number): OpportunityBand => {
  const validated = score(totalScore, "totalScore");
  if (validated >= OPPORTUNITY_BAND_THRESHOLDS_V1.critical) {
    return "CRITICAL";
  }
  if (validated >= OPPORTUNITY_BAND_THRESHOLDS_V1.high) {
    return "HIGH";
  }
  if (validated >= OPPORTUNITY_BAND_THRESHOLDS_V1.medium) {
    return "MEDIUM";
  }
  return validated >= OPPORTUNITY_BAND_THRESHOLDS_V1.low ? "LOW" : "IGNORE";
};

export const confidenceFactorFromProbabilityV1 = (value: number): Score =>
  score(round(probability(value, "confidence") * 100), "confidence");

export const scoreOpportunityV1 = (input: OpportunityScoreInputV1): OpportunityScoreResultV1 => {
  const scoreBreakdown = createScoreBreakdown(input);
  const contributions = Object.freeze({
    actionability: round(
      scoreBreakdown.actionability * OPPORTUNITY_SCORE_WEIGHTS_V1.actionability,
      4,
    ),
    businessImpact: round(
      scoreBreakdown.businessImpact * OPPORTUNITY_SCORE_WEIGHTS_V1.businessImpact,
      4,
    ),
    companyFit: round(scoreBreakdown.companyFit * OPPORTUNITY_SCORE_WEIGHTS_V1.companyFit, 4),
    confidence: round(scoreBreakdown.confidence * OPPORTUNITY_SCORE_WEIGHTS_V1.confidence, 4),
    urgency: round(scoreBreakdown.urgency * OPPORTUNITY_SCORE_WEIGHTS_V1.urgency, 4),
  });
  const totalScore = score(
    round(Object.values(contributions).reduce((total, value) => total + value, 0)),
    "totalScore",
  );
  const band = opportunityBandV1(totalScore);
  const explanation = [
    `Opportunity Score ${totalScore.toFixed(2)} (${band})`,
    `businessImpact ${scoreBreakdown.businessImpact.toFixed(2)}×35%=${contributions.businessImpact.toFixed(2)}`,
    `companyFit ${scoreBreakdown.companyFit.toFixed(2)}×25%=${contributions.companyFit.toFixed(2)}`,
    `urgency ${scoreBreakdown.urgency.toFixed(2)}×20%=${contributions.urgency.toFixed(2)}`,
    `confidence ${scoreBreakdown.confidence.toFixed(2)}×10%=${contributions.confidence.toFixed(2)}`,
    `actionability ${scoreBreakdown.actionability.toFixed(2)}×10%=${contributions.actionability.toFixed(2)}`,
  ].join("; ");

  return Object.freeze({
    band,
    contributions,
    explanation,
    scoreBreakdown,
    scoringVersion: version(SCORING_VERSION_V1, "scoringVersion"),
    totalScore,
  });
};

export const scoreAnalyzedSignalForProfileV1 = (
  input: ScoreAnalyzedSignalInputV1,
): ScoreAnalyzedSignalResultV1 => {
  assertInvariant(
    input.analysis.signalId === input.signal.id,
    "SCORING_SIGNAL_ANALYSIS_MISMATCH",
    "Analysis must belong to the scored signal",
  );
  const companyFitContext = input.companyFitContext;
  const companyFitCandidate: CompanyFitCandidateV1 = {
    eventType: input.analysis.eventType,
    terms: [...input.analysis.entities, ...(companyFitContext?.terms ?? [])],
    vertical: input.signal.vertical,
    ...(companyFitContext?.projectValue === undefined
      ? {}
      : { projectValue: companyFitContext.projectValue }),
    ...(companyFitContext?.regions === undefined ? {} : { regions: companyFitContext.regions }),
  };
  const companyFit = calculateCompanyFitV1(input.profile, companyFitCandidate);
  if (companyFit.excluded) {
    return Object.freeze({
      companyFit,
      explanation: `Opportunity excluded by company-fit rule ${companyFit.exclusionReasonCode ?? "UNKNOWN"}`,
      scoringVersion: version(SCORING_VERSION_V1, "scoringVersion"),
      status: "EXCLUDED",
    });
  }
  const opportunity = scoreOpportunityV1({
    actionability: input.analysis.actionability,
    businessImpact: input.analysis.businessImpact,
    companyFit: companyFit.score,
    confidence: confidenceFactorFromProbabilityV1(input.analysis.confidence),
    urgency: input.analysis.urgency,
  });
  const fitExplanation = companyFit.criteria
    .map(
      (item) =>
        `${item.criterion} ${item.score.toFixed(2)} (${item.reasonCode}, +${item.contribution.toFixed(2)})`,
    )
    .join(", ");
  return Object.freeze({
    ...opportunity,
    companyFit,
    explanation: `${opportunity.explanation}; companyFitCriteria: ${fitExplanation}`,
    status: "SCORED",
  });
};

export const createRecommendationFromScoreV1 = (
  input: CreateRecommendationFromScoreInputV1,
): Recommendation =>
  createRecommendation({
    analysisId: input.analysisId,
    band: input.score.band,
    correlationId: input.correlationId,
    createdAt: input.createdAt,
    explanation: input.score.explanation,
    id: input.id,
    recommendedActions: input.recommendedActions,
    scoreBreakdown: input.score.scoreBreakdown,
    scoringVersion: input.score.scoringVersion,
    signalId: input.signalId,
    sourceIds: input.sourceIds,
    totalScore: input.score.totalScore,
    userProfileId: input.userProfileId,
    userProfileRevision: input.userProfileRevision,
  });
