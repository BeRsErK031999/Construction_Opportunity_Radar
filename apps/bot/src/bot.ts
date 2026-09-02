import { Bot, Keyboard, type Context } from "grammy";

import {
  type DeliveryPort,
  type DigestDeliveryPort,
  type TelegramUiRepositories,
} from "@radar/application";
import { type AppLogger } from "@radar/observability";

import {
  BotController,
  MAIN_MENU,
  MAIN_MENU_LABELS,
  type BotInteraction,
  type BotMessenger,
} from "./controller.js";

export interface BuildBotOptions {
  readonly deliveryPort: DeliveryPort & DigestDeliveryPort;
  readonly logger: AppLogger;
  readonly repositories: TelegramUiRepositories;
  readonly token: string;
}

const interaction = (context: Context): BotInteraction | null => {
  const telegramUserId = context.from?.id;
  return telegramUserId === undefined || context.chat?.type !== "private"
    ? null
    : {
        interactionId: String(context.update.update_id),
        telegramUserId: String(telegramUserId),
      };
};

export const mainMenuKeyboard = (): Keyboard =>
  Keyboard.from([
    [MAIN_MENU.newOpportunities, MAIN_MENU.digest],
    [MAIN_MENU.saved, MAIN_MENU.interests],
    [MAIN_MENU.help],
  ])
    .resized()
    .persistent();

export interface BuiltRadarBot {
  readonly bot: Bot;
  readonly controller: BotController;
}

export const buildRadarBot = (options: BuildBotOptions): BuiltRadarBot => {
  const bot = new Bot(options.token);
  const messenger: BotMessenger = {
    async answerCallback(input) {
      await bot.api.answerCallbackQuery(input.callbackQueryId, {
        ...(input.showAlert === undefined ? {} : { show_alert: input.showAlert }),
        text: input.text,
      });
    },
    async sendText(input) {
      await bot.api.sendMessage(input.recipientExternalId, input.text, {
        ...(input.mainMenu === true ? { reply_markup: mainMenuKeyboard() } : {}),
      });
    },
  };
  const controller = new BotController({
    deliveryPort: options.deliveryPort,
    messenger,
    repositories: options.repositories,
  });

  const withInteraction = async (
    context: Context,
    handler: (value: BotInteraction) => Promise<void>,
  ): Promise<void> => {
    const value = interaction(context);
    if (value !== null) {
      await handler(value);
    }
  };

  bot.command("start", async (context) => {
    await withInteraction(context, async (value) => controller.start(value));
  });
  bot.command("help", async (context) => {
    await withInteraction(context, async (value) => controller.menu(value, MAIN_MENU.help));
  });
  bot.command("opportunities", async (context) => {
    await withInteraction(context, async (value) =>
      controller.menu(value, MAIN_MENU.newOpportunities),
    );
  });
  for (const label of MAIN_MENU_LABELS) {
    bot.hears(label, async (context) => {
      await withInteraction(context, async (value) => controller.menu(value, label));
    });
  }
  bot.on("callback_query:data", async (context) => {
    const value = interaction(context);
    if (value !== null) {
      await controller.callback(
        { ...value, callbackQueryId: context.callbackQuery.id },
        context.callbackQuery.data,
      );
    }
  });
  bot.on("message:text", async (context) => {
    await withInteraction(context, async (value) => controller.menu(value, MAIN_MENU.help));
  });

  bot.catch((error) => {
    options.logger.error(
      { err: error.error, event: "telegram.update_failed", updateId: error.ctx.update.update_id },
      "Telegram update failed",
    );
  });

  return Object.freeze({ bot, controller });
};
