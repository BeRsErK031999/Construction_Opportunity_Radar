import { describe, expect, it, vi } from "vitest";

import type { WorkerConfig } from "@radar/config";
import type { ProcessingJobRepository } from "@radar/jobs";
import { createLogger } from "@radar/observability";

import { startWorker } from "../src/lifecycle.js";

const testConfig: WorkerConfig = {
  databaseUrl: "postgresql://radar:radar_local@127.0.0.1:54329/radar",
  jobLockTimeoutMs: 60_000,
  jobMaxAttempts: 5,
  jobPollIntervalMs: 10,
  jobRetryBaseMs: 1_000,
  jobRetryMaxMs: 300_000,
  jobStaleRecoveryLimit: 100,
  logLevel: "silent",
  nodeEnv: "test",
  workerId: "worker-lifecycle-test",
};

const idleRepository = (): ProcessingJobRepository => ({
  claimNext: () => Promise.resolve(null),
  complete: () => Promise.reject(new Error("No job should be completed")),
  enqueue: () => Promise.reject(new Error("No schedule is configured")),
  fail: () => Promise.reject(new Error("No job should fail")),
  findById: () => Promise.resolve(null),
  recoverStale: () =>
    Promise.resolve(Object.freeze({ failed: 0, jobs: Object.freeze([]), requeued: 0 })),
  renewLease: () => Promise.resolve(false),
});

describe("worker lifecycle", () => {
  it("stops an idle loop and closes resources exactly once", async () => {
    const onClose = vi.fn(() => Promise.resolve());
    const worker = startWorker({
      config: testConfig,
      handlers: {},
      installSignalHandlers: false,
      logger: createLogger({ level: "silent", service: "worker-test" }),
      onClose,
      repository: idleRepository(),
    });

    await worker.stop("test");
    await expect(worker.completion).resolves.toBeUndefined();
    await expect(worker.stop("test")).resolves.toBeUndefined();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
