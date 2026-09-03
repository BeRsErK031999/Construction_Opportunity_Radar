import type { ApiConfig } from "@radar/config";
import { createLogger, type AppLogger } from "@radar/observability";

import { buildApi, type ApiRepositories } from "./app.js";

const SHUTDOWN_SIGNALS = ["SIGINT", "SIGTERM"] as const;

type ShutdownSignal = (typeof SHUTDOWN_SIGNALS)[number];
export type ShutdownReason = ShutdownSignal | "manual" | "test";

export interface StartApiOptions {
  readonly config: ApiConfig;
  readonly installSignalHandlers?: boolean;
  readonly logger?: AppLogger;
  readonly onClose?: () => Promise<void>;
  readonly repositories?: ApiRepositories | null;
}

export interface RunningApi {
  readonly address: string;
  readonly app: ReturnType<typeof buildApi>;
  close(reason?: ShutdownReason): Promise<void>;
}

export class ShutdownTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`API shutdown exceeded ${String(timeoutMs)}ms`);
    this.name = "ShutdownTimeoutError";
  }
}

const closeWithTimeout = async (
  app: ReturnType<typeof buildApi>,
  timeoutMs: number,
): Promise<void> => {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new ShutdownTimeoutError(timeoutMs)), timeoutMs);
    timer.unref();
  });

  try {
    await Promise.race([app.close(), timeout]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
};

export const startApi = async (options: StartApiOptions): Promise<RunningApi> => {
  const { config } = options;
  const logger =
    options.logger ??
    createLogger({
      environment: config.nodeEnv,
      level: config.logLevel,
      service: "api",
    });
  const app = buildApi({
    adminAuthToken: config.adminAuthToken,
    apiAuthToken: config.apiAuthToken,
    bodyLimitBytes: config.bodyLimitBytes,
    logger,
    rateLimitMax: config.rateLimitMax,
    rateLimitWindowMs: config.rateLimitWindowMs,
    ...(options.onClose === undefined ? {} : { onClose: options.onClose }),
    ...(options.repositories === undefined ? {} : { repositories: options.repositories }),
  });
  const signalHandlers = new Map<ShutdownSignal, () => void>();
  let closePromise: Promise<void> | undefined;

  const removeSignalHandlers = (): void => {
    for (const [signal, handler] of signalHandlers) {
      process.removeListener(signal, handler);
    }
    signalHandlers.clear();
  };

  const close = (reason: ShutdownReason = "manual"): Promise<void> => {
    if (closePromise !== undefined) {
      return closePromise;
    }

    removeSignalHandlers();
    closePromise = (async () => {
      logger.info({ event: "api_stopping", reason }, "Stopping API");
      await closeWithTimeout(app, config.shutdownTimeoutMs);
      logger.info({ event: "api_stopped", reason }, "API stopped");
    })();

    return closePromise;
  };

  let address: string;
  try {
    address = await app.listen({ host: config.host, port: config.port });
  } catch (error) {
    try {
      await app.close();
    } catch (closeError) {
      logger.error(
        { err: closeError, event: "api_start_cleanup_failed" },
        "Failed to clean up after API start failure",
      );
    }
    throw error;
  }

  if (options.installSignalHandlers !== false) {
    for (const signal of SHUTDOWN_SIGNALS) {
      const handler = (): void => {
        void close(signal).catch((error: unknown) => {
          logger.error({ err: error, event: "api_shutdown_failed", signal }, "API shutdown failed");
          process.exitCode = 1;
        });
      };
      signalHandlers.set(signal, handler);
      process.once(signal, handler);
    }
  }

  logger.info({ address, event: "api_started" }, "API started");

  return { address, app, close };
};
