import { describe, expect, it } from "vitest";

import { ConfigurationError, loadBotConfig } from "../src/index.js";

const BOT_TOKEN = `123456:${"a".repeat(40)}`;

describe("loadBotConfig", () => {
  it("loads bounded long-polling defaults without exposing unrelated environment", () => {
    expect(loadBotConfig({ TELEGRAM_BOT_TOKEN: BOT_TOKEN })).toEqual({
      databaseUrl: "postgresql://radar_runtime:radar_runtime_local@127.0.0.1:54329/radar",
      logLevel: "info",
      nodeEnv: "development",
      pollingTimeoutSeconds: 30,
      telegramBotToken: BOT_TOKEN,
    });
  });

  it("rejects a long value that is not a Telegram Bot API token", () => {
    expect(() => loadBotConfig({ TELEGRAM_BOT_TOKEN: "x".repeat(64) })).toThrow(
      /TELEGRAM_BOT_TOKEN/,
    );
  });

  it("requires a token and bounds the polling timeout", () => {
    expect(() => loadBotConfig({})).toThrow(ConfigurationError);
    expect(() =>
      loadBotConfig({
        TELEGRAM_BOT_TOKEN: BOT_TOKEN,
        TELEGRAM_POLLING_TIMEOUT_SECONDS: "51",
      }),
    ).toThrow(ConfigurationError);
  });

  it("requires an explicit database in production without leaking token values", () => {
    try {
      loadBotConfig({ NODE_ENV: "production", TELEGRAM_BOT_TOKEN: BOT_TOKEN });
      throw new Error("Expected production configuration validation to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigurationError);
      expect((error as Error).message).toContain("DATABASE_URL");
      expect((error as Error).message).not.toContain(BOT_TOKEN);
    }
  });
});
