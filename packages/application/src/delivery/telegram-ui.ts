import {
  createFeedback,
  createPendingDelivery,
  markDeliveryFailed,
  markDeliverySent,
  type Delivery,
  type DeliveryId,
  type Feedback,
  type FeedbackId,
  type User,
  type UserId,
  type UserProfile,
} from "@radar/core";

import {
  FeedbackWriteConflictError,
  type FeedbackRepository,
  type FeedbackSaveResult,
  type SignalOpportunity,
  type SignalOpportunityRepository,
  type UserProfileRepository,
} from "../api/application-api.js";

export const TELEGRAM_FEEDBACK_ACTIONS = [
  "USEFUL",
  "NOT_USEFUL",
  "SAVED",
  "ACTED",
  "ALREADY_KNOWN",
] as const;
export type TelegramFeedbackAction = (typeof TELEGRAM_FEEDBACK_ACTIONS)[number];

export type BotApplicationErrorCode =
  "DELIVERY_NOT_FOUND" | "FEEDBACK_CONFLICT" | "INACTIVE_USER" | "USER_NOT_REGISTERED";

export class BotApplicationError extends Error {
  readonly code: BotApplicationErrorCode;

  constructor(code: BotApplicationErrorCode, message: string) {
    super(message);
    this.name = "BotApplicationError";
    this.code = code;
  }
}

export class DeliveryWriteConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DeliveryWriteConflictError";
  }
}

export class DeliveryTransportError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(code: string, message: string, retryable: boolean) {
    super(message);
    this.name = "DeliveryTransportError";
    this.code = code;
    this.retryable = retryable;
  }
}

export interface TelegramUserRepository {
  findByTelegramUserId(telegramUserId: string): Promise<User | null>;
}

export interface DeliveryRepository {
  findById(id: DeliveryId): Promise<Delivery | null>;
  findByIdempotencyKey(channel: Delivery["channel"], key: string): Promise<Delivery | null>;
  save(delivery: Delivery): Promise<Delivery>;
}

export interface SavedOpportunityRepository {
  listSavedForUser(userId: UserId, limit: number): Promise<readonly SignalOpportunity[]>;
}

export interface OpportunityCardDelivery {
  readonly card: {
    readonly actions: SignalOpportunity["recommendation"]["recommendedActions"];
    readonly deliveryId: DeliveryId;
    readonly headline: string;
    readonly score: number;
    readonly sources: SignalOpportunity["sources"];
    readonly summary: string;
    readonly vertical: SignalOpportunity["signal"]["vertical"];
    readonly whyImportant: string;
  };
  readonly recipientExternalId: string;
}

export interface DeliveryPort {
  sendOpportunity(input: OpportunityCardDelivery): Promise<{ readonly providerMessageId: string }>;
}

export interface TelegramUiRepositories {
  readonly deliveries: DeliveryRepository;
  readonly feedback: FeedbackRepository;
  readonly profiles: UserProfileRepository;
  readonly saved: SavedOpportunityRepository;
  readonly signals: SignalOpportunityRepository;
  readonly users: TelegramUserRepository;
}

const activeUser = async (
  telegramUserId: string,
  repository: TelegramUserRepository,
): Promise<User> => {
  const user = await repository.findByTelegramUserId(telegramUserId);
  if (user === null) {
    throw new BotApplicationError(
      "USER_NOT_REGISTERED",
      "Профиль не найден. Попросите администратора добавить вас в закрытый MVP.",
    );
  }
  if (user.status !== "ACTIVE") {
    throw new BotApplicationError(
      "INACTIVE_USER",
      "Доступ к радару временно недоступен. Обратитесь к администратору.",
    );
  }
  return user;
};

export const getTelegramUserProfile = async (input: {
  readonly repositories: Pick<TelegramUiRepositories, "profiles" | "users">;
  readonly telegramUserId: string;
}): Promise<UserProfile> => {
  const user = await activeUser(input.telegramUserId, input.repositories.users);
  const registration = await input.repositories.profiles.findLatest(user.id);
  if (registration === null) {
    throw new BotApplicationError(
      "USER_NOT_REGISTERED",
      "Профиль интересов не найден. Обратитесь к администратору.",
    );
  }
  return registration.profile;
};

const safeDeliveryFailure = (error: unknown): { readonly code: string; readonly reason: string } =>
  error instanceof DeliveryTransportError
    ? { code: error.code, reason: error.message }
    : { code: "DELIVERY_INTERNAL_ERROR", reason: "Не удалось отправить карточку возможности" };

