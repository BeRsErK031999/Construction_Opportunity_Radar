import { JobExecutionError, jobFailureFrom } from "./errors.js";
import type { ProcessingJob } from "./job.js";
import type { JobHandlerRegistry } from "./pipeline-handlers.js";
import type { ProcessingJobRepository, RecoverStaleJobsResult } from "./repository.js";
import { scheduleDueJobs, type FixedIntervalJobSchedule } from "./scheduler.js";

export interface JobRuntimeLogger {
  debug(bindings: object, message: string): void;
  error(bindings: object, message: string): void;
  info(bindings: object, message: string): void;
  warn(bindings: object, message: string): void;
}

export interface JobRuntimeClock {
  now(): Date;
}

export interface JobRetryPolicy {
  readonly baseDelayMs: number;
  readonly maximumDelayMs: number;
}

export interface RunJobCycleInput {
  readonly clock?: JobRuntimeClock;
  readonly handlers: JobHandlerRegistry;
  readonly leaseTimeoutMs: number;
  readonly logger?: JobRuntimeLogger;
  readonly repository: ProcessingJobRepository;
  readonly retryPolicy: JobRetryPolicy;
  readonly staleRecoveryLimit: number;
  readonly workerId: string;
}

export interface RunJobCycleResult {
  readonly job: ProcessingJob | null;
  readonly outcome: "IDLE" | "SUCCEEDED" | "RETRY_SCHEDULED" | "TERMINAL_FAILURE";
  readonly recovered: RecoverStaleJobsResult;
}

export interface RunJobLoopInput extends RunJobCycleInput {
  readonly defaultMaxAttempts: number;
  readonly pollIntervalMs: number;
  readonly schedules?: readonly FixedIntervalJobSchedule[];
  readonly signal: AbortSignal;
}

const defaultClock: JobRuntimeClock = Object.freeze({ now: () => new Date() });
const noOpLogger: JobRuntimeLogger = Object.freeze({
  debug: () => undefined,
  error: () => undefined,
  info: () => undefined,
  warn: () => undefined,
});

const isoAfter = (at: Date, milliseconds: number): string =>
  new Date(at.getTime() + milliseconds).toISOString();

