import { createHash } from "node:crypto";

import {
  signalId,
  type CorrelationId,
  type NormalizedItemId,
  type SignalId,
  type SourceId,
} from "../shared/identifiers.js";
import { assertInvariant } from "../shared/invariant.js";
import { version, type Version } from "../shared/primitives.js";
import { type Vertical } from "../shared/taxonomy.js";
import { type NormalizedItem } from "../normalization/normalized-item.js";
import { isAiProcessingPermitted, type Source } from "../source/source.js";

export const CLASSIFIER_VERSION_V1 = "classifier-v1";
export const SIGNAL_TAXONOMY_VERSION_V1 = "signal-taxonomy-v1";

export const SIGNAL_CATEGORIES_V1 = [
  "CONSTRUCTION_PROJECT",
  "CONSTRUCTION_TENDER",
  "HORECA_OPENING",
  "HORECA_PROCUREMENT",
  "OTHER",
] as const;
export type SignalCategoryV1 = (typeof SIGNAL_CATEGORIES_V1)[number];

export const CLASSIFICATION_OUTCOMES = ["AI_ELIGIBLE", "IRRELEVANT", "PERMISSION_DENIED"] as const;
export type ClassificationOutcome = (typeof CLASSIFICATION_OUTCOMES)[number];

export const CLASSIFICATION_REASON_CODES = [
  "ADVERTISEMENT",
  "EXPLICITLY_IRRELEVANT",
  "NO_AI_PERMITTED_EVIDENCE",
  "NO_OPPORTUNITY_CUE",
  "RELEVANT_OPPORTUNITY",
  "UNSUPPORTED_OR_AMBIGUOUS_VERTICAL",
] as const;
export type ClassificationReasonCode = (typeof CLASSIFICATION_REASON_CODES)[number];

export interface ClassificationEvidence {
  readonly normalizedItem: NormalizedItem;
  readonly source: Source;
}

export interface ClassificationCandidate {
  readonly deduplicatorVersion: string;
  readonly evidence: readonly ClassificationEvidence[];
  readonly representativeNormalizedItemId: NormalizedItemId;
}

export interface AiInputEvidence {
  readonly normalizedItemId: NormalizedItemId;
  readonly sourceId: SourceId;
}

export interface ClassificationVerticalScores {
  readonly construction: number;
  readonly horeca: number;
}

interface ClassificationDecisionBase {
  readonly aiInputEvidence: readonly AiInputEvidence[];
  readonly classifierVersion: Version;
  readonly deduplicatorVersion: Version;
  readonly matchedRuleIds: readonly string[];
  readonly reasonCode: ClassificationReasonCode;
  readonly relevanceScore: number;
  readonly representativeNormalizedItemId: NormalizedItemId;
  readonly taxonomyVersion: Version;
  readonly verticalScores: ClassificationVerticalScores;
}

export interface PermissionDeniedClassificationDecision extends ClassificationDecisionBase {
  readonly category: null;
  readonly classificationConfidence: 100;
  readonly correlationId: null;
  readonly outcome: "PERMISSION_DENIED";
  readonly selectedNormalizedItemId: null;
  readonly vertical: null;
}

interface ClassifiedClassificationDecisionBase extends ClassificationDecisionBase {
  readonly category: SignalCategoryV1;
  readonly classificationConfidence: number;
  readonly correlationId: CorrelationId;
  readonly selectedNormalizedItemId: NormalizedItemId;
  readonly vertical: Vertical;
}

export interface AiEligibleClassificationDecision extends ClassifiedClassificationDecisionBase {
  readonly outcome: "AI_ELIGIBLE";
}

export interface IrrelevantClassificationDecision extends ClassifiedClassificationDecisionBase {
  readonly outcome: "IRRELEVANT";
}

export type ClassifiedClassificationDecision =
  AiEligibleClassificationDecision | IrrelevantClassificationDecision;

export type ClassificationDecision =
  ClassifiedClassificationDecision | PermissionDeniedClassificationDecision;

interface TextRule {
  readonly id: string;
  readonly pattern: RegExp;
}

const CONSTRUCTION_RULES: readonly TextRule[] = Object.freeze([
  { id: "vertical.construction.build", pattern: /строительств\p{L}*/iu },
  { id: "vertical.construction.installation", pattern: /строительно-монтажн\p{L}*/iu },
  { id: "vertical.construction.reconstruction", pattern: /реконструкц\p{L}*/iu },
  { id: "vertical.construction.repair", pattern: /капитальн\p{L}*\s+ремонт\p{L}*/iu },
  { id: "vertical.construction.contractor", pattern: /подрядчик\p{L}*/iu },
  { id: "vertical.construction.material", pattern: /стройматериал\p{L}*/iu },
]);

