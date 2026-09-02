import { describe, expect, it } from "vitest";

import { type TelegramUiRepositories } from "@radar/application";
import {
  correlationId,
  createPendingDelivery,
  createUser,
  createUserProfile,
  deliveryId,
  markDeliverySent,
  recommendationId,
  userId,
  userProfileId,
  type FeedbackAction,
} from "@radar/core";
import { FakeDeliveryAdapter } from "@radar/delivery-adapters";

import {
  BotController,
  MAIN_MENU,
  MAIN_MENU_LABELS,
  type BotMessenger,
} from "../src/controller.js";
import { mainMenuKeyboard } from "../src/bot.js";
import { deterministicUuid } from "../src/identity.js";

const NOW = "2026-09-02T00:00:00.000Z";
const USER_ID = userId("10000000-0000-4000-8000-000000000001");
const PROFILE_ID = userProfileId("20000000-0000-4000-8000-000000000001");
const user = createUser({
  createdAt: NOW,
  id: USER_ID,
  revision: 1,
  status: "ACTIVE",
  telegramUserId: "123456789",
  updatedAt: NOW,
});
const profile = createUserProfile({
  companySize: "SMALL",
  companyType: "Поставщик",
  createdAt: NOW,
  id: PROFILE_ID,
  keywords: ["тендер"],
  regions: ["Алтайский край"],
  revision: 1,
  servicesAndProducts: ["Бетон"],
  updatedAt: NOW,
  userId: USER_ID,
  verticals: ["CONSTRUCTION"],
});

const dependencies = () => {
  const messages: Parameters<BotMessenger["sendText"]>[0][] = [];
  const answers: Parameters<BotMessenger["answerCallback"]>[0][] = [];
  const messenger: BotMessenger = {
    answerCallback(input) {
      answers.push(input);
      return Promise.resolve();
    },
    sendText(input) {
      messages.push(input);
      return Promise.resolve();
    },
  };
  const repositories: TelegramUiRepositories = {
    deliveries: {
      findById() {
        return Promise.resolve(null);
      },
      findByIdempotencyKey() {
        return Promise.resolve(null);
      },
      save(delivery) {
        return Promise.resolve(delivery);
      },
    },
    feedback: {
      findRecommendationForUser() {
        return Promise.resolve(null);
      },
      save(feedback) {
        return Promise.resolve({ created: true, feedback });
      },
    },
    profiles: {
      findLatest(id) {
        return Promise.resolve(id === USER_ID ? { profile, user } : null);
      },
      save() {
        return Promise.resolve(null);
      },
    },
    saved: {
      listSavedForUser() {
        return Promise.resolve([]);
      },
    },
    signals: {
      findForUser() {
        return Promise.resolve(null);
      },
      listForUser() {
        return Promise.resolve({ items: [], nextCursor: null });
      },
    },
    users: {
      findByTelegramUserId(telegramUserId) {
        return Promise.resolve(telegramUserId === user.telegramUserId ? user : null);
      },
    },
  };
  return {
    answers,
    controller: new BotController({
      deliveryPort: new FakeDeliveryAdapter(),
      messenger,
      now: () => NOW,
      repositories,
    }),
    messages,
    repositories,
  };
};

const interaction = { interactionId: "42", telegramUserId: user.telegramUserId };

