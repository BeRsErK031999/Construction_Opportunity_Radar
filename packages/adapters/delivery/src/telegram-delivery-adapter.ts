import {
  DeliveryTransportError,
  type DigestDeliveryPort,
  type DigestMessageDelivery,
  type DeliveryPort,
  type OpportunityCardDelivery,
} from "@radar/application";

export const TELEGRAM_TEXT_LIMIT = 4_096;
export const TELEGRAM_CALLBACK_DATA_LIMIT_BYTES = 64;

export type TelegramInlineButton =
  | { readonly callback_data: string; readonly text: string }
  | { readonly text: string; readonly url: string };

export interface TelegramSendMessageOptions {
  readonly link_preview_options: { readonly is_disabled: true };
  readonly parse_mode: "HTML";
  readonly reply_markup?: {
    readonly inline_keyboard: readonly (readonly TelegramInlineButton[])[];
  };
}

export interface TelegramMessageClient {
  sendMessage(
    chatId: string,
    text: string,
    options: TelegramSendMessageOptions,
  ): Promise<{ readonly message_id: number }>;
}

const escapedCharacter = (character: string): string => {
  if (character === "&") {
    return "&amp;";
  }
  if (character === "<") {
    return "&lt;";
  }
  if (character === ">") {
    return "&gt;";
  }
  if (character === '"') {
    return "&quot;";
  }
  return character;
};

const escapeHtml = (value: string): string => {
  let escaped = "";
  for (const character of value) {
    escaped += escapedCharacter(character);
  }
  return escaped;
};

const escapeAndTruncate = (value: string, maximum: number): string => {
  const chunks: string[] = [];
  let escapedLength = 0;
  for (const character of value) {
    const next = escapedCharacter(character);
    if (escapedLength + next.length > maximum) {
      while (escapedLength + 1 > maximum) {
        const removed = chunks.pop();
        if (removed === undefined) {
          return "";
        }
        escapedLength -= removed.length;
      }
      return `${chunks.join("").trimEnd()}…`;
    }
    chunks.push(next);
    escapedLength += next.length;
  }
  return chunks.join("");
};

const verticalName = (vertical: OpportunityCardDelivery["card"]["vertical"]): string => {
  if (vertical === "CONSTRUCTION") {
    return "Строительство";
  }
  if (vertical === "HORECA") {
    return "HoReCa";
  }
  return "Другое";
};

export const feedbackCallbackData = (
  action: "a" | "k" | "n" | "s" | "u",
  deliveryId: string,
): string => `fb:${action}:${deliveryId}`;

export const telegramOpportunityKeyboard = (
  deliveryId: string,
  sourceUrl: string,
): NonNullable<TelegramSendMessageOptions["reply_markup"]> => ({
  inline_keyboard: [
    [
      { callback_data: feedbackCallbackData("u", deliveryId), text: "👍 Полезно" },
      { callback_data: feedbackCallbackData("n", deliveryId), text: "👎 Не полезно" },
    ],
    [{ callback_data: feedbackCallbackData("s", deliveryId), text: "⭐ Сохранить" }],
    [
      { callback_data: feedbackCallbackData("a", deliveryId), text: "✅ Взяли в работу" },
      { callback_data: feedbackCallbackData("k", deliveryId), text: "🙈 Уже знали" },
    ],
    [{ text: "🔗 Открыть источник", url: sourceUrl }],
  ],
});

export const renderTelegramOpportunity = (card: OpportunityCardDelivery["card"]): string => {
  const actions = [...card.actions]
    .sort((left, right) => left.priority - right.priority)
    .slice(0, 3)
    .map(
      (action, index) =>
        `${String(index + 1)}. ${escapeAndTruncate(action.title, 120)} — ${escapeAndTruncate(
          action.rationale,
          140,
        )}`,
    )
    .join("\n");
  const sources = card.sources
    .slice(0, 3)
    .map((source) => `• ${escapeAndTruncate(source.sourceName, 80)}`)
    .join("\n");
  const text = [
    `🔥 <b>Возможность: ${String(Math.round(card.score))}/100</b>`,
    escapeAndTruncate(verticalName(card.vertical), 40),
    "",
    `<b>${escapeAndTruncate(card.headline, 240)}</b>`,
    escapeAndTruncate(card.summary, 600),
    "",
    "<b>Почему важно:</b>",
    escapeAndTruncate(card.whyImportant, 600),
    "",
    "<b>Что рекомендуем:</b>",
    actions,
    "",
    "<b>Источники:</b>",
    sources,
  ].join("\n");
  return text;
};

