import { describe, expect, it } from "vitest";

import { ConfigurationError, loadWorkerConfig } from "../src/index.js";

describe("worker configuration", () => {
  it("loads safe runtime defaults while requiring PostgreSQL", () => {
    expect(
      loadWorkerConfig({
        DATABASE_URL: "postgresql://radar:local@127.0.0.1:54329/radar",
        NODE_ENV: "test",
        WORKER_ID: "worker-test-1",
      }),
    ).toEqual({
      databaseUrl: "postgresql://radar:local@127.0.0.1:54329/radar",
      jobLockTimeoutMs: 60_000,
      jobMaxAttempts: 5,
      jobPollIntervalMs: 1_000,
      jobRetryBaseMs: 1_000,
      jobRetryMaxMs: 300_000,
      jobStaleRecoveryLimit: 100,
      logLevel: "info",
      nodeEnv: "test",
      workerId: "worker-test-1",
    });
  });

  it("fails fast without a database URL", () => {
    expect(() => loadWorkerConfig({ NODE_ENV: "production" })).toThrow(ConfigurationError);
  });

  it("rejects a retry maximum below the base delay", () => {
    expect(() =>
      loadWorkerConfig({
        DATABASE_URL: "postgresql://radar:local@127.0.0.1:54329/radar",
        JOB_RETRY_BASE_MS: "5000",
        JOB_RETRY_MAX_MS: "1000",
      }),
    ).toThrow(/JOB_RETRY_MAX_MS/);
  });
});
