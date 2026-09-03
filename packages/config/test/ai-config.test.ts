import { describe, expect, it } from "vitest";

import { ConfigurationError, loadAIConfig } from "../src/index.js";

describe("AI provider configuration", () => {
  it("uses the offline fake provider and ignores unrelated Ollama values", () => {
    expect(
      loadAIConfig({
        OLLAMA_BASE_URL: "not-a-url",
        OLLAMA_MAX_CONCURRENCY: "not-a-number",
      }),
    ).toEqual({ provider: "fake" });
  });

  it("requires only the model when Ollama is selected and applies safe local defaults", () => {
    expect(
      loadAIConfig({
        AI_PROVIDER: "ollama",
        OLLAMA_MODEL: "deepseek-r1:8b",
      }),
    ).toEqual({
      allowRemotePrivateHost: false,
      baseUrl: "http://127.0.0.1:11434",
      contextTokens: 8_192,
      healthTimeoutMs: 5_000,
      keepAlive: "5m",
      maxConcurrentRequests: 1,
      maxInputCharacters: 24_000,
      model: "deepseek-r1:8b",
      provider: "ollama",
      requestTimeoutMs: 300_000,
      seed: 42,
    });
  });

  it("fails fast when Ollama is selected without a model", () => {
    expect(() => loadAIConfig({ AI_PROVIDER: "ollama" })).toThrow(ConfigurationError);
    expect(() => loadAIConfig({ AI_PROVIDER: "ollama" })).toThrow(/OLLAMA_MODEL/);
  });

  it("accepts explicit bounded Ollama settings", () => {
    expect(
      loadAIConfig({
        AI_PROVIDER: "ollama",
        OLLAMA_CONTEXT_TOKENS: "16384",
        OLLAMA_HEALTH_TIMEOUT_MS: "2500",
        OLLAMA_KEEP_ALIVE: "10m",
        OLLAMA_MAX_CONCURRENCY: "2",
        OLLAMA_MAX_INPUT_CHARACTERS: "48000",
        OLLAMA_MODEL: "deepseek-r1:14b",
        OLLAMA_REQUEST_TIMEOUT_MS: "600000",
        OLLAMA_SEED: "7",
      }),
    ).toMatchObject({
      contextTokens: 16_384,
      healthTimeoutMs: 2_500,
      keepAlive: "10m",
      maxConcurrentRequests: 2,
      maxInputCharacters: 48_000,
      model: "deepseek-r1:14b",
      requestTimeoutMs: 600_000,
      seed: 7,
    });
  });

  it("rejects credentials, paths, public hosts, and insecure remote origins", () => {
    const base = { AI_PROVIDER: "ollama", OLLAMA_MODEL: "deepseek-r1:8b" };
    expect(() =>
      loadAIConfig({ ...base, OLLAMA_BASE_URL: "http://user:secret@127.0.0.1:11434" }),
    ).toThrow(/credential-free/);
    expect(() => loadAIConfig({ ...base, OLLAMA_BASE_URL: "http://127.0.0.1:11434/api" })).toThrow(
      /without path/,
    );
    expect(() =>
      loadAIConfig({
        ...base,
        OLLAMA_ALLOW_REMOTE_PRIVATE_HOST: "true",
        OLLAMA_BASE_URL: "https://ollama.example.com",
      }),
    ).toThrow(/private address/);
    expect(() =>
      loadAIConfig({
        ...base,
        OLLAMA_ALLOW_REMOTE_PRIVATE_HOST: "true",
        OLLAMA_BASE_URL: "http://192.168.10.25:11434",
      }),
    ).toThrow(/require HTTPS/);
  });

  it("allows an explicitly enabled private HTTPS host", () => {
    expect(
      loadAIConfig({
        AI_PROVIDER: "ollama",
        OLLAMA_ALLOW_REMOTE_PRIVATE_HOST: "true",
        OLLAMA_BASE_URL: "https://denis-pc.internal:11434",
        OLLAMA_MODEL: "deepseek-r1:8b",
      }),
    ).toMatchObject({
      allowRemotePrivateHost: true,
      baseUrl: "https://denis-pc.internal:11434",
      provider: "ollama",
    });
  });
});
