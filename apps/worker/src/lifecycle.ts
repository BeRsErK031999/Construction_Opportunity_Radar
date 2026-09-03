import type { WorkerConfig } from "@radar/config";
import {
  runJobLoop,
  type FixedIntervalJobSchedule,
  type JobHandlerRegistry,
  type JobRuntimeObserver,
  type ProcessingJobRepository,
} from "@radar/jobs";
import type { AppLogger } from "@radar/observability";

const SHUTDOWN_SIGNALS = ["SIGINT", "SIGTERM"] as const;
type ShutdownSignal = (typeof SHUTDOWN_SIGNALS)[number];
export type WorkerShutdownReason = ShutdownSignal | "manual" | "test";

export interface StartWorkerOptions {
  readonly config: WorkerConfig;
  readonly handlers: JobHandlerRegistry;
  readonly installSignalHandlers?: boolean;
  readonly logger: AppLogger;
  readonly observer?: JobRuntimeObserver & { metricsSnapshot?: () => unknown };
  readonly onClose?: () => Promise<void>;
  readonly repository: ProcessingJobRepository;
  readonly schedules?: readonly FixedIntervalJobSchedule[];
}

export interface RunningWorker {
  readonly completion: Promise<void>;
  stop(reason?: WorkerShutdownReason): Promise<void>;
}

export const startWorker = (options: StartWorkerOptions): RunningWorker => {
  const controller = new AbortController();
  const signalHandlers = new Map<ShutdownSignal, () => void>();
  let closeResourcesPromise: Promise<void> | undefined;
  let stopPromise: Promise<void> | undefined;

  const removeSignalHandlers = (): void => {
    for (const [signal, handler] of signalHandlers) {
      process.removeListener(signal, handler);
    }
    signalHandlers.clear();
  };

  const closeResources = (): Promise<void> => {
    closeResourcesPromise ??= options.onClose?.() ?? Promise.resolve();
    return closeResourcesPromise;
  };

  const completion = runJobLoop({
    defaultMaxAttempts: options.config.jobMaxAttempts,
    handlers: options.handlers,
    leaseTimeoutMs: options.config.jobLockTimeoutMs,
    logger: options.logger,
    ...(options.observer === undefined ? {} : { observer: options.observer }),
    pollIntervalMs: options.config.jobPollIntervalMs,
    repository: options.repository,
    retryPolicy: {
      baseDelayMs: options.config.jobRetryBaseMs,
      maximumDelayMs: options.config.jobRetryMaxMs,
    },
    ...(options.schedules === undefined ? {} : { schedules: options.schedules }),
    signal: controller.signal,
    staleRecoveryLimit: options.config.jobStaleRecoveryLimit,
    workerId: options.config.workerId,
  }).finally(async () => {
    removeSignalHandlers();
    await closeResources();
  });

  const stop = (reason: WorkerShutdownReason = "manual"): Promise<void> => {
    if (stopPromise !== undefined) {
      return stopPromise;
    }
    stopPromise = (async () => {
      options.logger.info({ event: "worker_stopping", reason }, "Stopping worker");
      controller.abort(reason);
      await completion;
      if (options.observer?.metricsSnapshot !== undefined) {
        options.logger.info(
          {
            event: "operational_metrics_snapshot",
            metrics: options.observer.metricsSnapshot(),
          },
          "Final operational metrics snapshot",
        );
      }
      options.logger.info({ event: "worker_stopped", reason }, "Worker stopped");
    })();
    return stopPromise;
  };

  if (options.installSignalHandlers !== false) {
    for (const signal of SHUTDOWN_SIGNALS) {
      const handler = (): void => {
        void stop(signal).catch((error: unknown) => {
          options.logger.error(
            { err: error, event: "worker_shutdown_failed", signal },
            "Worker shutdown failed",
          );
          process.exitCode = 1;
        });
      };
      signalHandlers.set(signal, handler);
      process.once(signal, handler);
    }
  }

  options.logger.info(
    { event: "worker_started", worker_id: options.config.workerId },
    "Worker started",
  );
  return Object.freeze({ completion, stop });
};
