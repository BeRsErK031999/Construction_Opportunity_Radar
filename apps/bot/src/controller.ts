import { randomUUID } from "node:crypto";

import {
  BotApplicationError,
  deliverTelegramOpportunities,
  getTelegramUserProfile,
  submitTelegramDeliveryFeedback,
  type DeliveryPort,
  type TelegramFeedbackAction,
  type TelegramUiRepositories,
} from "@radar/application";
import { deliveryId, feedbackId, type DeliveryId } from "@radar/core";

import { deterministicUuid } from "./identity.js";

export const MAIN_MENU = {
  digest: "📊 Дайджест",
  help: "ℹ️ Помощь",
  interests: "⚙️ Мои интересы",
  newOpportunities: "🔥 Новые возможности",
  saved: "⭐ Сохраненные",
} as const;

export const MAIN_MENU_LABELS = Object.freeze([
  MAIN_MENU.newOpportunities,
  MAIN_MENU.digest,
  MAIN_MENU.saved,
  MAIN_MENU.interests,
  MAIN_MENU.help,
] as const);
export type MainMenuLabel = (typeof MAIN_MENU_LABELS)[number];

export interface BotMessenger {
  answerCallback(input: {
    readonly callbackQueryId: string;
    readonly showAlert?: boolean;
    readonly text: string;
  }): Promise<void>;
  sendText(input: {
    readonly mainMenu?: boolean;
    readonly recipientExternalId: string;
    readonly text: string;
  }): Promise<void>;
}

export interface BotInteraction {
  readonly interactionId: string;
  readonly telegramUserId: string;
}

export interface BotCallbackInteraction extends BotInteraction {
  readonly callbackQueryId: string;
}

export interface BotControllerOptions {
  readonly deliveryIdFactory?: () => DeliveryId;
  readonly deliveryPort: DeliveryPort;
  readonly messenger: BotMessenger;
  readonly now?: () => string;
  readonly repositories: TelegramUiRepositories;
}

const feedbackActions: Readonly<Record<"n" | "s" | "u", TelegramFeedbackAction>> = {
  n: "NOT_USEFUL",
  s: "SAVED",
  u: "USEFUL",
};

const feedbackConfirmation: Readonly<Record<TelegramFeedbackAction, string>> = {
  NOT_USEFUL: "Спасибо, учтём: не полезно",
  SAVED: "Возможность сохранена",
  USEFUL: "Спасибо за оценку",
};

const expectedErrorMessage = (error: unknown): string | null =>
  error instanceof BotApplicationError ? error.message : null;

const TEMPORARY_FAILURE_MESSAGE = "Сервис временно недоступен. Повторите запрос позже.";

const profileText = (profile: Awaited<ReturnType<typeof getTelegramUserProfile>>): string => {
  const verticals = profile.verticals
    .map((vertical) => (vertical === "CONSTRUCTION" ? "Строительство" : "HoReCa"))
    .join(", ");
  return [
    "⚙️ Мои интересы",
    `Отрасли: ${verticals}`,
    `Регионы: ${profile.regions.join(", ")}`,
    `Продукты и услуги: ${profile.servicesAndProducts.join(", ")}`,
    `Ключевые слова: ${profile.keywords.length === 0 ? "не заданы" : profile.keywords.join(", ")}`,
    "",
    "Изменение профиля через Telegram появится в следующем шаге onboarding.",
  ].join("\n");
};

export class BotController {
  readonly #deliveryIdFactory: () => DeliveryId;
  readonly #deliveryPort: DeliveryPort;
  readonly #messenger: BotMessenger;
  readonly #now: () => string;
  readonly #repositories: TelegramUiRepositories;

  constructor(options: BotControllerOptions) {
    this.#deliveryIdFactory = options.deliveryIdFactory ?? (() => deliveryId(randomUUID()));
    this.#deliveryPort = options.deliveryPort;
    this.#messenger = options.messenger;
    this.#now = options.now ?? (() => new Date().toISOString());
    this.#repositories = options.repositories;
  }

