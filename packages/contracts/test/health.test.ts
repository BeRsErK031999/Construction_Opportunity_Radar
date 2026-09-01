import { describe, expect, it } from "vitest";

import { HealthResponseSchema } from "../src/index.js";

describe("HealthResponseSchema", () => {
  it("accepts the versioned API health response", () => {
    expect(
      HealthResponseSchema.parse({
        service: "api",
        status: "ok",
        timestamp: "2026-09-01T00:00:00.000Z",
        uptimeSeconds: 1.25,
        version: "0.1.0",
      }),
    ).toEqual({
      service: "api",
      status: "ok",
      timestamp: "2026-09-01T00:00:00.000Z",
      uptimeSeconds: 1.25,
      version: "0.1.0",
    });
  });

  it("rejects unknown fields and invalid timestamps", () => {
    expect(
      HealthResponseSchema.safeParse({
        debug: true,
        service: "api",
        status: "ok",
        timestamp: "today",
        uptimeSeconds: 1,
        version: "0.1.0",
      }).success,
    ).toBe(false);
  });
});
