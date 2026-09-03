import { type SuccessfulAnalysis } from "../analysis/analysis.js";
import {
  createRecommendation,
  type CreateRecommendationInput,
  type OpportunityBand,
  type Recommendation,
} from "../recommendation/recommendation.js";
import { assertInvariant } from "../shared/invariant.js";
import { score, version, type Score, type Version } from "../shared/primitives.js";
import { type Signal } from "../signal/signal.js";
import { type Source } from "../source/source.js";
import { type UserProfile } from "../user/user-profile.js";
import {
  calculateCompanyFitV1,
  confidenceFactorFromProbabilityV1,
  opportunityBandV1,
  scoreOpportunityV1,
  type CompanyFitCandidateV1,
  type CompanyFitResultV1,
  type OpportunityScoreContributionsV1,
} from "./scoring-v1.js";

export const SCORING_VERSION_V2 = "opportunity-score-v2";

export const CONFIDENCE_GUARDRAIL_V2 = Object.freeze({
  criticalMinimum: 80,
  highMaximumScore: 84,
  highMinimum: 60,
  lowMaximumScore: 54,
  mediumMaximumScore: 69,
  mediumMinimum: 40,
});

export interface ConfidenceGuardrailResultV2 {
  readonly analysisConfidence: Score;
  readonly applied: boolean;
  readonly effectiveConfidence: Score;
  readonly evidenceReliability: Score;
  readonly maximumBand: OpportunityBand;
  readonly maximumScore: Score;
  readonly rawTotalScore: Score;
}

export interface OpportunityScoreInputV2 {
  readonly actionability: number;
  readonly analysisConfidence: number;
  readonly businessImpact: number;
  readonly companyFit: number;
  readonly evidenceReliability: number;
  readonly urgency: number;
}

export interface OpportunityScoreResultV2 {
  readonly band: OpportunityBand;
  readonly confidenceGuardrail: ConfidenceGuardrailResultV2;
  readonly contributions: OpportunityScoreContributionsV1;
  readonly explanation: string;
  readonly scoreBreakdown: ReturnType<typeof scoreOpportunityV1>["scoreBreakdown"];
  readonly scoringVersion: Version;
  readonly totalScore: Score;
}

export interface ScoreAnalyzedSignalInputV2 {
  readonly analysis: SuccessfulAnalysis;
  readonly companyFitContext?: Omit<CompanyFitCandidateV1, "eventType" | "vertical">;
  readonly profile: UserProfile;
  readonly signal: Signal;
  readonly sources: readonly Source[];
}

export interface ScoredAnalyzedSignalResultV2 extends OpportunityScoreResultV2 {
  readonly companyFit: CompanyFitResultV1;
  readonly status: "SCORED";
}

export interface ExcludedAnalyzedSignalResultV2 {
  readonly companyFit: CompanyFitResultV1;
  readonly explanation: string;
  readonly scoringVersion: Version;
  readonly status: "EXCLUDED";
}

export type ScoreAnalyzedSignalResultV2 =
  ExcludedAnalyzedSignalResultV2 | ScoredAnalyzedSignalResultV2;

export interface CreateRecommendationFromScoreInputV2 extends Omit<
  CreateRecommendationInput,
  "band" | "explanation" | "scoreBreakdown" | "scoringVersion" | "totalScore"
> {
  readonly score: ScoredAnalyzedSignalResultV2;
}

const round = (value: number, decimalPlaces = 2): number => {
  const factor = 10 ** decimalPlaces;
  return Math.round((value + Number.EPSILON) * factor) / factor;
};

const maximumPriority = (
  effectiveConfidence: number,
): { readonly band: OpportunityBand; readonly score: number } => {
  if (effectiveConfidence < CONFIDENCE_GUARDRAIL_V2.mediumMinimum) {
    return { band: "LOW", score: CONFIDENCE_GUARDRAIL_V2.lowMaximumScore };
  }
  if (effectiveConfidence < CONFIDENCE_GUARDRAIL_V2.highMinimum) {
    return { band: "MEDIUM", score: CONFIDENCE_GUARDRAIL_V2.mediumMaximumScore };
  }
  if (effectiveConfidence < CONFIDENCE_GUARDRAIL_V2.criticalMinimum) {
    return { band: "HIGH", score: CONFIDENCE_GUARDRAIL_V2.highMaximumScore };
  }
  return { band: "CRITICAL", score: 100 };
};

