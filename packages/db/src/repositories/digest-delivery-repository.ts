import {
  DeliveryWriteConflictError,
  type DigestDeliveryRepository,
  type DigestDeliverySaveResult,
} from "@radar/application";
import {
  type DeliveryChannel,
  type DigestDelivery,
  type DigestDeliveryId,
  type DigestId,
} from "@radar/core";

import { type DatabaseClient } from "../client.js";
import { PersistenceError } from "../errors.js";
import { Prisma } from "../generated/prisma/client.js";
import {
  digestDeliveryFromRecord,
  digestDeliveryToCreateData,
  digestDeliveryToUpdateData,
} from "../mappers/digest-delivery-mapper.js";

const sameImmutableIdentity = (left: DigestDelivery, right: DigestDelivery): boolean =>
  left.correlationId === right.correlationId &&
  left.createdAt === right.createdAt &&
  left.digestId === right.digestId &&
  left.id === right.id &&
  left.idempotencyKey === right.idempotencyKey &&
  left.userId === right.userId;

const sameOutcome = (left: DigestDelivery, right: DigestDelivery): boolean =>
  left.failureCode === right.failureCode &&
  left.failureReason === right.failureReason &&
  left.providerMessageId === right.providerMessageId &&
  left.status === right.status;

export class PrismaDigestDeliveryRepository implements DigestDeliveryRepository {
  readonly #client: DatabaseClient;

  constructor(client: DatabaseClient) {
    this.#client = client;
  }

  async findByDigest(channel: DeliveryChannel, digestId: DigestId): Promise<DigestDelivery | null> {
    const record = await this.#client.digestDelivery.findUnique({
      where: { channel_digestId: { channel, digestId } },
    });
    return record === null ? null : digestDeliveryFromRecord(record);
  }

  async findById(id: DigestDeliveryId): Promise<DigestDelivery | null> {
    const record = await this.#client.digestDelivery.findUnique({ where: { id } });
    return record === null ? null : digestDeliveryFromRecord(record);
  }

  async save(delivery: DigestDelivery): Promise<DigestDeliverySaveResult> {
    const currentRecord = await this.#client.digestDelivery.findUnique({
      where: { id: delivery.id },
    });
    if (currentRecord !== null) {
      const current = digestDeliveryFromRecord(currentRecord);
      if (!sameImmutableIdentity(current, delivery)) {
        throw new DeliveryWriteConflictError(
          "Digest delivery identifier is attached to other data",
        );
      }
      if (current.status !== "PENDING") {
        if (sameOutcome(current, delivery)) {
          return Object.freeze({ created: false, delivery: current });
        }
        throw new DeliveryWriteConflictError("Terminal digest delivery outcome cannot be changed");
      }
      if (delivery.status === "PENDING") {
        return Object.freeze({ created: false, delivery: current });
      }
      const update = await this.#client.digestDelivery.updateMany({
        data: digestDeliveryToUpdateData(delivery),
        where: { id: delivery.id, status: "PENDING" },
      });
      if (update.count === 1) {
        const updated = await this.findById(delivery.id);
        if (updated === null) {
          throw new PersistenceError(
            "DIGEST_DELIVERY_SAVE_FAILED",
            "Updated digest delivery disappeared from persistence",
          );
        }
        return Object.freeze({ created: false, delivery: updated });
      }
      const raced = await this.findById(delivery.id);
      if (
        raced !== null &&
        sameImmutableIdentity(raced, delivery) &&
        sameOutcome(raced, delivery)
      ) {
        return Object.freeze({ created: false, delivery: raced });
      }
      throw new DeliveryWriteConflictError("Concurrent digest delivery outcome is terminal");
    }

    const byDigest = await this.findByDigest(delivery.channel, delivery.digestId);
    if (byDigest !== null) {
      return Object.freeze({ created: false, delivery: byDigest });
    }
    try {
      const record = await this.#client.digestDelivery.create({
        data: digestDeliveryToCreateData(delivery),
      });
      return Object.freeze({ created: true, delivery: digestDeliveryFromRecord(record) });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const raced = await this.findByDigest(delivery.channel, delivery.digestId);
        if (raced !== null) {
          return Object.freeze({ created: false, delivery: raced });
        }
        throw new DeliveryWriteConflictError(
          "Concurrent digest delivery conflicts with this attempt",
        );
      }
      if (error instanceof DeliveryWriteConflictError) {
        throw error;
      }
      throw new PersistenceError(
        "DIGEST_DELIVERY_SAVE_FAILED",
        "Unable to persist digest delivery",
        error,
      );
    }
  }
}
