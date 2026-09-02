import { describe, expect, it } from "vitest";

import type { ApiConfig } from "@radar/config";
import { HealthResponseSchema } from "@radar/contracts";
import { createLogger } from "@radar/observability";

import { startApi } from "../src/lifecycle.js";

const testConfig: ApiConfig = {
  apiAuthToken: null,
  databaseUrl: "postgresql://radar:radar_local@127.0.0.1:54329/radar",
  host: "127.0.0.1",
  logLevel: "silent",
  nodeEnv: "test",
  port: 0,
  shutdownTimeoutMs: 2_000,
};

describe("API lifecycle", () => {
  it("starts on an ephemeral local port and closes idempotently", async () => {
    const running = await startApi({
      config: testConfig,
      installSignalHandlers: false,
      logger: createLogger({ level: "silent", service: "api-test" }),
    });

    try {
      expect(running.app.server.listening).toBe(true);
      const response = await fetch(`${running.address}/health`);

      expect(response.status).toBe(200);
      expect(HealthResponseSchema.parse(await response.json()).status).toBe("ok");
    } finally {
      await running.close("test");
    }

    expect(running.app.server.listening).toBe(false);
    await expect(running.close("test")).resolves.toBeUndefined();
  });
});