const HORECA_RULES: readonly TextRule[] = Object.freeze([
  { id: "vertical.horeca.literal", pattern: /\bhoreca\b/iu },
  { id: "vertical.horeca.restaurant", pattern: /ресторан\p{L}*/iu },
  { id: "vertical.horeca.hotel", pattern: /(?:гостиниц|отел)\p{L}*/iu },
  { id: "vertical.horeca.seats", pattern: /посадочн\p{L}*\s+мест\p{L}*/iu },
  { id: "vertical.horeca.hospitality", pattern: /гостеприимств\p{L}*/iu },
]);

const OPPORTUNITY_RULES: readonly TextRule[] = Object.freeze([
  { id: "opportunity.tender", pattern: /тендер\p{L}*/iu },
  { id: "opportunity.procurement", pattern: /закуп\p{L}*/iu },
  { id: "opportunity.applications", pattern: /при[её]м\s+заявок/iu },
  { id: "opportunity.supplier-selection", pattern: /отбор\s+поставщик\p{L}*/iu },
  { id: "opportunity.contractor", pattern: /подрядчик\p{L}*/iu },
  { id: "opportunity.planned", pattern: /запланирован\p{L}*/iu },
  { id: "opportunity.opening", pattern: /(?:открыти|откро)\p{L}*/iu },
  { id: "opportunity.construction", pattern: /строительств\p{L}*/iu },
  { id: "opportunity.reconstruction", pattern: /реконструкц\p{L}*/iu },
  { id: "opportunity.budget", pattern: /бюджет\p{L}*/iu },
]);

const ADVERTISEMENT_RULES: readonly TextRule[] = Object.freeze([
  { id: "advertisement.explicit", pattern: /(?:^|[\s:])реклам\p{L}*/iu },
  { id: "advertisement.discount", pattern: /скидк\p{L}*/iu },
  { id: "advertisement.promotion", pattern: /акци\p{L}*/iu },
  {
    id: "advertisement.call-to-action",
    pattern: /(?:оставьте\s+заявку|закажите\s+консультацию)/iu,
  },
]);

const EXPLICIT_IRRELEVANCE_RULES: readonly TextRule[] = Object.freeze([
  {
    id: "irrelevance.no-commercial-opportunity",
    pattern: /(?:закуп\p{L}*|тендер\p{L}*|construction|horeca)\s+не\s+заявлен\p{L}*/iu,
  },
  { id: "irrelevance.general-notice", pattern: /информаци\p{L}*\s+общего\s+назначения/iu },
]);

const matchRules = (text: string, rules: readonly TextRule[]): readonly string[] =>
  Object.freeze(rules.filter((rule) => rule.pattern.test(text)).map((rule) => rule.id));

const observedAt = (evidence: ClassificationEvidence): string =>
  evidence.normalizedItem.publishedAt ?? evidence.normalizedItem.createdAt;

const compareEvidence = (left: ClassificationEvidence, right: ClassificationEvidence): number => {
  const timeOrder = Date.parse(observedAt(left)) - Date.parse(observedAt(right));
  return timeOrder === 0
    ? left.normalizedItem.id.localeCompare(right.normalizedItem.id, "en")
    : timeOrder;
};

const selectedEvidence = (
  permittedEvidence: readonly ClassificationEvidence[],
  representativeNormalizedItemId: NormalizedItemId,
): ClassificationEvidence => {
  const representative = permittedEvidence.find(
    (evidence) => evidence.normalizedItem.id === representativeNormalizedItemId,
  );
  const selected = representative ?? [...permittedEvidence].sort(compareEvidence)[0];
  assertInvariant(
    selected !== undefined,
    "MISSING_CLASSIFICATION_EVIDENCE",
    "Classification requires permitted evidence",
  );
  return selected;
};

const sourceRuleIds = (source: Source): readonly string[] =>
  Object.freeze(
    source.verticals.map((vertical) => `source.vertical.${vertical.toLocaleLowerCase("en")}`),
  );

const verticalScores = (
  source: Source,
  constructionRules: readonly string[],
  horecaRules: readonly string[],
): ClassificationVerticalScores =>
  Object.freeze({
    construction:
      constructionRules.length * 2 + (source.verticals.includes("CONSTRUCTION") ? 1 : 0),
    horeca: horecaRules.length * 2 + (source.verticals.includes("HORECA") ? 1 : 0),
  });

