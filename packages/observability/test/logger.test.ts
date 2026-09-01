import { describe, expect, it } from "vitest";

import { createLogger, REDACTED_LOG_VALUE } from "../src/index.js";

describe("createLogger", () => {
  it("emits structured context and redacts known secret fields", () => {
    const lines: string[] = [];
    const destination = {
      write(message: string): void {
        lines.push(message);
      },
    };
    const logger = createLogger({
      destination,
      environment: "test",
      level: "info",
      service: "api-test",
    });

    logger.info(
      {
        password: "database-password",
        req: { headers: { authorization: "Bearer private-token" } },
      },
      "redaction check",
    );

    expect(lines).toHaveLength(1);
    const record = JSON.parse(lines[0] ?? "{}") as Record<string, unknown>;
    const request = record.req as { headers: { authorization: string } };

    expect(record.service).toBe("api-test");
    expect(record.environment).toBe("test");
    expect(record.password).toBe(REDACTED_LOG_VALUE);
    expect(request.headers.authorization).toBe(REDACTED_LOG_VALUE);
    expect(lines[0]).not.toContain("database-password");
    expect(lines[0]).not.toContain("private-token");
  });
});