const digestItemText = (item: DigestMessageDelivery["view"]["items"][number]): string => {
  const primarySource = item.opportunity.sources[0];
  if (primarySource === undefined) {
    throw new DeliveryTransportError(
      "TELEGRAM_DIGEST_ITEM_WITHOUT_SOURCE",
      "Рекомендация дайджеста не содержит ссылку на источник",
      false,
    );
  }
  const firstAction = [...item.opportunity.recommendation.recommendedActions].sort(
    (left, right) => left.priority - right.priority,
  )[0];
  const category = item.opportunity.signal.category.replaceAll("_", " ");
  const sourceUrl = escapeHtml(primarySource.canonicalUrl);
  if (sourceUrl.length > 1_000) {
    throw new DeliveryTransportError(
      "TELEGRAM_DIGEST_SOURCE_URL_TOO_LONG",
      "Ссылка на источник в дайджесте превышает безопасный лимит",
      false,
    );
  }
  return [
    `${String(item.rank)}. <b>${String(Math.round(item.opportunity.recommendation.totalScore))}/100 · ${escapeAndTruncate(category, 80)}</b>`,
    escapeAndTruncate(item.opportunity.analysis.headline, 180),
    ...(firstAction === undefined
      ? []
      : [`Действие: ${escapeAndTruncate(firstAction.title, 120)}`]),
    `<a href="${sourceUrl}">${escapeAndTruncate(primarySource.sourceName, 80)}</a>`,
  ].join("\n");
};

export const renderTelegramDigest = (input: DigestMessageDelivery["view"]): string => {
  const summary = input.digest.weeklySummary;
  const inclusivePeriodEnd = new Date(Date.parse(input.digest.periodEnd) - 1).toISOString();
  const weeklyLines =
    summary === null
      ? []
      : [
          `Обработано: ${String(summary.processed)}`,
          `Уникальных: ${String(summary.unique)}`,
          `Релевантных сигналов: ${String(summary.relevant)}`,
          `Возможностей: ${String(summary.opportunities)}`,
          `Высокий приоритет: ${String(summary.highPriority)}`,
          ...(summary.categoryTrends.length === 0
            ? ["Растущие категории: нет подтверждённого роста"]
            : [
                "Растущие категории:",
                ...summary.categoryTrends.map(
                  (trend) =>
                    `• ${escapeAndTruncate(trend.category.replaceAll("_", " "), 100)}: +${String(trend.delta)}`,
                ),
              ]),
        ];
  return [
    input.digest.kind === "DAILY" ? "📊 <b>Главные возможности дня</b>" : "📊 <b>Итоги недели</b>",
    input.digest.kind === "DAILY"
      ? `${input.digest.periodStart.slice(0, 10)} UTC`
      : `${input.digest.periodStart.slice(0, 10)} — ${inclusivePeriodEnd.slice(0, 10)} UTC`,
    ...weeklyLines,
    "",
    ...input.items.flatMap((item) => [digestItemText(item), ""]),
  ]
    .join("\n")
    .trimEnd();
};

export class TelegramDeliveryAdapter implements DeliveryPort, DigestDeliveryPort {
  readonly #client: TelegramMessageClient;

  constructor(client: TelegramMessageClient) {
    this.#client = client;
  }

  async sendOpportunity(
    input: OpportunityCardDelivery,
  ): Promise<{ readonly providerMessageId: string }> {
    try {
      const primarySource = input.card.sources[0];
      if (primarySource === undefined) {
        throw new DeliveryTransportError(
          "TELEGRAM_CARD_WITHOUT_SOURCE",
          "Карточка возможности не содержит ссылку на источник",
          false,
        );
      }
      const text = renderTelegramOpportunity(input.card);
      if (text.length > TELEGRAM_TEXT_LIMIT) {
        throw new DeliveryTransportError(
          "TELEGRAM_CARD_TOO_LONG",
          "Карточка возможности превышает лимит Telegram",
          false,
        );
      }
      const response = await this.#client.sendMessage(input.recipientExternalId, text, {
        link_preview_options: { is_disabled: true },
        parse_mode: "HTML",
        reply_markup: telegramOpportunityKeyboard(
          input.card.deliveryId,
          primarySource.canonicalUrl,
        ),
      });
      return Object.freeze({ providerMessageId: String(response.message_id) });
    } catch (error) {
      if (error instanceof DeliveryTransportError) {
        throw error;
      }
      throw new DeliveryTransportError(
        "TELEGRAM_SEND_FAILED",
        "Telegram не принял карточку возможности",
        true,
      );
    }
  }

  async sendDigest(input: DigestMessageDelivery): Promise<{ readonly providerMessageId: string }> {
    try {
      const text = renderTelegramDigest(input.view);
      if (text.length > TELEGRAM_TEXT_LIMIT) {
        throw new DeliveryTransportError(
          "TELEGRAM_DIGEST_TOO_LONG",
          "Дайджест превышает лимит Telegram",
          false,
        );
      }
      const response = await this.#client.sendMessage(input.recipientExternalId, text, {
        link_preview_options: { is_disabled: true },
        parse_mode: "HTML",
      });
      return Object.freeze({ providerMessageId: String(response.message_id) });
    } catch (error) {
      if (error instanceof DeliveryTransportError) {
        throw error;
      }
      throw new DeliveryTransportError("TELEGRAM_SEND_FAILED", "Telegram не принял дайджест", true);
    }
  }
}