const classifiedVertical = (scores: ClassificationVerticalScores): Vertical => {
  if (scores.construction === scores.horeca) {
    return "OTHER";
  }
  return scores.construction > scores.horeca ? "CONSTRUCTION" : "HORECA";
};

const classificationConfidence = (
  vertical: Vertical,
  scores: ClassificationVerticalScores,
  source: Source,
): number => {
  if (vertical === "OTHER") {
    return scores.construction === 0 && scores.horeca === 0 && source.verticals.includes("OTHER")
      ? 95
      : 40;
  }
  const chosenScore = vertical === "CONSTRUCTION" ? scores.construction : scores.horeca;
  const otherScore = vertical === "CONSTRUCTION" ? scores.horeca : scores.construction;
  const sourceAgreement = source.verticals.includes(vertical) ? 10 : 0;
  return Math.min(100, 60 + (chosenScore - otherScore) * 5 + sourceAgreement);
};

const category = (vertical: Vertical, opportunityRuleIds: readonly string[]): SignalCategoryV1 => {
  if (vertical === "CONSTRUCTION") {
    return opportunityRuleIds.some((id) =>
      [
        "opportunity.applications",
        "opportunity.contractor",
        "opportunity.procurement",
        "opportunity.tender",
      ].includes(id),
    )
      ? "CONSTRUCTION_TENDER"
      : "CONSTRUCTION_PROJECT";
  }
  if (vertical === "HORECA") {
    return opportunityRuleIds.some((id) =>
      ["opportunity.procurement", "opportunity.supplier-selection", "opportunity.tender"].includes(
        id,
      ),
    )
      ? "HORECA_PROCUREMENT"
      : "HORECA_OPENING";
  }
  return "OTHER";
};

const relevanceScore = (
  verticalRuleCount: number,
  opportunityRuleCount: number,
  sourceAgrees: boolean,
): number =>
  Math.min(
    100,
    50 +
      Math.min(25, opportunityRuleCount * 10) +
      Math.min(15, verticalRuleCount * 5) +
      (sourceAgrees ? 10 : 0),
  );

const aiInputEvidence = (evidence: readonly ClassificationEvidence[]): readonly AiInputEvidence[] =>
  Object.freeze(
    evidence.map((item) =>
      Object.freeze({
        normalizedItemId: item.normalizedItem.id,
        sourceId: item.source.id,
      }),
    ),
  );

