import {
  correlationId,
  createDigestDelivery,
  digestDeliveryId,
  digestId,
  userId,
  type DigestDelivery,
} from "@radar/core";

import {
  type DigestDelivery as DigestDeliveryRecord,
  type Prisma,
} from "../generated/prisma/client.js";

export const digestDeliveryToCreateData = (
  delivery: DigestDelivery,
): Prisma.DigestDeliveryCreateInput => ({
  channel: delivery.channel,
  correlationId: delivery.correlationId,
  createdAt: new Date(delivery.createdAt),
  digest: {
    connect: { id_userId: { id: delivery.digestId, userId: delivery.userId } },
  },
  failureCode: delivery.failureCode,
  failureReason: delivery.failureReason,
  id: delivery.id,
  idempotencyKey: delivery.idempotencyKey,
  providerMessageId: delivery.providerMessageId,
  status: delivery.status,
  updatedAt: new Date(delivery.updatedAt),
  user: { connect: { id: delivery.userId } },
});

export const digestDeliveryToUpdateData = (
  delivery: DigestDelivery,
): Prisma.DigestDeliveryUpdateInput => ({
  failureCode: delivery.failureCode,
  failureReason: delivery.failureReason,
  providerMessageId: delivery.providerMessageId,
  status: delivery.status,
  updatedAt: new Date(delivery.updatedAt),
});

export const digestDeliveryFromRecord = (record: DigestDeliveryRecord): DigestDelivery =>
  createDigestDelivery({
    channel: record.channel,
    correlationId: correlationId(record.correlationId),
    createdAt: record.createdAt.toISOString(),
    digestId: digestId(record.digestId),
    failureCode: record.failureCode,
    failureReason: record.failureReason,
    id: digestDeliveryId(record.id),
    idempotencyKey: record.idempotencyKey,
    providerMessageId: record.providerMessageId,
    status: record.status,
    updatedAt: record.updatedAt.toISOString(),
    userId: userId(record.userId),
  });