  async start(interaction: BotInteraction): Promise<void> {
    try {
      await getTelegramUserProfile({
        repositories: this.#repositories,
        telegramUserId: interaction.telegramUserId,
      });
      await this.#messenger.sendText({
        mainMenu: true,
        recipientExternalId: interaction.telegramUserId,
        text: [
          "Радар возможностей готов.",
          "",
          "Здесь только персональные карточки с объяснимой оценкой, конкретными действиями и ссылкой на источник.",
        ].join("\n"),
      });
    } catch (error) {
      const message = expectedErrorMessage(error);
      if (message === null) {
        await this.#messenger.sendText({
          recipientExternalId: interaction.telegramUserId,
          text: TEMPORARY_FAILURE_MESSAGE,
        });
        throw error;
      }
      await this.#messenger.sendText({
        recipientExternalId: interaction.telegramUserId,
        text: message,
      });
    }
  }

  async menu(interaction: BotInteraction, label: MainMenuLabel): Promise<void> {
    if (label === MAIN_MENU.help) {
      await this.#messenger.sendText({
        mainMenu: true,
        recipientExternalId: interaction.telegramUserId,
        text: [
          "ℹ️ Радар отбирает разрешённые отраслевые сигналы и объясняет их применительно к вашему профилю.",
          "",
          "Откройте «Новые возможности», изучите факты и перейдите к первоисточнику. Оценка и сохранение помогают улучшать выдачу.",
        ].join("\n"),
      });
      return;
    }
    if (label === MAIN_MENU.digest) {
      await this.#messenger.sendText({
        mainMenu: true,
        recipientExternalId: interaction.telegramUserId,
        text: "Автоматический дайджест ещё не включён. Сейчас используйте «🔥 Новые возможности» — там доступна актуальная персональная выдача.",
      });
      return;
    }

    try {
      if (label === MAIN_MENU.interests) {
        const profile = await getTelegramUserProfile({
          repositories: this.#repositories,
          telegramUserId: interaction.telegramUserId,
        });
        await this.#messenger.sendText({
          mainMenu: true,
          recipientExternalId: interaction.telegramUserId,
          text: profileText(profile),
        });
        return;
      }

      const result = await deliverTelegramOpportunities({
        deliveryIdFactory: this.#deliveryIdFactory,
        interactionId: interaction.interactionId,
        mode: label === MAIN_MENU.saved ? "SAVED" : "NEW",
        now: this.#now,
        port: this.#deliveryPort,
        repositories: this.#repositories,
        telegramUserId: interaction.telegramUserId,
      });
      if (result.opportunities === 0) {
        await this.#messenger.sendText({
          mainMenu: true,
          recipientExternalId: interaction.telegramUserId,
          text:
            label === MAIN_MENU.saved
              ? "Сохранённых возможностей пока нет. Нажмите «⭐ Сохранить» под нужной карточкой."
              : "Новых возможностей для текущего профиля пока нет. Попробуйте позже.",
        });
        return;
      }
      const failed = result.deliveries.filter((delivery) => delivery.status === "FAILED").length;
      if (failed > 0) {
        await this.#messenger.sendText({
          mainMenu: true,
          recipientExternalId: interaction.telegramUserId,
          text: `Не удалось отправить карточек: ${String(failed)}. Повторите запрос позже.`,
        });
      }
    } catch (error) {
      const message = expectedErrorMessage(error);
      if (message === null) {
        await this.#messenger.sendText({
          mainMenu: true,
          recipientExternalId: interaction.telegramUserId,
          text: TEMPORARY_FAILURE_MESSAGE,
        });
        throw error;
      }
      await this.#messenger.sendText({
        mainMenu: true,
        recipientExternalId: interaction.telegramUserId,
        text: message,
      });
    }
  }

  async callback(interaction: BotCallbackInteraction, data: string): Promise<void> {
    const match =
      /^fb:([nsu]):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i.exec(
        data,
      );
    if (match === null) {
      await this.#messenger.answerCallback({
        callbackQueryId: interaction.callbackQueryId,
        showAlert: true,
        text: "Кнопка устарела. Откройте карточку заново.",
      });
      return;
    }
    const actionCode = match[1]?.toLowerCase() as "n" | "s" | "u";
    const deliveryIdentifier = match[2];
    if (deliveryIdentifier === undefined) {
      throw new Error("Matched feedback callback has no delivery identifier");
    }
    try {
      const action = feedbackActions[actionCode];
      const result = await submitTelegramDeliveryFeedback({
        action,
        deliveryId: deliveryId(deliveryIdentifier),
        feedbackId: feedbackId(deterministicUuid("telegram-feedback", interaction.callbackQueryId)),
        now: this.#now(),
        repositories: this.#repositories,
        telegramUserId: interaction.telegramUserId,
      });
      await this.#messenger.answerCallback({
        callbackQueryId: interaction.callbackQueryId,
        text: result.created ? feedbackConfirmation[action] : "Уже сохранено",
      });
    } catch (error) {
      const message = expectedErrorMessage(error);
      if (message === null) {
        await this.#messenger.answerCallback({
          callbackQueryId: interaction.callbackQueryId,
          showAlert: true,
          text: TEMPORARY_FAILURE_MESSAGE,
        });
        throw error;
      }
      await this.#messenger.answerCallback({
        callbackQueryId: interaction.callbackQueryId,
        showAlert: true,
        text: message,
      });
    }
  }
}
