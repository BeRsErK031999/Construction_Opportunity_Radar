import { z } from "zod";

const emptyStringToUndefined = (value: unknown): unknown => {
  if (typeof value === "string" && value.trim() === "") {
    return undefined;
  }

  return value;
};

const environmentValue = <Schema extends z.ZodType>(schema: Schema) =>
  z.preprocess(emptyStringToUndefined, schema);

const ApiEnvironmentSchema = z
  .object({
    NODE_ENV: environmentValue(
      z.enum(["development", "test", "production"]).default("development"),
    ),
    LOG_LEVEL: environmentValue(
      z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
    ),
    API_HOST: environmentValue(z.string().trim().min(1).default("127.0.0.1")),
    API_PORT: environmentValue(z.coerce.number().int().min(0).max(65_535).default(3_000)),
    SHUTDOWN_TIMEOUT_MS: environmentValue(
      z.coerce.number().int().min(100).max(120_000).default(10_000),
    ),
  })
  .superRefine((environment, context) => {
    if (environment.NODE_ENV === "production" && environment.API_PORT === 0) {
      context.addIssue({
        code: "custom",
        message: "must use an explicit non-zero port in production",
        path: ["API_PORT"],
      });
    }
  });

export interface ApiConfig {
  readonly host: string;
  readonly logLevel: "fatal" | "error" | "warn" | "info" | "debug" | "trace" | "silent";
  readonly nodeEnv: "development" | "test" | "production";
  readonly port: number;
  readonly shutdownTimeoutMs: number;
}

export class ConfigurationError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(`Invalid API configuration: ${issues.join("; ")}`);
    this.name = "ConfigurationError";
    this.issues = Object.freeze([...issues]);
  }
}

const formatIssue = (issue: z.core.$ZodIssue): string => {
  const field = issue.path.length === 0 ? "environment" : issue.path.join(".");
  return `${field}: ${issue.message}`;
};

export const loadApiConfig = (environment: NodeJS.ProcessEnv = process.env): ApiConfig => {
  const result = ApiEnvironmentSchema.safeParse(environment);

  if (!result.success) {
    throw new ConfigurationError(result.error.issues.map(formatIssue));
  }

  return Object.freeze({
    host: result.data.API_HOST,
    logLevel: result.data.LOG_LEVEL,
    nodeEnv: result.data.NODE_ENV,
    port: result.data.API_PORT,
    shutdownTimeoutMs: result.data.SHUTDOWN_TIMEOUT_MS,
  });
};
