import { describe, expect, it } from "vitest";

import { ConfigurationError, loadApiConfig } from "../src/index.js";

describe("loadApiConfig", () => {
  it("uses safe local defaults without external services or credentials", () => {
    expect(loadApiConfig({})).toEqual({
      adminAuthToken: null,
      apiAuthToken: null,
      bodyLimitBytes: 65_536,
      databaseUrl: "postgresql://radar_runtime:radar_runtime_local@127.0.0.1:54329/radar",
      host: "127.0.0.1",
      logLevel: "info",
      nodeEnv: "development",
      port: 3_000,
      rateLimitMax: 60,
      rateLimitWindowMs: 60_000,
      shutdownTimeoutMs: 10_000,
    });
  });

  it("treats empty .env.example values as unset", () => {
    expect(
      loadApiConfig({
        API_ADMIN_AUTH_TOKEN: "",
        API_AUTH_TOKEN: "",
        API_BODY_LIMIT_BYTES: "",
        API_HOST: "",
        API_PORT: "",
        API_RATE_LIMIT_MAX: "",
        API_RATE_LIMIT_WINDOW_MS: "",
        DATABASE_URL: "",
        LOG_LEVEL: "",
        NODE_ENV: "",
        SHUTDOWN_TIMEOUT_MS: "",
      }),
    ).toEqual({
      adminAuthToken: null,
      apiAuthToken: null,
      bodyLimitBytes: 65_536,
      databaseUrl: "postgresql://radar_runtime:radar_runtime_local@127.0.0.1:54329/radar",
      host: "127.0.0.1",
      logLevel: "info",
      nodeEnv: "development",
      port: 3_000,
      rateLimitMax: 60,
      rateLimitWindowMs: 60_000,
      shutdownTimeoutMs: 10_000,
    });
  });

  it("coerces explicit environment overrides", () => {
    expect(
      loadApiConfig({
        API_ADMIN_AUTH_TOKEN: "a-distinct-admin-token-with-32-characters",
        API_AUTH_TOKEN: "a-secure-test-token-with-32-characters",
        API_BODY_LIMIT_BYTES: "32768",
        API_HOST: "0.0.0.0",
        API_PORT: "4000",
        API_RATE_LIMIT_MAX: "25",
        API_RATE_LIMIT_WINDOW_MS: "30000",
        DATABASE_URL: "postgresql://test:test@127.0.0.1:5432/test",
        LOG_LEVEL: "debug",
        NODE_ENV: "test",
        SHUTDOWN_TIMEOUT_MS: "2500",
      }),
    ).toEqual({
      adminAuthToken: "a-distinct-admin-token-with-32-characters",
      apiAuthToken: "a-secure-test-token-with-32-characters",
      bodyLimitBytes: 32_768,
      databaseUrl: "postgresql://test:test@127.0.0.1:5432/test",
      host: "0.0.0.0",
      logLevel: "debug",
      nodeEnv: "test",
      port: 4_000,
      rateLimitMax: 25,
      rateLimitWindowMs: 30_000,
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

  it("requires explicit credentials and loopback binding in production", () => {
    try {
      loadApiConfig({
        API_HOST: "0.0.0.0",
        NODE_ENV: "production",
      });
      throw new Error("Expected production configuration validation to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigurationError);
      expect((error as ConfigurationError).issues).toEqual(
        expect.arrayContaining([
          expect.stringContaining("API_AUTH_TOKEN"),
          expect.stringContaining("API_ADMIN_AUTH_TOKEN"),
          expect.stringContaining("DATABASE_URL"),
          expect.stringContaining("API_HOST"),
        ]),
      );
    }
  });

  it("requires distinct least-privilege API tokens", () => {
    const sharedToken = "one-shared-token-is-not-least-privilege";
    expect(() =>
      loadApiConfig({
        API_ADMIN_AUTH_TOKEN: sharedToken,
        API_AUTH_TOKEN: sharedToken,
      }),
    ).toThrow(/API_ADMIN_AUTH_TOKEN/);
  });

  it("rejects service tokens that the strict Bearer transport cannot present", () => {
    expect(() =>
      loadApiConfig({
        API_AUTH_TOKEN: `${"a".repeat(32)} `,
      }),
    ).toThrow(/API_AUTH_TOKEN/);
  });
});
