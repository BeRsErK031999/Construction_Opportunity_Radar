import Fastify from "fastify";

import { HealthResponseSchema, type HealthResponse } from "@radar/contracts";
import type { AppLogger } from "@radar/observability";

export const API_VERSION = "0.1.0";

export interface BuildApiOptions {
  readonly logger: AppLogger;
  readonly now?: () => Date;
  readonly uptime?: () => number;
  readonly version?: string;
}

export const buildApi = (options: BuildApiOptions) => {
  const now = options.now ?? (() => new Date());
  const uptime = options.uptime ?? (() => process.uptime());
  const version = options.version ?? API_VERSION;
  const app = Fastify({
    loggerInstance: options.logger,
  });

  app.get<{ Reply: HealthResponse }>("/health", () =>
    HealthResponseSchema.parse({
      service: "api",
      status: "ok",
      timestamp: now().toISOString(),
      uptimeSeconds: uptime(),
      version,
    }),
  );

  return app;
};
