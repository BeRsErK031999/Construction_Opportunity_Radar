import { z } from "zod";

import { ConfigurationError } from "./api-config.js";

const emptyStringToUndefined = (value: unknown): unknown =>
  typeof value === "string" && value.trim() === "" ? undefined : value;

const environmentValue = <Schema extends z.ZodType>(schema: Schema) =>
  z.preprocess(emptyStringToUndefined, schema);

const LOCAL_DATABASE_URL = "postgresql://radar:radar_local@127.0.0.1:54329/radar";
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

const BotEnvironmentSchema = z
  .object({
    NODE_ENV: environmentValue(
      z.enum(["development", "test", "production"]).default("development"),
    ),
    LOG_LEVEL: environmentValue(
      z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
    ),
    DATABASE_URL: environmentValue(DatabaseUrlSchema.optional()),
    TELEGRAM_BOT_TOKEN: environmentValue(z.string().trim().min(32).max(512)),
    TELEGRAM_POLLING_TIMEOUT_SECONDS: environmentValue(
      z.coerce.number().int().min(1).max(50).default(30),
    ),
  })
  .superRefine((environment, context) => {
    if (environment.NODE_ENV === "production" && environment.DATABASE_URL === undefined) {
      context.addIssue({
        code: "custom",
        message: "is required in production",
        path: ["DATABASE_URL"],
      });
    }
  });

export interface BotConfig {
  readonly databaseUrl: string;
  readonly logLevel: "fatal" | "error" | "warn" | "info" | "debug" | "trace" | "silent";
  readonly nodeEnv: "development" | "test" | "production";
  readonly pollingTimeoutSeconds: number;
  readonly telegramBotToken: string;
}

const formatIssue = (issue: z.core.$ZodIssue): string => {
  const field = issue.path.length === 0 ? "environment" : issue.path.join(".");
  return `${field}: ${issue.message}`;
};

export const loadBotConfig = (environment: NodeJS.ProcessEnv = process.env): BotConfig => {
  const result = BotEnvironmentSchema.safeParse(environment);
  if (!result.success) {
    throw new ConfigurationError(result.error.issues.map(formatIssue), "bot");
  }
  return Object.freeze({
    databaseUrl: result.data.DATABASE_URL ?? LOCAL_DATABASE_URL,
    logLevel: result.data.LOG_LEVEL,
    nodeEnv: result.data.NODE_ENV,
    pollingTimeoutSeconds: result.data.TELEGRAM_POLLING_TIMEOUT_SECONDS,
    telegramBotToken: result.data.TELEGRAM_BOT_TOKEN,
  });
};
