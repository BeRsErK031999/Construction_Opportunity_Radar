import {
  correlationId,
  createDelivery,
  deliveryId,
  recommendationId,
  userId,
  type Delivery,
} from "@radar/core";

import { type Delivery as DeliveryRecord, type Prisma } from "../generated/prisma/client.js";

export const deliveryToCreateData = (delivery: Delivery): Prisma.DeliveryCreateInput => ({
  channel: delivery.channel,
  correlationId: delivery.correlationId,
  createdAt: new Date(delivery.createdAt),
  failureCode: delivery.failureCode,
  failureReason: delivery.failureReason,
  id: delivery.id,
  idempotencyKey: delivery.idempotencyKey,
  kind: delivery.kind,
  providerMessageId: delivery.providerMessageId,
  recommendation: { connect: { id: delivery.recommendationId } },
  status: delivery.status,
  updatedAt: new Date(delivery.updatedAt),
  user: { connect: { id: delivery.userId } },
});

export const deliveryToUpdateData = (delivery: Delivery): Prisma.DeliveryUpdateInput => ({
  failureCode: delivery.failureCode,
  failureReason: delivery.failureReason,
  providerMessageId: delivery.providerMessageId,
  status: delivery.status,
  updatedAt: new Date(delivery.updatedAt),
});

export const deliveryFromRecord = (record: DeliveryRecord): Delivery =>
  createDelivery({
    channel: record.channel,
    correlationId: correlationId(record.correlationId),
    createdAt: record.createdAt.toISOString(),
    failureCode: record.failureCode,
    failureReason: record.failureReason,
    id: deliveryId(record.id),
    idempotencyKey: record.idempotencyKey,
    kind: record.kind,
    providerMessageId: record.providerMessageId,
    recommendationId: recommendationId(record.recommendationId),
    status: record.status,
    updatedAt: record.updatedAt.toISOString(),
    userId: userId(record.userId),
  });
