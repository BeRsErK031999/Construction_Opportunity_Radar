import { RECOMMENDED_ACTION_KINDS, SIGNAL_CATEGORIES_V1 } from "@radar/core";
import { z } from "zod";

export const EVAL_GOLD_SCHEMA_VERSION_V1 = "eval-gold/v1" as const;
export const EVAL_ANNOTATION_POLICY_VERSION_V1 = "eval-annotation-policy/v1" as const;

export const EVAL_SPLITS = ["CALIBRATION", "HOLDOUT"] as const;
export const EVAL_EXPECTED_ACTION_KINDS = [...RECOMMENDED_ACTION_KINDS, "IGNORE"] as const;

const boundedString = (maximum: number) =>
  z
    .string()
    .min(1)
    .max(maximum)
    .refine((value) => value === value.trim(), {
      message: "Value must be non-blank and contain no surrounding whitespace",
    });

const HttpUrlSchema = z
  .url()
  .refine(
    (value) => ["http:", "https:"].includes(new URL(value).protocol),
    "URL must use HTTP or HTTPS",
  );

export const EvalGoldFactV1Schema = z.strictObject({
  evidenceQuote: boundedString(1_000),
  id: boundedString(100),
  statement: boundedString(1_000),
});

export const EvalGoldExpectedActionV1Schema = z.strictObject({
  kind: z.enum(EVAL_EXPECTED_ACTION_KINDS),
  rationale: boundedString(1_000),
  title: boundedString(300),
});

export const EvalGoldLabelsV1Schema = z.strictObject({
  category: z.enum(SIGNAL_CATEGORIES_V1),
  eventType: boundedString(200),
  expectedAction: EvalGoldExpectedActionV1Schema,
  facts: z.array(EvalGoldFactV1Schema).min(1).max(3),
  importance: z.strictObject({
    reason: boundedString(1_000),
    score: z.number().int().min(0).max(100),
  }),
  relevant: z.boolean(),
  summary: boundedString(500),
  vertical: z.enum(["CONSTRUCTION", "HORECA"]),
});

export const EvalGoldItemV1Schema = z.strictObject({
  id: boundedString(200),
  labels: EvalGoldLabelsV1Schema,
  source: z.strictObject({
    originalUrl: HttpUrlSchema,
    publishedAt: z.iso.datetime(),
    rightsBasis: boundedString(1_000),
    sourceId: z.uuid(),
    sourceName: boundedString(300),
    text: boundedString(8_000),
    title: boundedString(500),
  }),
  split: z.enum(EVAL_SPLITS),
});

const unique = (values: readonly string[]): boolean => new Set(values).size === values.length;

export const EvalGoldDatasetV1Schema = z
  .strictObject({
    annotationPolicy: z.strictObject({
      factsRequireExactEvidenceQuote: z.literal(true),
      status: z.literal("TECHNICAL_BASELINE"),
      version: z.literal(EVAL_ANNOTATION_POLICY_VERSION_V1),
    }),
    createdAt: z.iso.datetime(),
    datasetId: boundedString(200),
    items: z.array(EvalGoldItemV1Schema).length(200),
    language: z.literal("ru"),
    provenance: z.strictObject({
      contentOrigin: z.literal("PROJECT_AUTHORED_SYNTHETIC"),
      operationalSource: z.literal(false),
      rightsBasis: boundedString(1_000),
    }),
    schemaVersion: z.literal(EVAL_GOLD_SCHEMA_VERSION_V1),
  })
  .superRefine((dataset, context) => {
    const itemIds = dataset.items.map(({ id }) => id);
    if (!unique(itemIds)) {
      context.addIssue({
        code: "custom",
        message: "Eval item identifiers must be unique",
        path: ["items"],
      });
    }
    const originalUrls = dataset.items.map(({ source }) => source.originalUrl);
    if (!unique(originalUrls)) {
      context.addIssue({
        code: "custom",
        message: "Eval original URLs must be unique",
        path: ["items"],
      });
    }
    const normalizedTexts = dataset.items.map(({ source }) =>
      source.text.replace(/\s+/gu, " ").trim().toLocaleLowerCase("ru"),
    );
    if (!unique(normalizedTexts)) {
      context.addIssue({
        code: "custom",
        message: "Eval source texts must be unique",
        path: ["items"],
      });
    }

    for (const [index, item] of dataset.items.entries()) {
      const labelsPath: (number | string)[] = ["items", index, "labels"];
      const factIds = item.labels.facts.map(({ id }) => id);
      if (!unique(factIds)) {
        context.addIssue({
          code: "custom",
          message: "Fact identifiers must be unique within an item",
          path: [...labelsPath, "facts"],
        });
      }
      for (const [factIndex, fact] of item.labels.facts.entries()) {
        if (!item.source.text.includes(fact.evidenceQuote)) {
          context.addIssue({
            code: "custom",
            message: "Fact evidence quote must occur verbatim in source text",
            path: [...labelsPath, "facts", factIndex, "evidenceQuote"],
          });
        }
      }

      const expectedIgnore = item.labels.expectedAction.kind === "IGNORE";
      if (item.labels.relevant === expectedIgnore) {
        context.addIssue({
          code: "custom",
          message: "Relevant items require an actionable kind; irrelevant items require IGNORE",
          path: [...labelsPath, "expectedAction", "kind"],
        });
      }
      if (item.labels.relevant && item.labels.importance.score < 40) {
        context.addIssue({
          code: "custom",
          message: "Relevant item importance must be at least 40",
          path: [...labelsPath, "importance", "score"],
        });
      }
      if (!item.labels.relevant && item.labels.importance.score >= 40) {
        context.addIssue({
          code: "custom",
          message: "Irrelevant item importance must stay below 40",
          path: [...labelsPath, "importance", "score"],
        });
      }
      if (!item.labels.relevant) {
        if (item.labels.category !== "OTHER" || item.labels.eventType !== "IRRELEVANT_NOTICE") {
          context.addIssue({
            code: "custom",
            message: "Irrelevant items require OTHER / IRRELEVANT_NOTICE labels",
            path: labelsPath,
          });
        }
      } else if (
        (item.labels.vertical === "CONSTRUCTION" &&
          !item.labels.category.startsWith("CONSTRUCTION_")) ||
        (item.labels.vertical === "HORECA" && !item.labels.category.startsWith("HORECA_"))
      ) {
        context.addIssue({
          code: "custom",
          message: "Relevant category must match the annotated vertical",
          path: [...labelsPath, "category"],
        });
      }
    }

    for (const vertical of ["CONSTRUCTION", "HORECA"] as const) {
      const verticalItems = dataset.items.filter((item) => item.labels.vertical === vertical);
      if (verticalItems.length !== 100) {
        context.addIssue({
          code: "custom",
          message: `${vertical} must contain exactly 100 items`,
          path: ["items"],
        });
      }
      if (verticalItems.filter(({ labels }) => labels.relevant).length !== 80) {
        context.addIssue({
          code: "custom",
          message: `${vertical} must contain exactly 80 relevant items`,
          path: ["items"],
        });
      }
      if (verticalItems.filter(({ split }) => split === "CALIBRATION").length !== 40) {
        context.addIssue({
          code: "custom",
          message: `${vertical} must contain exactly 40 calibration items`,
          path: ["items"],
        });
      }
    }
  });

export type EvalGoldDatasetV1 = z.infer<typeof EvalGoldDatasetV1Schema>;
export type EvalGoldItemV1 = z.infer<typeof EvalGoldItemV1Schema>;