const requirePositiveInteger = (value: number, field: string): void => {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${field} must be a positive safe integer`);
  }
};

export const retryDelayMs = (attempts: number, policy: JobRetryPolicy): number => {
  requirePositiveInteger(attempts, "attempts");
  requirePositiveInteger(policy.baseDelayMs, "retry baseDelayMs");
  requirePositiveInteger(policy.maximumDelayMs, "retry maximumDelayMs");
  if (policy.maximumDelayMs < policy.baseDelayMs) {
    throw new RangeError("retry maximumDelayMs must be greater than or equal to baseDelayMs");
  }
  const exponent = Math.min(attempts - 1, 30);
  return Math.min(policy.baseDelayMs * 2 ** exponent, policy.maximumDelayMs);
};

const delayUntilAbort = (milliseconds: number, signal: AbortSignal): Promise<void> => {
  if (signal.aborted) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    timer.unref();
    const onAbort = (): void => {
      clearTimeout(timer);
      resolve();
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
};

const validateRuntime = (input: RunJobCycleInput): void => {
  requirePositiveInteger(input.leaseTimeoutMs, "leaseTimeoutMs");
  requirePositiveInteger(input.staleRecoveryLimit, "staleRecoveryLimit");
  if (input.workerId.trim().length === 0) {
    throw new RangeError("workerId must not be empty");
  }
};

export const runJobCycle = async (input: RunJobCycleInput): Promise<RunJobCycleResult> => {
  validateRuntime(input);
  const clock = input.clock ?? defaultClock;
  const logger = input.logger ?? noOpLogger;
  const startedAt = clock.now();
  const recovered = await input.repository.recoverStale({
    limit: input.staleRecoveryLimit,
    now: startedAt.toISOString(),
    retryBaseDelayMs: input.retryPolicy.baseDelayMs,
    retryMaximumDelayMs: input.retryPolicy.maximumDelayMs,
  });
  if (recovered.jobs.length > 0) {
    logger.warn(
      {
        event: "jobs.stale_recovered",
        failed: recovered.failed,
        requeued: recovered.requeued,
      },
      "Recovered stale jobs",
    );
  }

  const job = await input.repository.claimNext({
    leaseExpiresAt: isoAfter(startedAt, input.leaseTimeoutMs),
    now: startedAt.toISOString(),
    workerId: input.workerId,
  });
  if (job === null) {
    return Object.freeze({ job: null, outcome: "IDLE", recovered });
  }
  logger.info(
    {
      attempt: job.attempts,
      correlationId: job.correlationId,
      entityKey: job.entityKey,
      event: "job.started",
      jobId: job.id,
      jobType: job.type,
    },
    "Started job",
  );

  const renewLease = async (): Promise<boolean> => {
    const now = clock.now();
    return input.repository.renewLease({
      jobId: job.id,
      leaseExpiresAt: isoAfter(now, input.leaseTimeoutMs),
      now: now.toISOString(),
      workerId: input.workerId,
    });
  };

  try {
    const handler = input.handlers[job.type];
    if (handler === undefined) {
      throw new JobExecutionError({
        code: "JOB_HANDLER_NOT_REGISTERED",
        message: `No handler is registered for ${job.type}`,
        retryable: false,
      });
    }
    await handler({ job, renewLease });
    const completedAt = clock.now().toISOString();
    const completed = await input.repository.complete({
      completedAt,
      jobId: job.id,
      workerId: input.workerId,
    });
    logger.info(
      {
        attempt: completed.attempts,
        correlationId: completed.correlationId,
        event: "job.succeeded",
        jobId: completed.id,
        jobType: completed.type,
      },
      "Completed job",
    );
    return Object.freeze({ job: completed, outcome: "SUCCEEDED", recovered });
  } catch (error) {
    const failedAt = clock.now();
    const failure = jobFailureFrom(error);
    const failed = await input.repository.fail({
      errorCode: failure.code,
      errorReason: failure.reason,
      failedAt: failedAt.toISOString(),
      jobId: job.id,
      nextScheduledAt: isoAfter(failedAt, retryDelayMs(job.attempts, input.retryPolicy)),
      retryable: failure.retryable,
      workerId: input.workerId,
    });
    const bindings = {
      attempt: failed.job.attempts,
      correlationId: failed.job.correlationId,
      errorCode: failure.code,
      event: failed.outcome === "RETRY_SCHEDULED" ? "job.retry_scheduled" : "job.failed",
      jobId: failed.job.id,
      jobType: failed.job.type,
      retryable: failure.retryable,
    };
    if (failed.outcome === "RETRY_SCHEDULED") {
      logger.warn(bindings, "Scheduled job retry");
    } else {
      logger.error(bindings, "Job reached terminal failure");
    }
    return Object.freeze({ job: failed.job, outcome: failed.outcome, recovered });
  }
};

export const runJobLoop = async (input: RunJobLoopInput): Promise<void> => {
  requirePositiveInteger(input.pollIntervalMs, "pollIntervalMs");
  while (!input.signal.aborted) {
    const now = (input.clock ?? defaultClock).now().toISOString();
    if (input.schedules !== undefined && input.schedules.length > 0) {
      const scheduled = await scheduleDueJobs({
        defaultMaxAttempts: input.defaultMaxAttempts,
        now,
        repository: input.repository,
        schedules: input.schedules,
      });
      if (scheduled.created > 0 || scheduled.overlapBlocked > 0) {
        (input.logger ?? noOpLogger).info(
          { event: "jobs.scheduled", ...scheduled },
          "Evaluated job schedules",
        );
      }
    }
    const result = await runJobCycle(input);
    if (result.outcome === "IDLE") {
      await delayUntilAbort(input.pollIntervalMs, input.signal);
    }
  }
};