describe("Telegram bot controller", () => {
  it("exposes the exact five-item MVP menu and welcomes a registered user", async () => {
    const state = dependencies();

    await state.controller.start(interaction);

    expect(MAIN_MENU_LABELS).toEqual([
      "🔥 Новые возможности",
      "📊 Дайджест",
      "⭐ Сохраненные",
      "⚙️ Мои интересы",
      "ℹ️ Помощь",
    ]);
    expect(mainMenuKeyboard().keyboard).toEqual([
      [{ text: "🔥 Новые возможности" }, { text: "📊 Дайджест" }],
      [{ text: "⭐ Сохраненные" }, { text: "⚙️ Мои интересы" }],
      [{ text: "ℹ️ Помощь" }],
    ]);
    expect(state.messages).toMatchObject([
      { mainMenu: true, recipientExternalId: user.telegramUserId },
    ]);
    expect(state.messages[0]?.text).toContain("Радар возможностей готов");
  });

  it("shows profile interests and honest placeholders for not-yet-built digest behavior", async () => {
    const state = dependencies();

    await state.controller.menu(interaction, MAIN_MENU.interests);
    await state.controller.menu(interaction, MAIN_MENU.digest);
    await state.controller.menu(interaction, MAIN_MENU.saved);

    expect(state.messages[0]?.text).toContain("Алтайский край");
    expect(state.messages[0]?.text).toContain("Бетон");
    expect(state.messages[1]?.text).toContain("ещё не включён");
    expect(state.messages[2]?.text).toContain("Сохранённых возможностей пока нет");
  });

  it("returns an actionable message for an unknown closed-MVP user", async () => {
    const state = dependencies();

    await state.controller.start({ interactionId: "43", telegramUserId: "missing" });

    expect(state.messages[0]?.text).toContain("Профиль не найден");
    expect(state.messages[0]?.text).toContain("закрытый MVP");
  });

  it("always answers malformed callbacks without touching persistence", async () => {
    const state = dependencies();

    await state.controller.callback({ ...interaction, callbackQueryId: "callback-1" }, "unknown");

    expect(state.answers).toEqual([
      {
        callbackQueryId: "callback-1",
        showAlert: true,
        text: "Кнопка устарела. Откройте карточку заново.",
      },
    ]);
  });

  it("maps the acted and already-known callbacks to attributable feedback", async () => {
    const state = dependencies();
    const savedActions: FeedbackAction[] = [];
    const sentDelivery = markDeliverySent(
      createPendingDelivery({
        channel: "TELEGRAM",
        correlationId: correlationId("70000000-0000-4000-8000-000000000001"),
        createdAt: NOW,
        id: deliveryId("30000000-0000-4000-8000-000000000001"),
        idempotencyKey: "controller-feedback",
        kind: "OPPORTUNITY",
        recommendationId: recommendationId("40000000-0000-4000-8000-000000000001"),
        userId: USER_ID,
      }),
      "message-1",
      NOW,
    );
    state.controller = new BotController({
      deliveryPort: new FakeDeliveryAdapter(),
      messenger: {
        answerCallback(input) {
          state.answers.push(input);
          return Promise.resolve();
        },
        sendText() {
          return Promise.resolve();
        },
      },
      now: () => NOW,
      repositories: {
        ...state.repositories,
        deliveries: {
          ...state.repositories.deliveries,
          findById() {
            return Promise.resolve(sentDelivery);
          },
        },
        feedback: {
          ...state.repositories.feedback,
          save(feedback) {
            savedActions.push(feedback.action);
            return Promise.resolve({ created: true, feedback });
          },
        },
      },
    });

    await state.controller.callback(
      { ...interaction, callbackQueryId: "callback-acted" },
      `fb:a:${sentDelivery.id}`,
    );
    await state.controller.callback(
      { ...interaction, callbackQueryId: "callback-known" },
      `fb:k:${sentDelivery.id}`,
    );

    expect(savedActions).toEqual(["ACTED", "ALREADY_KNOWN"]);
    expect(state.answers.map((answer) => answer.text)).toEqual([
      "Отмечено: взяли в работу",
      "Спасибо, учтём: уже знали",
    ]);
  });

  it("answers callbacks even when persistence fails unexpectedly", async () => {
    const state = dependencies();
    state.controller = new BotController({
      deliveryPort: new FakeDeliveryAdapter(),
      messenger: {
        answerCallback(input) {
          state.answers.push(input);
          return Promise.resolve();
        },
        sendText() {
          return Promise.resolve();
        },
      },
      now: () => NOW,
      repositories: {
        ...state.repositories,
        deliveries: {
          ...state.repositories.deliveries,
          findById() {
            return Promise.reject(new Error("database unavailable"));
          },
        },
      },
    });

    await expect(
      state.controller.callback(
        { ...interaction, callbackQueryId: "callback-2" },
        "fb:u:30000000-0000-4000-8000-000000000001",
      ),
    ).rejects.toThrow("database unavailable");
    expect(state.answers).toEqual([
      {
        callbackQueryId: "callback-2",
        showAlert: true,
        text: "Сервис временно недоступен. Повторите запрос позже.",
      },
    ]);
  });

  it("derives a stable UUID from a Telegram callback id without storing the raw id", () => {
    const first = deterministicUuid("telegram-feedback", "callback-private-value");

    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(deterministicUuid("telegram-feedback", "callback-private-value")).toBe(first);
    expect(first).not.toContain("callback-private-value");
  });
});
