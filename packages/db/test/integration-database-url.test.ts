import { describe, expect, it } from "vitest";

import { externalIntegrationDatabaseUrl } from "../integration/integration-database-url.js";

describe("externalIntegrationDatabaseUrl", () => {
  it("uses Testcontainers when no external integration database is configured", () => {
    expect(externalIntegrationDatabaseUrl({})).toBeNull();
    expect(externalIntegrationDatabaseUrl({ INTEGRATION_DATABASE_URL: "  " })).toBeNull();
  });

  it("accepts only the loopback radar_test service database", () => {
    const databaseUrl =
      "postgresql://radar_test:test-only-password@127.0.0.1:5432/radar_test?schema=public";

    expect(externalIntegrationDatabaseUrl({ INTEGRATION_DATABASE_URL: databaseUrl })).toBe(
      databaseUrl,
    );
  });

  it.each([
    "mysql://radar_test:test-only-password@127.0.0.1:5432/radar_test",
    "postgresql://radar_test:test-only-password@database.example/radar_test",
    "postgresql://radar:test-only-password@127.0.0.1:5432/radar_test",
    "postgresql://radar_test:test-only-password@127.0.0.1:5432/radar",
    "postgresql://radar_test@127.0.0.1:5432/radar_test",
  ])("rejects a destructive or non-test target without echoing credentials", (databaseUrl) => {
    expect(() => externalIntegrationDatabaseUrl({ INTEGRATION_DATABASE_URL: databaseUrl })).toThrow(
      /loopback radar_test/,
    );
    try {
      externalIntegrationDatabaseUrl({ INTEGRATION_DATABASE_URL: databaseUrl });
    } catch (error) {
      expect(String(error)).not.toContain("test-only-password");
    }
  });

  it("rejects malformed URLs with a safe error", () => {
    for (const databaseUrl of [
      "not a database URL",
      "postgresql://radar%ZZ:test-only-password@127.0.0.1:5432/radar_test",
    ]) {
      expect(() =>
        externalIntegrationDatabaseUrl({ INTEGRATION_DATABASE_URL: databaseUrl }),
      ).toThrow("INTEGRATION_DATABASE_URL must be a valid PostgreSQL URL");
    }
  });
});
