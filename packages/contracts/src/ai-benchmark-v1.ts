import { z } from "zod";

export const AI_BENCHMARK_REPORT_SCHEMA_VERSION_V1 = "ai-benchmark-report/v1" as const;

const boundedString = (maximum: number) =>
  z
    .string()
    .min(1)
    .max(maximum)
    .refine((value) => value === value.trim(), {
      message: "Value must be non-blank and contain no surrounding whitespace",
    });

const CountSchema = z.number().int().min(0);
const DurationSchema = z.number().min(0);
const RateSchema = z.number().min(0).max(1).nullable();
const Sha256Schema = z.string().regex(/^[a-f\d]{64}$/u);

const RelevanceMetricsSchema = z.strictObject({
  accuracy: RateSchema,
  evaluated: CountSchema,
  f1: RateSchema,
  falseNegative: CountSchema,
  falsePositive: CountSchema,
  precision: RateSchema,
  recall: RateSchema,
  trueNegative: CountSchema,
  truePositive: CountSchema,
  unscored: CountSchema,
});

export const AIBenchmarkFailureV1Schema = z.strictObject({
  code: boundedString(100),
  itemId: boundedString(200),
  kind: z.enum(["FAILED_ANALYSIS", "INVALID_ANALYSIS", "THROWN"]),
  retryable: z.boolean(),
});

