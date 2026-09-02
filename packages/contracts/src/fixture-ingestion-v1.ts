import { z } from "zod";

const FixtureVerticalSchema = z.enum(["CONSTRUCTION", "HORECA", "OTHER"]);
const FixtureRightsStatusSchema = z.enum([
  "OPEN_DATA",
  "PUBLIC_API",
  "PARTNER",
  "CONSENT",
  "REVIEW_REQUIRED",
  "BLOCKED",
]);
const HttpUrlSchema = z.url().refine(
  (value) => {
    const protocol = new URL(value).protocol;
    return protocol === "http:" || protocol === "https:";
  },
  { message: "URL must use HTTP or HTTPS" },
);

export const FixtureSourceV1Schema = z.strictObject({
  aiProcessingAllowed: z.boolean(),
  country: z.string().trim().min(1).max(100),
  id: z.uuid(),
  name: z.string().trim().min(1).max(300),
  regions: z.array(z.string().trim().min(1)).min(1),
  reliabilityScore: z.number().min(0).max(100),
  rightsBasis: z.string().trim().min(1).max(4_000).nullable(),
  rightsStatus: FixtureRightsStatusSchema,
  url: HttpUrlSchema,
  verticals: z.array(FixtureVerticalSchema).min(1),
});

export const FixtureItemLabelsV1Schema = z.strictObject({
  duplicateGroup: z.string().trim().min(1).nullable(),
  duplicateKind: z.enum(["ORIGINAL", "EXACT", "NEAR"]).nullable(),
  isAdvertisement: z.boolean(),
  vertical: FixtureVerticalSchema,
});

export const FixtureItemV1Schema = z.strictObject({
  externalId: z.string().trim().min(1).max(500).nullable(),
  fixtureId: z.string().trim().min(1).max(200),
  labels: FixtureItemLabelsV1Schema,
  originalUrl: HttpUrlSchema,
  publishedAt: z.iso.datetime().nullable(),
  rawPayload: z.json().nullable(),
  rawText: z
    .string()
    .max(1_000_000)
    .refine((value) => value.trim().length > 0, { message: "rawText must not be blank" }),
  sourceId: z.uuid(),
});

export const FixtureIngestionDatasetV1Schema = z
  .strictObject({
    createdAt: z.iso.datetime(),
    datasetId: z.string().trim().min(1).max(200),
    items: z.array(FixtureItemV1Schema).min(100).max(200),
    schemaVersion: z.literal("fixture-ingestion/v1"),
    sources: z.array(FixtureSourceV1Schema).min(1).max(50),
  })
  .superRefine((dataset, context) => {
    const sourceIds = new Set<string>();
    for (const [index, source] of dataset.sources.entries()) {
      if (sourceIds.has(source.id)) {
        context.addIssue({
          code: "custom",
          message: `Duplicate source id ${source.id}`,
          path: ["sources", index, "id"],
        });
      }
      sourceIds.add(source.id);
    }

    const externalIdentities = new Set<string>();
    const fixtureIds = new Set<string>();
    const rawEvidenceIdentities = new Set<string>();
    for (const [index, item] of dataset.items.entries()) {
      if (fixtureIds.has(item.fixtureId)) {
        context.addIssue({
          code: "custom",
          message: `Duplicate fixture id ${item.fixtureId}`,
          path: ["items", index, "fixtureId"],
        });
      }
      fixtureIds.add(item.fixtureId);

      if (item.externalId !== null) {
        const externalIdentity = JSON.stringify([item.sourceId, item.externalId]);
        if (externalIdentities.has(externalIdentity)) {
          context.addIssue({
            code: "custom",
            message: "Fixture external identity must be unique within a source",
            path: ["items", index, "externalId"],
          });
        }
        externalIdentities.add(externalIdentity);
      }

      const rawEvidenceIdentity = JSON.stringify([item.sourceId, item.rawText]);
      if (rawEvidenceIdentities.has(rawEvidenceIdentity)) {
        context.addIssue({
          code: "custom",
          message: "Fixture raw evidence must be unique within a source",
          path: ["items", index, "rawText"],
        });
      }
      rawEvidenceIdentities.add(rawEvidenceIdentity);

      const source = dataset.sources.find((candidate) => candidate.id === item.sourceId);
      if (source === undefined) {
        context.addIssue({
          code: "custom",
          message: `Unknown source id ${item.sourceId}`,
          path: ["items", index, "sourceId"],
        });
      } else if (!source.verticals.includes(item.labels.vertical)) {
        context.addIssue({
          code: "custom",
          message: `Item vertical ${item.labels.vertical} is not declared by its source`,
          path: ["items", index, "labels", "vertical"],
        });
      }

      const hasDuplicateGroup = item.labels.duplicateGroup !== null;
      const hasDuplicateKind = item.labels.duplicateKind !== null;
      if (hasDuplicateGroup !== hasDuplicateKind) {
        context.addIssue({
          code: "custom",
          message: "duplicateGroup and duplicateKind must either both be set or both be null",
          path: ["items", index, "labels"],
        });
      }
    }
  });

export type FixtureIngestionDatasetV1 = z.infer<typeof FixtureIngestionDatasetV1Schema>;
export type FixtureItemV1 = z.infer<typeof FixtureItemV1Schema>;
export type FixtureSourceV1 = z.infer<typeof FixtureSourceV1Schema>;
