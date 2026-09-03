import { isIP } from "node:net";

import { z } from "zod";

import { ConfigurationError } from "./api-config.js";

const DEFAULT_OLLAMA_BASE_URL = "http://127.0.0.1:11434";

const emptyStringToUndefined = (value: unknown): unknown =>
  typeof value === "string" && value.trim() === "" ? undefined : value;

const environmentValue = <Schema extends z.ZodType>(schema: Schema) =>
  z.preprocess(emptyStringToUndefined, schema);

const BooleanEnvironmentSchema = z.enum(["false", "true"]).transform((value) => value === "true");

const AIProviderEnvironmentSchema = z.object({
  AI_PROVIDER: environmentValue(z.enum(["fake", "ollama"]).default("fake")),
});

const OllamaEnvironmentSchema = z.object({
  OLLAMA_ALLOW_REMOTE_PRIVATE_HOST: environmentValue(BooleanEnvironmentSchema.default(false)),
  OLLAMA_BASE_URL: environmentValue(
    z.string().trim().min(1).max(2_000).default(DEFAULT_OLLAMA_BASE_URL),
  ),
  OLLAMA_CONTEXT_TOKENS: environmentValue(
    z.coerce.number().int().min(2_048).max(131_072).default(8_192),
  ),
  OLLAMA_HEALTH_TIMEOUT_MS: environmentValue(
    z.coerce.number().int().min(1_000).max(30_000).default(5_000),
  ),
  OLLAMA_KEEP_ALIVE: environmentValue(
    z
      .string()
      .trim()
      .regex(/^(?:0|[1-9]\d{0,5}(?:ms|s|m|h))$/, "must be 0 or a bounded duration")
      .default("5m"),
  ),
  OLLAMA_MAX_CONCURRENCY: environmentValue(z.coerce.number().int().min(1).max(8).default(1)),
  OLLAMA_MAX_INPUT_CHARACTERS: environmentValue(
    z.coerce.number().int().min(1_000).max(1_000_000).default(24_000),
  ),
  OLLAMA_MODEL: environmentValue(z.string().trim().min(1).max(200)),
  OLLAMA_REQUEST_TIMEOUT_MS: environmentValue(
    z.coerce.number().int().min(1_000).max(1_800_000).default(300_000),
  ),
  OLLAMA_SEED: environmentValue(z.coerce.number().int().min(0).max(2_147_483_647).default(42)),
});

const normalizedHostname = (hostname: string): string =>
  hostname.replace(/^\[|\]$/gu, "").toLocaleLowerCase("en-US");

const isLoopbackHostname = (hostname: string): boolean => {
  const normalized = normalizedHostname(hostname);
  if (normalized === "localhost" || normalized === "::1") {
    return true;
  }
  if (isIP(normalized) !== 4) {
    return false;
  }
  return Number(normalized.split(".")[0]) === 127;
};

const isPrivateAddress = (hostname: string): boolean => {
  const normalized = normalizedHostname(hostname);
  const ipVersion = isIP(normalized);
  if (ipVersion === 4) {
    const octets = normalized.split(".").map(Number);
    const first = octets[0];
    const second = octets[1];
    return (
      first === 10 ||
      (first === 172 && second !== undefined && second >= 16 && second <= 31) ||
      (first === 192 && second === 168)
    );
  }
  if (ipVersion === 6) {
    return normalized.startsWith("fc") || normalized.startsWith("fd");
  }
  return (
    !normalized.includes(".") ||
    [".home.arpa", ".internal", ".lan", ".local"].some((suffix) => normalized.endsWith(suffix))
  );
};

const parseOllamaBaseUrl = (value: string, allowRemotePrivateHost: boolean): string => {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ConfigurationError(["OLLAMA_BASE_URL: must be an HTTP(S) origin URL"], "AI");
  }

  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username !== "" ||
    url.password !== "" ||
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new ConfigurationError(
      ["OLLAMA_BASE_URL: must be a credential-free HTTP(S) origin without path or query"],
      "AI",
    );
  }

  if (isLoopbackHostname(url.hostname)) {
    return url.origin;
  }
  if (!allowRemotePrivateHost) {
    throw new ConfigurationError(
      ["OLLAMA_BASE_URL: remote hosts require OLLAMA_ALLOW_REMOTE_PRIVATE_HOST=true"],
      "AI",
    );
  }
  if (!isPrivateAddress(url.hostname)) {
    throw new ConfigurationError(
      ["OLLAMA_BASE_URL: remote host must use a private address or private DNS name"],
      "AI",
    );
  }
  if (url.protocol !== "https:") {
    throw new ConfigurationError(
      ["OLLAMA_BASE_URL: remote hosts require HTTPS; prefer a loopback SSH tunnel"],
      "AI",
    );
  }
  return url.origin;
};

export interface FakeAIConfig {
  readonly provider: "fake";
}

export interface OllamaAIConfig {
  readonly allowRemotePrivateHost: boolean;
  readonly baseUrl: string;
  readonly contextTokens: number;
  readonly healthTimeoutMs: number;
  readonly keepAlive: string;
  readonly maxConcurrentRequests: number;
  readonly maxInputCharacters: number;
  readonly model: string;
  readonly provider: "ollama";
  readonly requestTimeoutMs: number;
  readonly seed: number;
}

export type AIConfig = FakeAIConfig | OllamaAIConfig;

const formatIssue = (issue: z.core.$ZodIssue): string => {
  const field = issue.path.length === 0 ? "environment" : issue.path.join(".");
  return `${field}: ${issue.message}`;
};

export const loadAIConfig = (environment: NodeJS.ProcessEnv = process.env): AIConfig => {
  const providerResult = AIProviderEnvironmentSchema.safeParse(environment);
  if (!providerResult.success) {
    throw new ConfigurationError(providerResult.error.issues.map(formatIssue), "AI");
  }
  if (providerResult.data.AI_PROVIDER === "fake") {
    return Object.freeze({ provider: "fake" as const });
  }

  const ollamaResult = OllamaEnvironmentSchema.safeParse(environment);
  if (!ollamaResult.success) {
    throw new ConfigurationError(ollamaResult.error.issues.map(formatIssue), "AI");
  }
  const baseUrl = parseOllamaBaseUrl(
    ollamaResult.data.OLLAMA_BASE_URL,
    ollamaResult.data.OLLAMA_ALLOW_REMOTE_PRIVATE_HOST,
  );
  return Object.freeze({
    allowRemotePrivateHost: ollamaResult.data.OLLAMA_ALLOW_REMOTE_PRIVATE_HOST,
    baseUrl,
    contextTokens: ollamaResult.data.OLLAMA_CONTEXT_TOKENS,
    healthTimeoutMs: ollamaResult.data.OLLAMA_HEALTH_TIMEOUT_MS,
    keepAlive: ollamaResult.data.OLLAMA_KEEP_ALIVE,
    maxConcurrentRequests: ollamaResult.data.OLLAMA_MAX_CONCURRENCY,
    maxInputCharacters: ollamaResult.data.OLLAMA_MAX_INPUT_CHARACTERS,
    model: ollamaResult.data.OLLAMA_MODEL,
    provider: "ollama" as const,
    requestTimeoutMs: ollamaResult.data.OLLAMA_REQUEST_TIMEOUT_MS,
    seed: ollamaResult.data.OLLAMA_SEED,
  });
};