export const AIBenchmarkReportV1Schema = z
  .strictObject({
    classification: z.strictObject({
      eventType: z.strictObject({
        accuracy: RateSchema,
        correct: CountSchema,
        evaluated: CountSchema,
        unscored: CountSchema,
      }),
      relevance: RelevanceMetricsSchema,
    }),
    completedAt: z.iso.datetime(),
    durationMs: DurationSchema,
    factuality: z.strictObject({
      evaluatedExpectedFacts: CountSchema,
      expectedFactRecall: RateSchema,
      expectedFacts: CountSchema,
      generatedFactSupportRate: RateSchema,
      generatedFacts: CountSchema,
      hallucinationCount: CountSchema,
      matchedExpectedFacts: CountSchema,
      supportedGeneratedFacts: CountSchema,
      unsupportedGeneratedFacts: CountSchema,
    }),
    failures: z.array(AIBenchmarkFailureV1Schema),
    health: z.strictObject({
      failureCode: boundedString(100).nullable(),
      retryable: z.boolean(),
      status: z.enum(["HEALTHY", "UNHEALTHY"]),
    }),
    latencyMs: z.strictObject({
      maximum: DurationSchema.nullable(),
      mean: DurationSchema.nullable(),
      minimum: DurationSchema.nullable(),
      p50: DurationSchema.nullable(),
      p95: DurationSchema.nullable(),
      samples: CountSchema,
    }),
    run: z.strictObject({
      analysisVersion: boundedString(100),
      datasetId: boundedString(200),
      datasetSchemaVersion: boundedString(100),
      datasetSha256: Sha256Schema,
      items: z.number().int().positive(),
      model: boundedString(200),
      promptVersion: boundedString(100),
      provider: boundedString(100),
      selectedSplit: z.enum(["ALL", "CALIBRATION", "HOLDOUT"]),
      structuredAnalysisSchemaVersion: boundedString(100),
    }),
    resources: z.discriminatedUnion("vramAvailability", [
      z.strictObject({
        vramAvailability: z.literal("UNAVAILABLE"),
        vramPeakMiB: z.null(),
      }),
      z.strictObject({
        vramAvailability: z.literal("MEASURED"),
        vramPeakMiB: z.number().positive(),
      }),
    ]),
    schemaVersion: z.literal(AI_BENCHMARK_REPORT_SCHEMA_VERSION_V1),
    startedAt: z.iso.datetime(),
    tokens: z.strictObject({
      availability: z.enum(["COMPLETE", "PARTIAL", "UNAVAILABLE"]),
      generationDurationMs: DurationSchema.nullable(),
      inputTokens: CountSchema.nullable(),
      outputTokens: CountSchema.nullable(),
      outputTokensPerSecond: z.number().min(0).nullable(),
      samplesWithUsage: CountSchema,
      totalTokens: CountSchema.nullable(),
    }),
    validity: z.strictObject({
      attempted: CountSchema,
      coverage: RateSchema,
      invalidResponses: CountSchema,
      providerFailures: CountSchema,
      succeeded: CountSchema,
      validRate: RateSchema,
    }),
  })
  .superRefine((report, context) => {
    const issue = (message: string, path: (number | string)[]): void => {
      context.addIssue({ code: "custom", message, path });
    };
    const expectedRate = (numerator: number, denominator: number): number | null =>
      denominator === 0 ? null : Number((numerator / denominator).toFixed(6));
    const checkRate = (
      actual: number | null,
      numerator: number,
      denominator: number,
      path: (number | string)[],
    ): void => {
      if (actual !== expectedRate(numerator, denominator)) {
        issue("Rate does not match its counts", path);
      }
    };
    const { attempted, invalidResponses, providerFailures, succeeded } = report.validity;
    if (attempted !== report.run.items) {
      issue("Attempted count must equal selected run items", ["validity", "attempted"]);
    }
    if (succeeded + report.failures.length !== attempted) {
      issue("Every attempted item must either succeed or have one failure", ["failures"]);
    }
    if (invalidResponses + providerFailures !== report.failures.length) {
      issue("Failure classes must cover every failure", ["validity"]);
    }
    if (
      invalidResponses !==
      report.failures.filter(({ code }) => code === "AI_INVALID_RESPONSE").length
    ) {
      issue("Invalid response count must match failure codes", ["validity", "invalidResponses"]);
    }
    checkRate(report.validity.coverage, succeeded, attempted, ["validity", "coverage"]);
    checkRate(report.validity.validRate, succeeded, succeeded + invalidResponses, [
      "validity",
      "validRate",
    ]);
    const failureItemIds = report.failures.map(({ itemId }) => itemId);
    if (new Set(failureItemIds).size !== failureItemIds.length) {
      issue("Failure item identifiers must be unique", ["failures"]);
    }

    const eventType = report.classification.eventType;
    if (
      eventType.evaluated !== succeeded ||
      eventType.evaluated + eventType.unscored !== attempted
    ) {
      issue("Event-type counts must cover successful and unscored items", [
        "classification",
        "eventType",
      ]);
    }
    if (eventType.correct > eventType.evaluated) {
      issue("Correct event types cannot exceed evaluated items", [
        "classification",
        "eventType",
        "correct",
      ]);
    }
    checkRate(eventType.accuracy, eventType.correct, eventType.evaluated, [
      "classification",
      "eventType",
      "accuracy",
    ]);

    const relevance = report.classification.relevance;
    const relevanceTotal =
      relevance.truePositive +
      relevance.trueNegative +
      relevance.falsePositive +
      relevance.falseNegative;
    if (
      relevanceTotal !== relevance.evaluated ||
      relevance.evaluated + relevance.unscored !== attempted
    ) {
      issue("Relevance confusion counts must cover evaluated and unscored items", [
        "classification",
        "relevance",
      ]);
    }
    checkRate(
      relevance.accuracy,
      relevance.truePositive + relevance.trueNegative,
      relevance.evaluated,
      ["classification", "relevance", "accuracy"],
    );
    checkRate(
      relevance.precision,
      relevance.truePositive,
      relevance.truePositive + relevance.falsePositive,
      ["classification", "relevance", "precision"],
    );
    checkRate(
      relevance.recall,
      relevance.truePositive,
      relevance.truePositive + relevance.falseNegative,
      ["classification", "relevance", "recall"],
    );
    checkRate(
      relevance.f1,
      2 * relevance.truePositive,
      2 * relevance.truePositive + relevance.falsePositive + relevance.falseNegative,
      ["classification", "relevance", "f1"],
    );

    const factuality = report.factuality;
    if (
      factuality.supportedGeneratedFacts + factuality.unsupportedGeneratedFacts !==
      factuality.generatedFacts
    ) {
      issue("Generated fact support counts must cover every generated fact", ["factuality"]);
    }
    if (factuality.hallucinationCount !== factuality.unsupportedGeneratedFacts) {
      issue("Hallucination count must equal unsupported generated facts", [
        "factuality",
        "hallucinationCount",
      ]);
    }
    if (
      factuality.matchedExpectedFacts > factuality.evaluatedExpectedFacts ||
      factuality.evaluatedExpectedFacts > factuality.expectedFacts
    ) {
      issue("Expected fact counts must be monotonic", ["factuality"]);
    }
    checkRate(
      factuality.expectedFactRecall,
      factuality.matchedExpectedFacts,
      factuality.evaluatedExpectedFacts,
      ["factuality", "expectedFactRecall"],
    );
    checkRate(
      factuality.generatedFactSupportRate,
      factuality.supportedGeneratedFacts,
      factuality.generatedFacts,
      ["factuality", "generatedFactSupportRate"],
    );

    if (report.latencyMs.samples !== attempted) {
      issue("Latency must contain one sample per attempted item", ["latencyMs", "samples"]);
    }
    if (
      report.latencyMs.minimum === null ||
      report.latencyMs.maximum === null ||
      report.latencyMs.mean === null ||
      report.latencyMs.p50 === null ||
      report.latencyMs.p95 === null
    ) {
      issue("A non-empty benchmark requires complete latency aggregates", ["latencyMs"]);
    }

    const tokens = report.tokens;
    const hasTokenTotals =
      tokens.inputTokens !== null &&
      tokens.outputTokens !== null &&
      tokens.totalTokens !== null &&
      tokens.generationDurationMs !== null;
    const hasAnyTokenMetric =
      tokens.inputTokens !== null ||
      tokens.outputTokens !== null ||
      tokens.totalTokens !== null ||
      tokens.generationDurationMs !== null ||
      tokens.outputTokensPerSecond !== null;
    if (tokens.samplesWithUsage === 0) {
      if (tokens.availability !== "UNAVAILABLE" || hasAnyTokenMetric) {
        issue("Missing token samples require unavailable null telemetry", ["tokens"]);
      }
    } else {
      if (!hasTokenTotals) {
        issue("Available token samples require aggregate telemetry", ["tokens"]);
      } else if (
        tokens.inputTokens !== null &&
        tokens.outputTokens !== null &&
        tokens.totalTokens !== null &&
        tokens.totalTokens !== tokens.inputTokens + tokens.outputTokens
      ) {
        issue("Total tokens must equal input plus output tokens", ["tokens", "totalTokens"]);
      }
      const expectedAvailability = tokens.samplesWithUsage === attempted ? "COMPLETE" : "PARTIAL";
      if (tokens.availability !== expectedAvailability) {
        issue("Token availability must match sample coverage", ["tokens", "availability"]);
      }
      if (
        tokens.generationDurationMs !== null &&
        (tokens.generationDurationMs === 0) !== (tokens.outputTokensPerSecond === null)
      ) {
        issue("Token throughput requires a positive generation duration", [
          "tokens",
          "outputTokensPerSecond",
        ]);
      }
    }
    if (tokens.samplesWithUsage > attempted) {
      issue("Token samples cannot exceed attempted items", ["tokens", "samplesWithUsage"]);
    }

    if ((report.health.status === "HEALTHY") !== (report.health.failureCode === null)) {
      issue("Healthy provider state must not contain a failure code", ["health"]);
    }
    if (report.health.status === "HEALTHY" && report.health.retryable) {
      issue("Healthy provider state cannot be retryable", ["health", "retryable"]);
    }
    if (Date.parse(report.completedAt) < Date.parse(report.startedAt)) {
      issue("Benchmark completion must not precede its start", ["completedAt"]);
    }
  });

export type AIBenchmarkFailureV1 = z.infer<typeof AIBenchmarkFailureV1Schema>;
export type AIBenchmarkReportV1 = z.infer<typeof AIBenchmarkReportV1Schema>;
