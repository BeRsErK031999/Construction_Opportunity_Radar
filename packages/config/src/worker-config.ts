import { hostname } from "node:os";

import { z } from "zod";

import { ConfigurationError } from "./api-config.js";

const emptyStringToUndefined = (value: unknown): unknown =>
  typeof value === "string" && value.trim() === "" ? undefined : value;

const environmentValue = <Schema extends z.ZodType>(schema: Schema) =>
  z.preprocess(emptyStringToUndefined, schema);

const DatabaseUrlSchema = z
  .string()
  .trim()
  .refine((value) => {
    try {
      return ["postgres:", "postgresql:"].includes(new URL(value).protocol);
    } catch {
      return false;
    }
  }, "must be a PostgreSQL connection URL");

const WorkerEnvironmentSchema = z
  .object({
    DATABASE_URL: environmentValue(DatabaseUrlSchema),
    JOB_LOCK_TIMEOUT_MS: environmentValue(
      z.coerce.number().int().min(1_000).max(3_600_000).default(60_000),
    ),
    JOB_MAX_ATTEMPTS: environmentValue(z.coerce.number().int().min(1).max(20).default(5)),
    JOB_POLL_INTERVAL_MS: environmentValue(
      z.coerce.number().int().min(10).max(60_000).default(1_000),
    ),
    JOB_RETRY_BASE_MS: environmentValue(
      z.coerce.number().int().min(100).max(3_600_000).default(1_000),
    ),
    JOB_RETRY_MAX_MS: environmentValue(
      z.coerce.number().int().min(100).max(86_400_000).default(300_000),
    ),
    JOB_STALE_RECOVERY_LIMIT: environmentValue(
      z.coerce.number().int().min(1).max(1_000).default(100),
    ),
    LOG_LEVEL: environmentValue(
      z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
    ),
    NODE_ENV: environmentValue(
      z.enum(["development", "test", "production"]).default("development"),
    ),
    WORKER_ID: environmentValue(z.string().trim().min(1).max(200).optional()),
  })
  .superRefine((environment, context) => {
    if (environment.JOB_RETRY_MAX_MS < environment.JOB_RETRY_BASE_MS) {
      context.addIssue({
        code: "custom",
        message: "must be greater than or equal to JOB_RETRY_BASE_MS",
        path: ["JOB_RETRY_MAX_MS"],
      });
    }
  });

export interface WorkerConfig {
  readonly databaseUrl: string;
  readonly jobLockTimeoutMs: number;
  readonly jobMaxAttempts: number;
  readonly jobPollIntervalMs: number;
  readonly jobRetryBaseMs: number;
  readonly jobRetryMaxMs: number;
  readonly jobStaleRecoveryLimit: number;
  readonly logLevel: "fatal" | "error" | "warn" | "info" | "debug" | "trace" | "silent";
  readonly nodeEnv: "development" | "test" | "production";
  readonly workerId: string;
}

const formatIssue = (issue: z.core.$ZodIssue): string => {
  const field = issue.path.length === 0 ? "environment" : issue.path.join(".");
  return `${field}: ${issue.message}`;
};

export const loadWorkerConfig = (environment: NodeJS.ProcessEnv = process.env): WorkerConfig => {
  const result = WorkerEnvironmentSchema.safeParse(environment);
  if (!result.success) {
    throw new ConfigurationError(result.error.issues.map(formatIssue), "worker");
  }
  return Object.freeze({
    databaseUrl: result.data.DATABASE_URL,
    jobLockTimeoutMs: result.data.JOB_LOCK_TIMEOUT_MS,
    jobMaxAttempts: result.data.JOB_MAX_ATTEMPTS,
    jobPollIntervalMs: result.data.JOB_POLL_INTERVAL_MS,
    jobRetryBaseMs: result.data.JOB_RETRY_BASE_MS,
    jobRetryMaxMs: result.data.JOB_RETRY_MAX_MS,
    jobStaleRecoveryLimit: result.data.JOB_STALE_RECOVERY_LIMIT,
    logLevel: result.data.LOG_LEVEL,
    nodeEnv: result.data.NODE_ENV,
    workerId: result.data.WORKER_ID ?? `${hostname()}-${String(process.pid)}`,
  });
};
