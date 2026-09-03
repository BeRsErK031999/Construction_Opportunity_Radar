import { loadWorkerConfig } from "@radar/config";
import { createDatabaseClient, PrismaProcessingJobRepository } from "@radar/db";
import {
  createPipelineJobHandlers,
  type FixedIntervalJobSchedule,
  type PipelineJobOperations,
} from "@radar/jobs";
import { createLogger, createOperationalTelemetry } from "@radar/observability";

import { startWorker, type RunningWorker } from "./lifecycle.js";

export interface RunWorkerOptions {
  readonly environment?: NodeJS.ProcessEnv;
  readonly operations: PipelineJobOperations;
  readonly schedules?: readonly FixedIntervalJobSchedule[];
}

export const runWorker = async (options: RunWorkerOptions): Promise<RunningWorker> => {
  const config = loadWorkerConfig(options.environment);
  const logger = createLogger({
    environment: config.nodeEnv,
    level: config.logLevel,
    service: "worker",
  });
  const client = createDatabaseClient(config.databaseUrl);
  const telemetry = createOperationalTelemetry({ logger });
  await client.$connect();

  return startWorker({
    config,
    handlers: createPipelineJobHandlers(options.operations),
    logger,
    observer: telemetry,
    onClose: () => client.$disconnect(),
    repository: new PrismaProcessingJobRepository(client),
    ...(options.schedules === undefined ? {} : { schedules: options.schedules }),
  });
};
