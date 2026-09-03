import { describe, expect, it } from "vitest";

import {
  JobExecutionError,
  jobFailureFrom,
  retryDelayMs,
  runJobCycle,
  type JobRuntimeEvent,
  scheduleBucketStart,
  type EnqueueJobResult,
  type FailJobInput,
  type FailJobResult,
  type ProcessingJob,
  type ProcessingJobRepository,
  type RecoverStaleJobsResult,
} from "../src/index.js";

const scheduledJob = (overrides: Partial<ProcessingJob> = {}): ProcessingJob =>
  Object.freeze({
    attempts: 0,
    completedAt: null,
    concurrencyKey: "source:1",
    correlationId: "10000000-0000-4000-8000-000000000001",
    createdAt: "2026-09-02T10:00:00.000Z",
    entityKey: "source:1",
    id: "20000000-0000-4000-8000-000000000001",
    idempotencyKey: "fetch:2026-09-02T10:00:00.000Z",
    lastErrorCode: null,
    lastErrorReason: null,
    leaseExpiresAt: null,
    leaseOwner: null,
    lockedAt: null,
    maxAttempts: 3,
    payload: { sourceId: "1" },
    payloadVersion: "fetch-source-v1",
    scheduledAt: "2026-09-02T10:00:00.000Z",
    status: "SCHEDULED",
    type: "fetchSources",
    updatedAt: "2026-09-02T10:00:00.000Z",
    ...overrides,
  });

class MemoryJobRepository implements ProcessingJobRepository {
  job: ProcessingJob | null;

  constructor(job: ProcessingJob | null) {
    this.job = job;
  }

  claimNext(input: {
    readonly leaseExpiresAt: string;
    readonly now: string;
    readonly workerId: string;
  }): Promise<ProcessingJob | null> {
    if (this.job?.status !== "SCHEDULED") {
      return Promise.resolve(null);
    }
    this.job = scheduledJob({
      ...this.job,
      attempts: this.job.attempts + 1,
      leaseExpiresAt: input.leaseExpiresAt,
      leaseOwner: input.workerId,
      lockedAt: input.now,
      status: "RUNNING",
      updatedAt: input.now,
    });
    return Promise.resolve(this.job);
  }

  complete(input: {
    readonly completedAt: string;
    readonly jobId: string;
    readonly workerId: string;
  }): Promise<ProcessingJob> {
    if (this.job?.id !== input.jobId || this.job.leaseOwner !== input.workerId) {
      throw new Error("not owned");
    }
    this.job = scheduledJob({
      ...this.job,
      completedAt: input.completedAt,
      leaseExpiresAt: null,
      leaseOwner: null,
      lockedAt: null,
      status: "SUCCEEDED",
      updatedAt: input.completedAt,
    });
    return Promise.resolve(this.job);
  }

  enqueue(): Promise<EnqueueJobResult> {
    if (this.job === null) {
      return Promise.reject(new Error("test job is required"));
    }
    return Promise.resolve(Object.freeze({ job: this.job, outcome: "EXISTING" }));
  }

  fail(input: FailJobInput): Promise<FailJobResult> {
    if (this.job === null) {
      return Promise.reject(new Error("test job is required"));
    }
    const terminal = !input.retryable || this.job.attempts >= this.job.maxAttempts;
    this.job = scheduledJob({
      ...this.job,
      completedAt: terminal ? input.failedAt : null,
      lastErrorCode: input.errorCode,
      lastErrorReason: input.errorReason,
      leaseExpiresAt: null,
      leaseOwner: null,
      lockedAt: null,
      scheduledAt: terminal ? this.job.scheduledAt : input.nextScheduledAt,
      status: terminal ? "FAILED" : "SCHEDULED",
      updatedAt: input.failedAt,
    });
    return Promise.resolve(
      Object.freeze({
        job: this.job,
        outcome: terminal ? "TERMINAL_FAILURE" : "RETRY_SCHEDULED",
      }),
    );
  }

  findById(id: string): Promise<ProcessingJob | null> {
    return Promise.resolve(this.job?.id === id ? this.job : null);
  }

  recoverStale(): Promise<RecoverStaleJobsResult> {
    return Promise.resolve(Object.freeze({ failed: 0, jobs: Object.freeze([]), requeued: 0 }));
  }

  renewLease(): Promise<boolean> {
    return Promise.resolve(true);
  }
}

const fixedClock = (values: readonly string[]) => {
  let index = 0;
  return {
    now: (): Date => {
      const value = values[Math.min(index, values.length - 1)];
      index += 1;
      if (value === undefined) {
        throw new Error("clock value is required");
      }
      return new Date(value);
    },
  };
};

