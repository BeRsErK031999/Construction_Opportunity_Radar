import { DeliveryWriteConflictError, type DeliveryRepository } from "@radar/application";
import { type Delivery, type DeliveryChannel, type DeliveryId } from "@radar/core";

import { type DatabaseClient } from "../client.js";
import { PersistenceError } from "../errors.js";
import { Prisma } from "../generated/prisma/client.js";
import {
  deliveryFromRecord,
  deliveryToCreateData,
  deliveryToUpdateData,
} from "../mappers/delivery-mapper.js";

const sameImmutableIdentity = (left: Delivery, right: Delivery): boolean =>
  left.correlationId === right.correlationId &&
  left.createdAt === right.createdAt &&
  left.id === right.id &&
  left.idempotencyKey === right.idempotencyKey &&
  left.recommendationId === right.recommendationId &&
  left.userId === right.userId;

const sameOutcome = (left: Delivery, right: Delivery): boolean =>
  left.failureCode === right.failureCode &&
  left.failureReason === right.failureReason &&
  left.providerMessageId === right.providerMessageId &&
  left.status === right.status;

export class PrismaDeliveryRepository implements DeliveryRepository {
  readonly #client: DatabaseClient;

  constructor(client: DatabaseClient) {
    this.#client = client;
  }

  async findById(id: DeliveryId): Promise<Delivery | null> {
    const record = await this.#client.delivery.findUnique({ where: { id } });
    return record === null ? null : deliveryFromRecord(record);
  }

  async findByIdempotencyKey(channel: DeliveryChannel, key: string): Promise<Delivery | null> {
    const record = await this.#client.delivery.findUnique({
      where: { channel_idempotencyKey: { channel, idempotencyKey: key } },
    });
    return record === null ? null : deliveryFromRecord(record);
  }

  async save(delivery: Delivery): Promise<Delivery> {
    const currentRecord = await this.#client.delivery.findUnique({ where: { id: delivery.id } });
    if (currentRecord !== null) {
      const current = deliveryFromRecord(currentRecord);
      if (!sameImmutableIdentity(current, delivery)) {
        throw new DeliveryWriteConflictError("Delivery identifier is attached to other data");
      }
      if (current.status !== "PENDING") {
        if (sameOutcome(current, delivery)) {
          return current;
        }
        throw new DeliveryWriteConflictError("Terminal delivery outcome cannot be changed");
      }
      if (delivery.status === "PENDING") {
        return current;
      }
      const update = await this.#client.delivery.updateMany({
        data: deliveryToUpdateData(delivery),
        where: { id: delivery.id, status: "PENDING" },
      });
      if (update.count === 1) {
        const updated = await this.findById(delivery.id);
        if (updated === null) {
          throw new PersistenceError(
            "DELIVERY_SAVE_FAILED",
            "Updated delivery disappeared from persistence",
          );
        }
        return updated;
      }
      const raced = await this.findById(delivery.id);
      if (
        raced !== null &&
        sameImmutableIdentity(raced, delivery) &&
        sameOutcome(raced, delivery)
      ) {
        return raced;
      }
      throw new DeliveryWriteConflictError("Concurrent delivery outcome is already terminal");
    }

    const byIdentity = await this.findByIdempotencyKey(delivery.channel, delivery.idempotencyKey);
    if (byIdentity !== null) {
      if (sameImmutableIdentity(byIdentity, delivery) && sameOutcome(byIdentity, delivery)) {
        return byIdentity;
      }
      throw new DeliveryWriteConflictError("Delivery idempotency key is already in use");
    }

    try {
      return deliveryFromRecord(
        await this.#client.delivery.create({ data: deliveryToCreateData(delivery) }),
      );
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const raced = await this.findByIdempotencyKey(delivery.channel, delivery.idempotencyKey);
        if (
          raced !== null &&
          sameImmutableIdentity(raced, delivery) &&
          sameOutcome(raced, delivery)
        ) {
          return raced;
        }
        throw new DeliveryWriteConflictError("Concurrent delivery conflicts with this attempt");
      }
      if (error instanceof DeliveryWriteConflictError) {
        throw error;
      }
      throw new PersistenceError("DELIVERY_SAVE_FAILED", "Unable to persist delivery", error);
    }
  }
}
