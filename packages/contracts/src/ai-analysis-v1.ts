import { RECOMMENDED_ACTION_KINDS } from "@radar/core";
import { z } from "zod";

export const AI_ANALYSIS_SCHEMA_VERSION_V1 = "ai-analysis/v1" as const;

const boundedString = (maxLength: number) =>
  z
    .string()
    .min(1)
    .max(maxLength)
    .refine((value) => value.trim().length > 0 && value === value.trim(), {
      message: "Value must be non-blank and contain no surrounding whitespace",
    });

const IdentifierSchema = boundedString(200);
const VersionSchema = boundedString(100);
const BoundedTextSchema = boundedString(4_000);
const ScoreSchema = z.number().min(0).max(100);

const AnalysisFactV1Schema = z.strictObject({
  id: IdentifierSchema,
  sourceIds: z.array(IdentifierSchema).min(1).max(50),
  statement: BoundedTextSchema,
});

const AnalysisInferenceV1Schema = z.strictObject({
  basisFactIds: z.array(IdentifierSchema).min(1).max(50),
  id: IdentifierSchema,
  statement: BoundedTextSchema,
});

const RecommendedActionV1Schema = z.strictObject({
  kind: z.enum(RECOMMENDED_ACTION_KINDS),
  priority: z.number().int().min(1).max(5),
  rationale: boundedString(2_000),
  title: boundedString(300),
});

const unique = (values: readonly string[]): boolean => new Set(values).size === values.length;

export const AIAnalysisResponseV1Schema = z
  .strictObject({
    actionability: ScoreSchema,
    analysisId: IdentifierSchema,
    analysisVersion: VersionSchema,
    businessImpact: ScoreSchema,
    candidateActions: z.array(RecommendedActionV1Schema).min(2).max(5),
    confidence: z.number().min(0).max(1),
    correlationId: IdentifierSchema,
    createdAt: z.iso.datetime(),
    deadline: z.iso.datetime().nullable(),
    entities: z.array(boundedString(500)).max(100),
    eventType: boundedString(200),
    facts: z.array(AnalysisFactV1Schema).min(1).max(50),
    headline: boundedString(500),
    inferences: z.array(AnalysisInferenceV1Schema).max(50),
    model: boundedString(200),
    promptVersion: VersionSchema,
    provider: boundedString(100),
    risks: z.array(boundedString(2_000)).max(20),
    schemaVersion: z.literal(AI_ANALYSIS_SCHEMA_VERSION_V1),
    signalId: IdentifierSchema,
    sourceIds: z.array(IdentifierSchema).min(1).max(50),
    status: z.literal("SUCCEEDED"),
    summary: BoundedTextSchema,
    urgency: ScoreSchema,
    whyImportant: BoundedTextSchema,
  })
  .superRefine((analysis, context) => {
    const factIds = analysis.facts.map(({ id }) => id);
    if (!unique(factIds)) {
      context.addIssue({
        code: "custom",
        message: "Fact identifiers must be unique",
        path: ["facts"],
      });
    }

    const factIdSet = new Set(factIds);
    for (const [index, inference] of analysis.inferences.entries()) {
      if (!unique(inference.basisFactIds)) {
        context.addIssue({
          code: "custom",
          message: "Inference basis fact identifiers must be unique",
          path: ["inferences", index, "basisFactIds"],
        });
      }
      if (!inference.basisFactIds.every((basisFactId) => factIdSet.has(basisFactId))) {
        context.addIssue({
          code: "custom",
          message: "Inference must reference facts from the same analysis",
          path: ["inferences", index, "basisFactIds"],
        });
      }
    }

    const inferenceIds = analysis.inferences.map(({ id }) => id);
    if (!unique(inferenceIds)) {
      context.addIssue({
        code: "custom",
        message: "Inference identifiers must be unique",
        path: ["inferences"],
      });
    }

    for (const [index, fact] of analysis.facts.entries()) {
      if (!unique(fact.sourceIds)) {
        context.addIssue({
          code: "custom",
          message: "Fact source identifiers must be unique",
          path: ["facts", index, "sourceIds"],
        });
      }
    }

    if (!unique(analysis.sourceIds)) {
      context.addIssue({
        code: "custom",
        message: "Analysis source identifiers must be unique",
        path: ["sourceIds"],
      });
    }
    const factSourceIds = new Set(analysis.facts.flatMap(({ sourceIds }) => sourceIds));
    const declaredSourceIds = new Set(analysis.sourceIds);
    if (
      factSourceIds.size !== declaredSourceIds.size ||
      ![...factSourceIds].every((sourceId) => declaredSourceIds.has(sourceId))
    ) {
      context.addIssue({
        code: "custom",
        message: "Analysis source identifiers must exactly match fact provenance",
        path: ["sourceIds"],
      });
    }

    if (!unique(analysis.entities.map((value) => value.toLocaleLowerCase("ru")))) {
      context.addIssue({
        code: "custom",
        message: "Entities must be unique without regard to case",
        path: ["entities"],
      });
    }
    if (!unique(analysis.risks.map((value) => value.toLocaleLowerCase("ru")))) {
      context.addIssue({
        code: "custom",
        message: "Risks must be unique without regard to case",
        path: ["risks"],
      });
    }
  });

export type AIAnalysisResponseV1 = z.infer<typeof AIAnalysisResponseV1Schema>;
