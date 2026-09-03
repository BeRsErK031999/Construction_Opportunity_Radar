import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { loadBotConfig } from "@radar/config";
import {
  createDatabaseClient,
  PrismaDeliveryRepository,
  PrismaDigestDeliveryRepository,
  PrismaDigestRepository,
  PrismaFeedbackRepository,
  PrismaProfileRegistrationRepository,
  PrismaSignalOpportunityRepository,
} from "@radar/db";
import { TelegramDeliveryAdapter, type TelegramMessageClient } from "@radar/delivery-adapters";
import { createLogger, createOperationalTelemetry } from "@radar/observability";

import { buildRadarBot } from "./bot.js";

const SHUTDOWN_SIGNALS = ["SIGINT", "SIGTERM"] as const;

export const isMainModule = (
  moduleUrl: string,
  executablePath: string | undefined = process.argv[1],
): boolean =>
  executablePath !== undefined && moduleUrl === pathToFileURL(resolve(executablePath)).href;

export const runBot = async (): Promise<void> => {
  const config = loadBotConfig();
  const logger = createLogger({
    environment: config.nodeEnv,
    level: config.logLevel,
    service: "bot",
  });
  const client = createDatabaseClient(config.databaseUrl);
  const telemetry = createOperationalTelemetry({ logger });
  const profiles = new PrismaProfileRegistrationRepository(client);
  const signals = new PrismaSignalOpportunityRepository(client);
  const botReference: { current?: ReturnType<typeof buildRadarBot> } = {};
  const telegramClient: TelegramMessageClient = {
    async sendMessage(chatId, text, options) {
      if (botReference.current === undefined) {
        throw new Error("Telegram bot is not initialized");
      }
      const { reply_markup: replyMarkup, ...messageOptions } = options;
      const message = await botReference.current.bot.api.sendMessage(chatId, text, {
        ...messageOptions,
        ...(replyMarkup === undefined
          ? {}
          : {
              reply_markup: {
                inline_keyboard: replyMarkup.inline_keyboard.map((row) =>
                  row.map((button) => ({ ...button })),
                ),
              },
            }),
      });
      return { message_id: message.message_id };
    },
  };
  const deliveries = new PrismaDeliveryRepository(client);
  const running = buildRadarBot({
    deliveryPort: new TelegramDeliveryAdapter(telegramClient),
    logger,
    observer: telemetry,
    repositories: {
      digestDeliveries: new PrismaDigestDeliveryRepository(client),
      digests: new PrismaDigestRepository(client),
      deliveries,
      feedback: new PrismaFeedbackRepository(client),
      profiles,
      saved: signals,
      signals,
      users: profiles,
    },
    token: config.telegramBotToken,
  });
  botReference.current = running;

  let stopping = false;
  const signalHandlers = new Map<(typeof SHUTDOWN_SIGNALS)[number], () => void>();
  const stop = (signal: (typeof SHUTDOWN_SIGNALS)[number]): void => {
    if (stopping) {
      return;
    }
    stopping = true;
    logger.info({ event: "telegram_stopping", signal }, "Stopping Telegram bot");
    void running.bot.stop().catch((error: unknown) => {
      logger.error({ err: error, event: "telegram_stop_failed" }, "Telegram bot stop failed");
    });
  };
  for (const signal of SHUTDOWN_SIGNALS) {
    const handler = (): void => stop(signal);
    signalHandlers.set(signal, handler);
    process.once(signal, handler);
  }

  try {
    await running.bot.start({
      allowed_updates: ["message", "callback_query"],
      onStart: async () => {
        await running.bot.api.setMyCommands([
          { command: "start", description: "Открыть главное меню" },
          { command: "opportunities", description: "Показать новые возможности" },
          { command: "help", description: "Как пользоваться радаром" },
        ]);
        logger.info({ event: "telegram_started" }, "Telegram bot started");
      },
      timeout: config.pollingTimeoutSeconds,
    });
  } finally {
    for (const [signal, handler] of signalHandlers) {
      process.removeListener(signal, handler);
    }
    await client.$disconnect();
    logger.info(
      { event: "operational_metrics_snapshot", metrics: telemetry.metricsSnapshot() },
      "Final operational metrics snapshot",
    );
    logger.info({ event: "telegram_stopped" }, "Telegram bot stopped");
  }
};

if (isMainModule(import.meta.url)) {
  const bootstrapLogger = createLogger({ level: "info", service: "bot-bootstrap" });
  void runBot().catch((error: unknown) => {
    bootstrapLogger.fatal({ err: error, event: "telegram_start_failed" }, "Bot failed to start");
    process.exitCode = 1;
  });
}
