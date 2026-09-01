import { afterEach, describe, expect, it } from "vitest";

import { HealthResponseSchema } from "@radar/contracts";
import { createLogger } from "@radar/observability";

import { buildApi } from "../src/app.js";

const apps: ReturnType<typeof buildApi>[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map(async (app) => app.close()));
});

describe("GET /health", () => {
  it("returns a minimal validated health response without external dependencies", async () => {
    const app = buildApi({
      logger: createLogger({ level: "silent", service: "api-test" }),
      now: () => new Date("2026-09-01T00:00:00.000Z"),
      uptime: () => 12.5,
      version: "0.1.0",
    });
    apps.push(app);

    const response = await app.inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("application/json");
    expect(HealthResponseSchema.parse(response.json())).toEqual({
      service: "api",
      status: "ok",
      timestamp: "2026-09-01T00:00:00.000Z",
      uptimeSeconds: 12.5,
      version: "0.1.0",
    });
  });
});