describe("job runtime", () => {
  it("dispatches a claimed job and completes it", async () => {
    const repository = new MemoryJobRepository(scheduledJob());
    const handled: string[] = [];
    const events: JobRuntimeEvent[] = [];
    const result = await runJobCycle({
      clock: fixedClock(["2026-09-02T10:00:00.000Z", "2026-09-02T10:00:01.000Z"]),
      handlers: {
        fetchSources: ({ job }) => {
          handled.push(job.id);
          return Promise.resolve();
        },
      },
      leaseTimeoutMs: 60_000,
      observer: { observeJob: (event: JobRuntimeEvent) => events.push(event) },
      repository,
      retryPolicy: { baseDelayMs: 1_000, maximumDelayMs: 8_000 },
      staleRecoveryLimit: 10,
      workerId: "worker-1",
    });

    expect(handled).toEqual(["20000000-0000-4000-8000-000000000001"]);
    expect(result).toMatchObject({
      outcome: "SUCCEEDED",
      job: { attempts: 1, status: "SUCCEEDED" },
    });
    expect(events).toEqual([
      expect.objectContaining({ name: "job_started", jobType: "fetchSources" }),
      expect.objectContaining({ name: "job_completed", outcome: "SUCCEEDED" }),
    ]);
  });

  it("persists retry policy from typed failures", async () => {
    const repository = new MemoryJobRepository(scheduledJob());
    const result = await runJobCycle({
      clock: fixedClock(["2026-09-02T10:00:00.000Z", "2026-09-02T10:00:02.000Z"]),
      handlers: {
        fetchSources: () =>
          Promise.reject(
            new JobExecutionError({
              code: "SOURCE_TIMEOUT",
              message: "Source timed out",
              retryable: true,
            }),
          ),
      },
      leaseTimeoutMs: 60_000,
      repository,
      retryPolicy: { baseDelayMs: 1_000, maximumDelayMs: 8_000 },
      staleRecoveryLimit: 10,
      workerId: "worker-1",
    });

    expect(result).toMatchObject({
      outcome: "RETRY_SCHEDULED",
      job: {
        lastErrorCode: "SOURCE_TIMEOUT",
        scheduledAt: "2026-09-02T10:00:03.000Z",
        status: "SCHEDULED",
      },
    });
  });

  it("fails terminally when a handler is absent", async () => {
    const repository = new MemoryJobRepository(scheduledJob());
    const result = await runJobCycle({
      clock: fixedClock(["2026-09-02T10:00:00.000Z", "2026-09-02T10:00:01.000Z"]),
      handlers: {},
      leaseTimeoutMs: 60_000,
      repository,
      retryPolicy: { baseDelayMs: 1_000, maximumDelayMs: 8_000 },
      staleRecoveryLimit: 10,
      workerId: "worker-1",
    });

    expect(result).toMatchObject({
      outcome: "TERMINAL_FAILURE",
      job: { lastErrorCode: "JOB_HANDLER_NOT_REGISTERED", status: "FAILED" },
    });
  });

  it("uses bounded exponential retry delays", () => {
    const policy = { baseDelayMs: 1_000, maximumDelayMs: 5_000 };
    expect([1, 2, 3, 4, 20].map((attempt) => retryDelayMs(attempt, policy))).toEqual([
      1_000, 2_000, 4_000, 5_000, 5_000,
    ]);
  });

  it("does not persist an untyped exception message", () => {
    const failure = jobFailureFrom(new Error("token=private raw payload"));

    expect(failure).toEqual({
      code: "JOB_HANDLER_FAILED",
      reason: "Job handler failed with an unknown error",
      retryable: true,
    });
  });

  it("derives a stable fixed-interval scheduler bucket", () => {
    const schedule = {
      anchorAt: "2026-09-02T00:00:00.000Z",
      concurrencyKey: "source:1",
      entityKey: "source:1",
      everyMs: 60_000,
      maxAttempts: 3,
      payload: { sourceId: "1" },
      payloadVersion: "fetch-source-v1",
      scheduleKey: "source-1",
      type: "fetchSources" as const,
    };
    expect(scheduleBucketStart(schedule, "2026-09-02T00:02:59.999Z")).toBe(
      "2026-09-02T00:02:00.000Z",
    );
    expect(scheduleBucketStart(schedule, "2026-09-01T23:59:59.999Z")).toBeNull();
  });
});
