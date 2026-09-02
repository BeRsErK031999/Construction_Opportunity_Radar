import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { loadApiConfig } from "@radar/config";
import {
  createDatabaseClient,
  PrismaFeedbackRepository,
  PrismaProfileRegistrationRepository,
  PrismaSignalOpportunityRepository,
  PrismaSourceRepository,
} from "@radar/db";
import { createLogger } from "@radar/observability";

import { startApi } from "./lifecycle.js";

export const isMainModule = (
  moduleUrl: string,
  executablePath: string | undefined = process.argv[1],
): boolean =>
  executablePath !== undefined && moduleUrl === pathToFileURL(resolve(executablePath)).href;

export const runApi = async (): Promise<void> => {
  const config = loadApiConfig();
  const logger = createLogger({
    environment: config.nodeEnv,
    level: config.logLevel,
    service: "api",
  });

  const client = createDatabaseClient(config.databaseUrl);
  await startApi({
    config,
    logger,
    onClose: () => client.$disconnect(),
    repositories: {
      feedback: new PrismaFeedbackRepository(client),
      profiles: new PrismaProfileRegistrationRepository(client),
      signals: new PrismaSignalOpportunityRepository(client),
      sources: new PrismaSourceRepository(client),
    },
  });
};

if (isMainModule(import.meta.url)) {
  const bootstrapLogger = createLogger({ level: "info", service: "api-bootstrap" });
  void runApi().catch((error: unknown) => {
    bootstrapLogger.fatal({ err: error, event: "api.start_failed" }, "API failed to start");
    process.exitCode = 1;
  });
}