export const supportingEvidenceReliabilityV2 = (
  analysis: SuccessfulAnalysis,
  sources: readonly Source[],
): Score => {
  const reliabilityBySourceId = new Map<string, Score>();
  for (const source of sources) {
    const current = reliabilityBySourceId.get(source.id);
    assertInvariant(
      current === undefined || current === source.reliabilityScore,
      "CONFLICTING_SCORING_SOURCE_RELIABILITY",
      "A scoring source must have one reliability score",
    );
    reliabilityBySourceId.set(source.id, source.reliabilityScore);
  }
  const factReliabilities = analysis.facts.map((fact) => {
    const supportingScores = fact.sourceIds.map((sourceId) => {
      const reliability = reliabilityBySourceId.get(sourceId);
      assertInvariant(
        reliability !== undefined,
        "MISSING_SCORING_SOURCE_RELIABILITY",
        "Every fact source must have a reliability score",
      );
      return reliability;
    });
    return Math.max(...supportingScores);
  });
  assertInvariant(
    factReliabilities.length > 0,
    "MISSING_SCORING_FACT_RELIABILITY",
    "A successful analysis must have fact-backed source reliability",
  );
  return score(Math.min(...factReliabilities), "evidenceReliability");
};

export const scoreOpportunityV2 = (input: OpportunityScoreInputV2): OpportunityScoreResultV2 => {
  const analysisConfidence = score(input.analysisConfidence, "analysisConfidence");
  const evidenceReliability = score(input.evidenceReliability, "evidenceReliability");
  const effectiveConfidence = score(
    Math.min(analysisConfidence, evidenceReliability),
    "effectiveConfidence",
  );
  const raw = scoreOpportunityV1({
    actionability: input.actionability,
    businessImpact: input.businessImpact,
    companyFit: input.companyFit,
    confidence: effectiveConfidence,
    urgency: input.urgency,
  });
  const maximum = maximumPriority(effectiveConfidence);
  const totalScore = score(round(Math.min(raw.totalScore, maximum.score)), "totalScore");
  const band = opportunityBandV1(totalScore);
  const applied = totalScore < raw.totalScore;
  const guardrail = Object.freeze({
    analysisConfidence,
    applied,
    effectiveConfidence,
    evidenceReliability,
    maximumBand: maximum.band,
    maximumScore: score(maximum.score, "maximumScore"),
    rawTotalScore: raw.totalScore,
  });
  const explanation = [
    `Opportunity Score ${totalScore.toFixed(2)} (${band})`,
    `rawWeightedScore ${raw.totalScore.toFixed(2)}`,
    `businessImpact ${raw.scoreBreakdown.businessImpact.toFixed(2)}×35%=${raw.contributions.businessImpact.toFixed(2)}`,
    `companyFit ${raw.scoreBreakdown.companyFit.toFixed(2)}×25%=${raw.contributions.companyFit.toFixed(2)}`,
    `urgency ${raw.scoreBreakdown.urgency.toFixed(2)}×20%=${raw.contributions.urgency.toFixed(2)}`,
    `effectiveConfidence min(analysisConfidence ${analysisConfidence.toFixed(2)}, evidenceReliability ${evidenceReliability.toFixed(2)})=${effectiveConfidence.toFixed(2)}×10%=${raw.contributions.confidence.toFixed(2)}`,
    `actionability ${raw.scoreBreakdown.actionability.toFixed(2)}×10%=${raw.contributions.actionability.toFixed(2)}`,
    applied
      ? `confidenceGuardrail capped priority at ${maximum.band}/${maximum.score.toFixed(2)}`
      : "confidenceGuardrail not applied",
  ].join("; ");

  return Object.freeze({
    band,
    confidenceGuardrail: guardrail,
    contributions: raw.contributions,
    explanation,
    scoreBreakdown: raw.scoreBreakdown,
    scoringVersion: version(SCORING_VERSION_V2, "scoringVersion"),
    totalScore,
  });
};

export const scoreAnalyzedSignalForProfileV2 = (
  input: ScoreAnalyzedSignalInputV2,
): ScoreAnalyzedSignalResultV2 => {
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
      scoringVersion: version(SCORING_VERSION_V2, "scoringVersion"),
      status: "EXCLUDED",
    });
  }
  const opportunity = scoreOpportunityV2({
    actionability: input.analysis.actionability,
    analysisConfidence: confidenceFactorFromProbabilityV1(input.analysis.confidence),
    businessImpact: input.analysis.businessImpact,
    companyFit: companyFit.score,
    evidenceReliability: supportingEvidenceReliabilityV2(input.analysis, input.sources),
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

export const createRecommendationFromScoreV2 = (
  input: CreateRecommendationFromScoreInputV2,
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
