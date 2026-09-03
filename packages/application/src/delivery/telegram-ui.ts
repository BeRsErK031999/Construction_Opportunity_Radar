import {
  createFeedback,
  createPendingDigestDelivery,
  createPendingDelivery,
  markDigestDeliveryFailed,
  markDigestDeliverySent,
  markDeliveryFailed,
  markDeliverySent,
  type CorrelationId,
  type Delivery,
  type DeliveryId,
  type DigestDelivery,
  type DigestDeliveryId,
  type DigestId,
  type DigestKind,
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
import {
  buildDigest,
  digestPeriodFor,
  type DigestRepository,
  type DigestView,
} from "../digest/digest.js";
import {
  observeOperationalEvent,
  type OperationalObserver,
} from "../ports/operational-observer.js";

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

export interface DigestMessageDelivery {
  readonly recipientExternalId: string;
  readonly view: DigestView;
}

export interface DigestDeliveryPort {
  sendDigest(input: DigestMessageDelivery): Promise<{ readonly providerMessageId: string }>;
}

export interface DigestDeliverySaveResult {
  readonly created: boolean;
  readonly delivery: DigestDelivery;
}

export interface DigestDeliveryRepository {
  findByDigest(
    channel: DigestDelivery["channel"],
    digestId: DigestId,
  ): Promise<DigestDelivery | null>;
  findById(id: DigestDeliveryId): Promise<DigestDelivery | null>;
  save(delivery: DigestDelivery): Promise<DigestDeliverySaveResult>;
}

export interface TelegramUiRepositories {
  readonly digestDeliveries: DigestDeliveryRepository;
  readonly digests: DigestRepository;
  readonly deliveries: DeliveryRepository;
  readonly feedback: FeedbackRepository;
  readonly profiles: UserProfileRepository;
  readonly saved: SavedOpportunityRepository;
  readonly signals: SignalOpportunityRepository;
  readonly users: TelegramUserRepository;
}

export interface DeliverTelegramDigestResult {
  readonly delivery: DigestDelivery | null;
  readonly digestCreated: boolean;
  readonly deliveryCreated: boolean;
  readonly opportunities: number;
  readonly view: DigestView;
}

export const deliverTelegramDigest = async (input: {
  readonly correlationId: CorrelationId;
  readonly digestDeliveryId: DigestDeliveryId;
  readonly digestId: DigestId;
  readonly kind: DigestKind;
  readonly now: () => string;
  readonly observer?: OperationalObserver;
  readonly port: DigestDeliveryPort;
  readonly repositories: Pick<TelegramUiRepositories, "digestDeliveries" | "digests" | "users">;
  readonly telegramUserId: string;
}): Promise<DeliverTelegramDigestResult> => {
  const user = await activeUser(input.telegramUserId, input.repositories.users);
  const now = input.now();
  const built = await buildDigest({
    correlationId: input.correlationId,
    digestId: input.digestId,
    kind: input.kind,
    now,
    period: digestPeriodFor(input.kind, now),
    repository: input.repositories.digests,
    userId: user.id,
  });
  if (input.kind === "DAILY" && built.view.items.length === 0) {
    observeOperationalEvent(input.observer, {
      correlationId: input.correlationId,
      deliveryId: null,
      failureCode: null,
      kind: "DIGEST",
      name: "delivery_completed",
      opportunities: 0,
      outcome: "SKIPPED",
      reused: false,
    });
    return Object.freeze({
      delivery: null,
      deliveryCreated: false,
      digestCreated: built.created,
      opportunities: 0,
      view: built.view,
    });
  }
  const existing = await input.repositories.digestDeliveries.findByDigest(
    "TELEGRAM",
    built.view.digest.id,
  );
  if (existing !== null) {
    observeOperationalEvent(input.observer, {
      correlationId: existing.correlationId,
      deliveryId: existing.id,
      failureCode: existing.status === "FAILED" ? existing.failureCode : null,
      kind: "DIGEST",
      name: "delivery_completed",
      opportunities: built.view.items.length,
      outcome: existing.status,
      reused: true,
    });
    return Object.freeze({
      delivery: existing,
      deliveryCreated: false,
      digestCreated: built.created,
      opportunities: built.view.items.length,
      view: built.view,
    });
  }
  const savedPending = await input.repositories.digestDeliveries.save(
    createPendingDigestDelivery({
      channel: "TELEGRAM",
      correlationId: built.view.digest.correlationId,
      createdAt: now,
      digestId: built.view.digest.id,
      id: input.digestDeliveryId,
      idempotencyKey: `digest:${built.view.digest.id}`,
      userId: user.id,
    }),
  );
  if (!savedPending.created) {
    observeOperationalEvent(input.observer, {
      correlationId: savedPending.delivery.correlationId,
      deliveryId: savedPending.delivery.id,
      failureCode:
        savedPending.delivery.status === "FAILED" ? savedPending.delivery.failureCode : null,
      kind: "DIGEST",
      name: "delivery_completed",
      opportunities: built.view.items.length,
      outcome: savedPending.delivery.status,
      reused: true,
    });
    return Object.freeze({
      delivery: savedPending.delivery,
      deliveryCreated: false,
      digestCreated: built.created,
      opportunities: built.view.items.length,
      view: built.view,
    });
  }
  try {
    const sent = await input.port.sendDigest({
      recipientExternalId: input.telegramUserId,
      view: built.view,
    });
    const saved = await input.repositories.digestDeliveries.save(
      markDigestDeliverySent(savedPending.delivery, sent.providerMessageId, input.now()),
    );
    observeOperationalEvent(input.observer, {
      correlationId: saved.delivery.correlationId,
      deliveryId: saved.delivery.id,
      failureCode: null,
      kind: "DIGEST",
      name: "delivery_completed",
      opportunities: built.view.items.length,
      outcome: "SENT",
      reused: false,
    });
    return Object.freeze({
      delivery: saved.delivery,
      deliveryCreated: true,
      digestCreated: built.created,
      opportunities: built.view.items.length,
      view: built.view,
    });
  } catch (error) {
    const failure = safeDeliveryFailure(error);
    const saved = await input.repositories.digestDeliveries.save(
      markDigestDeliveryFailed(
        savedPending.delivery,
        failure.code,
        failure.reason.replace("карточку возможности", "дайджест"),
        input.now(),
      ),
    );
    observeOperationalEvent(input.observer, {
      correlationId: saved.delivery.correlationId,
      deliveryId: saved.delivery.id,
      failureCode: failure.code,
      kind: "DIGEST",
      name: "delivery_completed",
      opportunities: built.view.items.length,
      outcome: "FAILED",
      reused: false,
    });
    return Object.freeze({
      delivery: saved.delivery,
      deliveryCreated: true,
      digestCreated: built.created,
      opportunities: built.view.items.length,
      view: built.view,
    });
  }
};

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
  readonly observer?: OperationalObserver;
  readonly opportunity: SignalOpportunity;
  readonly port: DeliveryPort;
  readonly recipientExternalId: string;
  readonly repository: DeliveryRepository;
  readonly userId: UserId;
}): Promise<Delivery> => {
  const existing = await input.repository.findByIdempotencyKey("TELEGRAM", input.idempotencyKey);
  if (existing !== null) {
    observeOperationalEvent(input.observer, {
      correlationId: existing.correlationId,
      deliveryId: existing.id,
      failureCode: existing.status === "FAILED" ? existing.failureCode : null,
      kind: "OPPORTUNITY",
      name: "delivery_completed",
      opportunities: 1,
      outcome: existing.status,
      reused: true,
    });
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
    const saved = await input.repository.save(
      markDeliverySent(pending, sent.providerMessageId, input.now()),
    );
    observeOperationalEvent(input.observer, {
      correlationId: saved.correlationId,
      deliveryId: saved.id,
      failureCode: null,
      kind: "OPPORTUNITY",
      name: "delivery_completed",
      opportunities: 1,
      outcome: "SENT",
      reused: false,
    });
    return saved;
  } catch (error) {
    const failure = safeDeliveryFailure(error);
    const saved = await input.repository.save(
      markDeliveryFailed(pending, failure.code, failure.reason, input.now()),
    );
    observeOperationalEvent(input.observer, {
      correlationId: saved.correlationId,
      deliveryId: saved.id,
      failureCode: failure.code,
      kind: "OPPORTUNITY",
      name: "delivery_completed",
      opportunities: 1,
      outcome: "FAILED",
      reused: false,
    });
    return saved;
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
  readonly observer?: OperationalObserver;
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
        ...(input.observer === undefined ? {} : { observer: input.observer }),
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
