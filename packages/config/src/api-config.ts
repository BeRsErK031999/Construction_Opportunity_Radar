import { z } from "zod";

const emptyStringToUndefined = (value: unknown): unknown => {
  if (typeof value === "string" && value.trim() === "") {
    return undefined;
  }

  return value;
};

const environmentValue = <Schema extends z.ZodType>(schema: Schema) =>
  z.preprocess(emptyStringToUndefined, schema);

const LOCAL_DATABASE_URL = "postgresql://radar_runtime:radar_runtime_local@127.0.0.1:54329/radar";
const DatabaseUrlSchema = z
  .string()
  .trim()
  .refine((value) => {
    try {
      const protocol = new URL(value).protocol;
      return protocol === "postgres:" || protocol === "postgresql:";
    } catch {
      return false;
    }
  }, "must be a PostgreSQL connection URL");
const ServiceTokenSchema = z
  .string()
  .min(32)
  .max(512)
  .regex(/^[!-~]+$/, "must contain only visible ASCII characters without spaces");

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
    API_AUTH_TOKEN: environmentValue(ServiceTokenSchema.optional()),
    API_ADMIN_AUTH_TOKEN: environmentValue(ServiceTokenSchema.optional()),
    API_BODY_LIMIT_BYTES: environmentValue(
      z.coerce.number().int().min(1_024).max(1_048_576).default(65_536),
    ),
    API_RATE_LIMIT_MAX: environmentValue(z.coerce.number().int().min(1).max(10_000).default(60)),
    API_RATE_LIMIT_WINDOW_MS: environmentValue(
      z.coerce.number().int().min(1_000).max(3_600_000).default(60_000),
    ),
    DATABASE_URL: environmentValue(DatabaseUrlSchema.optional()),
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
    if (environment.NODE_ENV === "production" && environment.API_AUTH_TOKEN === undefined) {
      context.addIssue({
        code: "custom",
        message: "is required in production",
        path: ["API_AUTH_TOKEN"],
      });
    }
    if (environment.NODE_ENV === "production" && environment.API_ADMIN_AUTH_TOKEN === undefined) {
      context.addIssue({
        code: "custom",
        message: "is required in production",
        path: ["API_ADMIN_AUTH_TOKEN"],
      });
    }
    if (
      environment.API_AUTH_TOKEN !== undefined &&
      environment.API_ADMIN_AUTH_TOKEN !== undefined &&
      environment.API_AUTH_TOKEN === environment.API_ADMIN_AUTH_TOKEN
    ) {
      context.addIssue({
        code: "custom",
        message: "must differ from API_AUTH_TOKEN",
        path: ["API_ADMIN_AUTH_TOKEN"],
      });
    }
    if (environment.NODE_ENV === "production" && environment.DATABASE_URL === undefined) {
      context.addIssue({
        code: "custom",
        message: "is required in production",
        path: ["DATABASE_URL"],
      });
    }
    if (
      environment.NODE_ENV === "production" &&
      !["127.0.0.1", "::1", "localhost"].includes(environment.API_HOST)
    ) {
      context.addIssue({
        code: "custom",
        message: "must stay on a loopback interface for the private API",
        path: ["API_HOST"],
      });
    }
  });

export interface ApiConfig {
  readonly adminAuthToken: string | null;
  readonly apiAuthToken: string | null;
  readonly bodyLimitBytes: number;
  readonly databaseUrl: string;
  readonly host: string;
  readonly logLevel: "fatal" | "error" | "warn" | "info" | "debug" | "trace" | "silent";
  readonly nodeEnv: "development" | "test" | "production";
  readonly port: number;
  readonly rateLimitMax: number;
  readonly rateLimitWindowMs: number;
  readonly shutdownTimeoutMs: number;
}

export class ConfigurationError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[], component = "application") {
    super(`Invalid ${component} configuration: ${issues.join("; ")}`);
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
    throw new ConfigurationError(result.error.issues.map(formatIssue), "API");
  }

  return Object.freeze({
    adminAuthToken: result.data.API_ADMIN_AUTH_TOKEN ?? null,
    apiAuthToken: result.data.API_AUTH_TOKEN ?? null,
    bodyLimitBytes: result.data.API_BODY_LIMIT_BYTES,
    databaseUrl: result.data.DATABASE_URL ?? LOCAL_DATABASE_URL,
    host: result.data.API_HOST,
    logLevel: result.data.LOG_LEVEL,
    nodeEnv: result.data.NODE_ENV,
    port: result.data.API_PORT,
    rateLimitMax: result.data.API_RATE_LIMIT_MAX,
    rateLimitWindowMs: result.data.API_RATE_LIMIT_WINDOW_MS,
    shutdownTimeoutMs: result.data.SHUTDOWN_TIMEOUT_MS,
  });
};