export const classifyCandidateV1 = (candidate: ClassificationCandidate): ClassificationDecision => {
  const deduplicatorVersion = version(candidate.deduplicatorVersion, "deduplicatorVersion");
  const classifierVersion = version(CLASSIFIER_VERSION_V1, "classifierVersion");
  const taxonomyVersion = version(SIGNAL_TAXONOMY_VERSION_V1, "taxonomyVersion");
  assertInvariant(
    candidate.evidence.length > 0,
    "EMPTY_CLASSIFICATION_CLUSTER",
    "Classification cluster must contain evidence",
  );
  assertInvariant(
    new Set(candidate.evidence.map((evidence) => evidence.normalizedItem.id)).size ===
      candidate.evidence.length,
    "DUPLICATE_CLASSIFICATION_EVIDENCE",
    "Classification evidence must contain unique normalized items",
  );
  assertInvariant(
    candidate.evidence.some(
      (evidence) => evidence.normalizedItem.id === candidate.representativeNormalizedItemId,
    ),
    "MISSING_CLASSIFICATION_REPRESENTATIVE",
    "Classification cluster must include its deduplication representative",
  );

  const permittedEvidence = candidate.evidence.filter((evidence) =>
    isAiProcessingPermitted(evidence.source),
  );
  if (permittedEvidence.length === 0) {
    return Object.freeze({
      aiInputEvidence: Object.freeze([]),
      category: null,
      classificationConfidence: 100,
      classifierVersion,
      correlationId: null,
      deduplicatorVersion,
      matchedRuleIds: Object.freeze(["permission.no-ai-permitted-evidence"]),
      outcome: "PERMISSION_DENIED",
      reasonCode: "NO_AI_PERMITTED_EVIDENCE",
      relevanceScore: 0,
      representativeNormalizedItemId: candidate.representativeNormalizedItemId,
      selectedNormalizedItemId: null,
      taxonomyVersion,
      vertical: null,
      verticalScores: Object.freeze({ construction: 0, horeca: 0 }),
    });
  }

  const selected = selectedEvidence(permittedEvidence, candidate.representativeNormalizedItemId);
  const text = [selected.normalizedItem.title, selected.normalizedItem.text]
    .filter((value): value is string => value !== null)
    .join("\n");
  const constructionRuleIds = matchRules(text, CONSTRUCTION_RULES);
  const horecaRuleIds = matchRules(text, HORECA_RULES);
  const opportunityRuleIds = matchRules(text, OPPORTUNITY_RULES);
  const advertisementRuleIds = matchRules(text, ADVERTISEMENT_RULES);
  const explicitIrrelevanceRuleIds = matchRules(text, EXPLICIT_IRRELEVANCE_RULES);
  const scores = verticalScores(selected.source, constructionRuleIds, horecaRuleIds);
  const vertical = classifiedVertical(scores);
  const confidence = classificationConfidence(vertical, scores, selected.source);
  const sourceRules = sourceRuleIds(selected.source);
  const baseRules = [...sourceRules, ...constructionRuleIds, ...horecaRuleIds];
  const explicitAdvertisement = advertisementRuleIds.includes("advertisement.explicit");
  const isAdvertisement = explicitAdvertisement || advertisementRuleIds.length >= 2;

  const classified = (
    outcome: "AI_ELIGIBLE" | "IRRELEVANT",
    reasonCode: ClassificationReasonCode,
    matchedRuleIds: readonly string[],
    score: number,
    decisionVertical: Vertical = vertical,
  ): ClassifiedClassificationDecision =>
    Object.freeze({
      aiInputEvidence:
        outcome === "AI_ELIGIBLE" ? aiInputEvidence(permittedEvidence) : Object.freeze([]),
      category: category(decisionVertical, opportunityRuleIds),
      classificationConfidence: decisionVertical === vertical ? confidence : 95,
      classifierVersion,
      correlationId: selected.normalizedItem.correlationId,
      deduplicatorVersion,
      matchedRuleIds: Object.freeze([...matchedRuleIds]),
      outcome,
      reasonCode,
      relevanceScore: score,
      representativeNormalizedItemId: candidate.representativeNormalizedItemId,
      selectedNormalizedItemId: selected.normalizedItem.id,
      taxonomyVersion,
      vertical: decisionVertical,
      verticalScores: scores,
    });

  if (isAdvertisement) {
    return classified("IRRELEVANT", "ADVERTISEMENT", [...baseRules, ...advertisementRuleIds], 0);
  }
  if (explicitIrrelevanceRuleIds.length > 0) {
    return classified(
      "IRRELEVANT",
      "EXPLICITLY_IRRELEVANT",
      [...baseRules, ...explicitIrrelevanceRuleIds],
      0,
      "OTHER",
    );
  }
  if (vertical === "OTHER") {
    return classified(
      "IRRELEVANT",
      "UNSUPPORTED_OR_AMBIGUOUS_VERTICAL",
      [...baseRules, "vertical.unsupported-or-ambiguous"],
      0,
    );
  }
  if (opportunityRuleIds.length === 0) {
    return classified(
      "IRRELEVANT",
      "NO_OPPORTUNITY_CUE",
      [...baseRules, "relevance.no-opportunity-cue"],
      0,
    );
  }

  const verticalRuleCount =
    vertical === "CONSTRUCTION" ? constructionRuleIds.length : horecaRuleIds.length;
  return classified(
    "AI_ELIGIBLE",
    "RELEVANT_OPPORTUNITY",
    [...baseRules, ...opportunityRuleIds],
    relevanceScore(
      verticalRuleCount,
      opportunityRuleIds.length,
      selected.source.verticals.includes(vertical),
    ),
  );
};

export const classificationSignalIdV1 = (decision: AiEligibleClassificationDecision): SignalId => {
  const digest = createHash("sha256")
    .update(
      JSON.stringify([
        decision.representativeNormalizedItemId,
        decision.deduplicatorVersion,
        decision.classifierVersion,
        decision.taxonomyVersion,
      ]),
      "utf8",
    )
    .digest();
  digest[6] = ((digest[6] ?? 0) & 0x0f) | 0x80;
  digest[8] = ((digest[8] ?? 0) & 0x3f) | 0x80;
  const hex = digest.toString("hex", 0, 16);
  return signalId(
    `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`,
  );
};
