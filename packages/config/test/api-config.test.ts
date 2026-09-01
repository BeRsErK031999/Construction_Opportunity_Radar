import { describe, expect, it } from "vitest";

import { ConfigurationError, loadApiConfig } from "../src/index.js";

describe("loadApiConfig", () => {
  it("uses safe local defaults without external services or credentials", () => {
    expect(loadApiConfig({})).toEqual({
      host: "127.0.0.1",
      logLevel: "info",
      nodeEnv: "development",
      port: 3_000,
      shutdownTimeoutMs: 10_000,
    });
  });

  it("treats empty .env.example values as unset", () => {
    expect(
      loadApiConfig({
        API_HOST: "",
        API_PORT: "",
        LOG_LEVEL: "",
        NODE_ENV: "",
        SHUTDOWN_TIMEOUT_MS: "",
      }),
    ).toEqual({
      host: "127.0.0.1",
      logLevel: "info",
      nodeEnv: "development",
      port: 3_000,
      shutdownTimeoutMs: 10_000,
    });
  });

  it("coerces explicit environment overrides", () => {
    expect(
      loadApiConfig({
        API_HOST: "0.0.0.0",
        API_PORT: "4000",
        LOG_LEVEL: "debug",
        NODE_ENV: "test",
        SHUTDOWN_TIMEOUT_MS: "2500",
      }),
    ).toEqual({
      host: "0.0.0.0",
      logLevel: "debug",
      nodeEnv: "test",
      port: 4_000,
      shutdownTimeoutMs: 2_500,
    });
  });

  it("rejects an ephemeral production port with a field-only diagnostic", () => {
    expect(() =>
      loadApiConfig({
        API_PORT: "0",
        NODE_ENV: "production",
        UNRELATED_SECRET: "must-not-appear",
      }),
    ).toThrow(ConfigurationError);

    try {
      loadApiConfig({
        API_PORT: "0",
        NODE_ENV: "production",
        UNRELATED_SECRET: "must-not-appear",
      });
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigurationError);
      expect((error as Error).message).toContain("API_PORT");
      expect((error as Error).message).not.toContain("must-not-appear");
    }
  });
});
