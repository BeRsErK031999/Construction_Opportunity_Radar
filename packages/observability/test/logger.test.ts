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
        database_url: "postgresql://user:secret@database/radar",
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
    expect(record.database_url).toBe(REDACTED_LOG_VALUE);
    expect(request.headers.authorization).toBe(REDACTED_LOG_VALUE);
    expect(lines[0]).not.toContain("database-password");
    expect(lines[0]).not.toContain("private-token");
    expect(lines[0]).not.toContain("postgresql://");
  });

  it("sanitizes secrets embedded in nested error messages and stacks", () => {
    const lines: string[] = [];
    const logger = createLogger({
      destination: { write: (message: string) => lines.push(message) },
      level: "error",
      service: "security-test",
    });
    const databaseSecret = "postgresql://owner:production-password@database/radar";
    const bearerSecret = "Bearer a-production-token-that-must-never-be-logged";
    const error = new Error(`Failed ${databaseSecret}; authorization=${bearerSecret}`);
    Object.assign(error, { context: { client_secret: "nested-private-value" } });

    logger.error({ err: error }, "sanitization check");

    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain("production-password");
    expect(lines[0]).not.toContain("a-production-token");
    expect(lines[0]).not.toContain("nested-private-value");
    expect(lines[0]).toContain(REDACTED_LOG_VALUE);
  });
});
