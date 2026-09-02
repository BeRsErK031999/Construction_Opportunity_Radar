import {
  type CorrelationId,
  type DeliveryId,
  type RecommendationId,
  type UserId,
} from "../shared/identifiers.js";
import { assertInvariant } from "../shared/invariant.js";
import {
  assertTimestampOrder,
  isoDateTime,
  nonEmptyString,
  optionalString,
  type IsoDateTime,
} from "../shared/primitives.js";

export const DELIVERY_CHANNELS = ["TELEGRAM"] as const;
export type DeliveryChannel = (typeof DELIVERY_CHANNELS)[number];

export const DELIVERY_KINDS = ["OPPORTUNITY"] as const;
export type DeliveryKind = (typeof DELIVERY_KINDS)[number];

export const DELIVERY_STATUSES = ["PENDING", "SENT", "FAILED"] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

export interface Delivery {
  readonly channel: DeliveryChannel;
  readonly correlationId: CorrelationId;
  readonly createdAt: IsoDateTime;
  readonly failureCode: string | null;
  readonly failureReason: string | null;
  readonly id: DeliveryId;
  readonly idempotencyKey: string;
  readonly kind: DeliveryKind;
  readonly providerMessageId: string | null;
  readonly recommendationId: RecommendationId;
  readonly status: DeliveryStatus;
  readonly updatedAt: IsoDateTime;
  readonly userId: UserId;
}

interface CreateDeliveryInput {
  readonly channel: DeliveryChannel;
  readonly correlationId: CorrelationId;
  readonly createdAt: string;
  readonly failureCode?: string | null;
  readonly failureReason?: string | null;
  readonly id: DeliveryId;
  readonly idempotencyKey: string;
  readonly kind: DeliveryKind;
  readonly providerMessageId?: string | null;
  readonly recommendationId: RecommendationId;
  readonly status: DeliveryStatus;
  readonly updatedAt: string;
  readonly userId: UserId;
}

export const createDelivery = (input: CreateDeliveryInput): Delivery => {
  const createdAt = isoDateTime(input.createdAt, "createdAt");
  const updatedAt = isoDateTime(input.updatedAt, "updatedAt");
  const providerMessageId = optionalString(input.providerMessageId, "providerMessageId", 200);
  const failureCode = optionalString(input.failureCode, "failureCode", 100);
  const failureReason = optionalString(input.failureReason, "failureReason", 2_000);
  assertTimestampOrder(createdAt, updatedAt, "updatedAt");

  if (input.status === "PENDING") {
    assertInvariant(
      providerMessageId === null && failureCode === null && failureReason === null,
      "INVALID_PENDING_DELIVERY",
      "Pending delivery cannot have provider or failure outcome",
    );
  } else if (input.status === "SENT") {
    assertInvariant(
      providerMessageId !== null && failureCode === null && failureReason === null,
      "INVALID_SENT_DELIVERY",
      "Sent delivery requires a provider message and no failure",
    );
  } else {
    assertInvariant(
      providerMessageId === null && failureCode !== null && failureReason !== null,
      "INVALID_FAILED_DELIVERY",
      "Failed delivery requires a safe failure code and reason",
    );
  }

  return Object.freeze({
    channel: input.channel,
    correlationId: input.correlationId,
    createdAt,
    failureCode,
    failureReason,
    id: input.id,
    idempotencyKey: nonEmptyString(input.idempotencyKey, "idempotencyKey", 200),
    kind: input.kind,
    providerMessageId,
    recommendationId: input.recommendationId,
    status: input.status,
    updatedAt,
    userId: input.userId,
  });
};

export const createPendingDelivery = (
  input: Omit<
    CreateDeliveryInput,
    "failureCode" | "failureReason" | "providerMessageId" | "status" | "updatedAt"
  >,
): Delivery => createDelivery({ ...input, status: "PENDING", updatedAt: input.createdAt });

export const markDeliverySent = (
  delivery: Delivery,
  providerMessageId: string,
  updatedAt: string,
): Delivery =>
  createDelivery({
    ...delivery,
    failureCode: null,
    failureReason: null,
    providerMessageId,
    status: "SENT",
    updatedAt,
  });

export const markDeliveryFailed = (
  delivery: Delivery,
  failureCode: string,
  failureReason: string,
  updatedAt: string,
): Delivery =>
  createDelivery({
    ...delivery,
    failureCode,
    failureReason,
    providerMessageId: null,
    status: "FAILED",
    updatedAt,
  });

export const deliveryIdentityKey = (delivery: Delivery): string =>
  JSON.stringify([delivery.channel, delivery.idempotencyKey]);
