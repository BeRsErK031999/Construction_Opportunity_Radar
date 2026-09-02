import { describe, expect, it } from "vitest";

import { ConfigurationError, loadApiConfig } from "../src/index.js";

describe("loadApiConfig", () => {
  it("uses safe local defaults without external services or credentials", () => {
    expect(loadApiConfig({})).toEqual({
      apiAuthToken: null,
      databaseUrl: "postgresql://radar:radar_local@127.0.0.1:54329/radar",
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
        API_AUTH_TOKEN: "",
        API_HOST: "",
        API_PORT: "",
        DATABASE_URL: "",
        LOG_LEVEL: "",
        NODE_ENV: "",
        SHUTDOWN_TIMEOUT_MS: "",
      }),
    ).toEqual({
      apiAuthToken: null,
      databaseUrl: "postgresql://radar:radar_local@127.0.0.1:54329/radar",
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
        API_AUTH_TOKEN: "a-secure-test-token-with-32-characters",
        API_HOST: "0.0.0.0",
        API_PORT: "4000",
        DATABASE_URL: "postgresql://test:test@127.0.0.1:5432/test",
        LOG_LEVEL: "debug",
        NODE_ENV: "test",
        SHUTDOWN_TIMEOUT_MS: "2500",
      }),
    ).toEqual({
      apiAuthToken: "a-secure-test-token-with-32-characters",
      databaseUrl: "postgresql://test:test@127.0.0.1:5432/test",
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
          expect.stringContaining("DATABASE_URL"),
          expect.stringContaining("API_HOST"),
        ]),
      );
    }
  });
});