const deliverOpportunity = async (input: {
  readonly deliveryId: DeliveryId;
  readonly idempotencyKey: string;
  readonly now: () => string;
  readonly opportunity: SignalOpportunity;
  readonly port: DeliveryPort;
  readonly recipientExternalId: string;
  readonly repository: DeliveryRepository;
  readonly userId: UserId;
}): Promise<Delivery> => {
  const existing = await input.repository.findByIdempotencyKey("TELEGRAM", input.idempotencyKey);
  if (existing !== null) {
    return existing;
  }
  const pending = createPendingDelivery({
    channel: "TELEGRAM",
    correlationId: input.opportunity.recommendation.correlationId,
    createdAt: input.now(),
    id: input.deliveryId,
    idempotencyKey: input.idempotencyKey,
    kind: "OPPORTUNITY",
    recommendationId: input.opportunity.recommendation.id,
    userId: input.userId,
  });
  await input.repository.save(pending);

  try {
    const sent = await input.port.sendOpportunity({
      card: {
        actions: input.opportunity.recommendation.recommendedActions,
        deliveryId: pending.id,
        headline: input.opportunity.analysis.headline,
        score: input.opportunity.recommendation.totalScore,
        sources: input.opportunity.sources,
        summary: input.opportunity.analysis.summary,
        vertical: input.opportunity.signal.vertical,
        whyImportant: input.opportunity.analysis.whyImportant,
      },
      recipientExternalId: input.recipientExternalId,
    });
    return await input.repository.save(
      markDeliverySent(pending, sent.providerMessageId, input.now()),
    );
  } catch (error) {
    const failure = safeDeliveryFailure(error);
    return input.repository.save(
      markDeliveryFailed(pending, failure.code, failure.reason, input.now()),
    );
  }
};

export interface DeliverTelegramOpportunitiesResult {
  readonly deliveries: readonly Delivery[];
  readonly opportunities: number;
}

export const deliverTelegramOpportunities = async (input: {
  readonly deliveryIdFactory: () => DeliveryId;
  readonly interactionId: string;
  readonly limit?: number;
  readonly mode: "NEW" | "SAVED";
  readonly now: () => string;
  readonly port: DeliveryPort;
  readonly repositories: Pick<TelegramUiRepositories, "deliveries" | "saved" | "signals" | "users">;
  readonly telegramUserId: string;
}): Promise<DeliverTelegramOpportunitiesResult> => {
  const user = await activeUser(input.telegramUserId, input.repositories.users);
  const limit = input.limit ?? 5;
  if (!Number.isInteger(limit) || limit < 1 || limit > 5) {
    throw new RangeError("Telegram opportunity limit must be between 1 and 5");
  }
  const opportunities =
    input.mode === "NEW"
      ? (
          await input.repositories.signals.listForUser(user.id, {
            limit,
            status: "CANDIDATE",
          })
        ).items
      : await input.repositories.saved.listSavedForUser(user.id, limit);
  const deliveries: Delivery[] = [];
  for (const opportunity of opportunities) {
    deliveries.push(
      await deliverOpportunity({
        deliveryId: input.deliveryIdFactory(),
        idempotencyKey: `${input.interactionId}:${opportunity.recommendation.id}`,
        now: input.now,
        opportunity,
        port: input.port,
        recipientExternalId: input.telegramUserId,
        repository: input.repositories.deliveries,
        userId: user.id,
      }),
    );
  }
  return Object.freeze({
    deliveries: Object.freeze(deliveries),
    opportunities: opportunities.length,
  });
};

const feedbackForDelivery = (
  delivery: Delivery,
  userId: UserId,
  id: FeedbackId,
  action: TelegramFeedbackAction,
  createdAt: string,
): Feedback =>
  createFeedback({
    action,
    correlationId: delivery.correlationId,
    createdAt,
    deliveryId: delivery.id,
    id,
    recommendationId: delivery.recommendationId,
    userId,
  });

export const submitTelegramDeliveryFeedback = async (input: {
  readonly action: TelegramFeedbackAction;
  readonly deliveryId: DeliveryId;
  readonly feedbackId: FeedbackId;
  readonly now: string;
  readonly repositories: Pick<TelegramUiRepositories, "deliveries" | "feedback" | "users">;
  readonly telegramUserId: string;
}): Promise<FeedbackSaveResult> => {
  const user = await activeUser(input.telegramUserId, input.repositories.users);
  const delivery = await input.repositories.deliveries.findById(input.deliveryId);
  if (delivery?.userId !== user.id || delivery.status !== "SENT") {
    throw new BotApplicationError(
      "DELIVERY_NOT_FOUND",
      "Карточка не найдена или больше недоступна.",
    );
  }
  try {
    return await input.repositories.feedback.save(
      feedbackForDelivery(delivery, user.id, input.feedbackId, input.action, input.now),
    );
  } catch (error) {
    if (error instanceof FeedbackWriteConflictError) {
      throw new BotApplicationError(
        "FEEDBACK_CONFLICT",
        "Ответ конфликтует с ранее сохранённой оценкой.",
      );
    }
    throw error;
  }
};
