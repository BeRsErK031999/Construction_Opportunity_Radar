import {
  type CorrelationId,
  type DigestDeliveryId,
  type DigestId,
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
import { type DeliveryChannel, type DeliveryStatus } from "./delivery.js";

export interface DigestDelivery {
  readonly channel: DeliveryChannel;
  readonly correlationId: CorrelationId;
  readonly createdAt: IsoDateTime;
  readonly digestId: DigestId;
  readonly failureCode: string | null;
  readonly failureReason: string | null;
  readonly id: DigestDeliveryId;
  readonly idempotencyKey: string;
  readonly providerMessageId: string | null;
  readonly status: DeliveryStatus;
  readonly updatedAt: IsoDateTime;
  readonly userId: UserId;
}

interface CreateDigestDeliveryInput {
  readonly channel: DeliveryChannel;
  readonly correlationId: CorrelationId;
  readonly createdAt: string;
  readonly digestId: DigestId;
  readonly failureCode?: string | null;
  readonly failureReason?: string | null;
  readonly id: DigestDeliveryId;
  readonly idempotencyKey: string;
  readonly providerMessageId?: string | null;
  readonly status: DeliveryStatus;
  readonly updatedAt: string;
  readonly userId: UserId;
}

export const createDigestDelivery = (input: CreateDigestDeliveryInput): DigestDelivery => {
  const createdAt = isoDateTime(input.createdAt, "createdAt");
  const updatedAt = isoDateTime(input.updatedAt, "updatedAt");
  const providerMessageId = optionalString(input.providerMessageId, "providerMessageId", 200);
  const failureCode = optionalString(input.failureCode, "failureCode", 100);
  const failureReason = optionalString(input.failureReason, "failureReason", 2_000);
  assertTimestampOrder(createdAt, updatedAt, "updatedAt");
  if (input.status === "PENDING") {
    assertInvariant(
      providerMessageId === null && failureCode === null && failureReason === null,
      "INVALID_PENDING_DIGEST_DELIVERY",
      "Pending digest delivery cannot have provider or failure outcome",
    );
  } else if (input.status === "SENT") {
    assertInvariant(
      providerMessageId !== null && failureCode === null && failureReason === null,
      "INVALID_SENT_DIGEST_DELIVERY",
      "Sent digest delivery requires a provider message and no failure",
    );
  } else {
    assertInvariant(
      providerMessageId === null && failureCode !== null && failureReason !== null,
      "INVALID_FAILED_DIGEST_DELIVERY",
      "Failed digest delivery requires a safe failure code and reason",
    );
  }
  return Object.freeze({
    channel: input.channel,
    correlationId: input.correlationId,
    createdAt,
    digestId: input.digestId,
    failureCode,
    failureReason,
    id: input.id,
    idempotencyKey: nonEmptyString(input.idempotencyKey, "idempotencyKey", 200),
    providerMessageId,
    status: input.status,
    updatedAt,
    userId: input.userId,
  });
};

export const createPendingDigestDelivery = (
  input: Omit<
    CreateDigestDeliveryInput,
    "failureCode" | "failureReason" | "providerMessageId" | "status" | "updatedAt"
  >,
): DigestDelivery =>
  createDigestDelivery({ ...input, status: "PENDING", updatedAt: input.createdAt });

export const markDigestDeliverySent = (
  delivery: DigestDelivery,
  providerMessageId: string,
  updatedAt: string,
): DigestDelivery =>
  createDigestDelivery({
    ...delivery,
    failureCode: null,
    failureReason: null,
    providerMessageId,
    status: "SENT",
    updatedAt,
  });

export const markDigestDeliveryFailed = (
  delivery: DigestDelivery,
  failureCode: string,
  failureReason: string,
  updatedAt: string,
): DigestDelivery =>
  createDigestDelivery({
    ...delivery,
    failureCode,
    failureReason,
    providerMessageId: null,
    status: "FAILED",
    updatedAt,
  });
