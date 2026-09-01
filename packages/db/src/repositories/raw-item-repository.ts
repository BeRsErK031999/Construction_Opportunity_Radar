import { type RawItem, type RawItemId } from "@radar/core";

import { type DatabaseClient } from "../client.js";
import { PersistenceError, RawItemIdentityConflictError } from "../errors.js";
import { Prisma } from "../generated/prisma/client.js";
import { rawItemFromRecord, rawItemToCreateData } from "../mappers/raw-item-mapper.js";

export type RawItemMatch = "CONTENT_HASH" | "EXTERNAL_ID" | "ID";

export interface RawItemIngestResult {
  readonly created: boolean;
  readonly item: RawItem;
  readonly matchedBy: RawItemMatch | null;
}

export class PrismaRawItemRepository {
  readonly #client: DatabaseClient;

  constructor(client: DatabaseClient) {
    this.#client = client;
  }

  async count(): Promise<number> {
    return this.#client.rawItem.count();
  }

  async findById(id: RawItemId): Promise<RawItem | null> {
    const record = await this.#client.rawItem.findUnique({ where: { id } });
    return record === null ? null : rawItemFromRecord(record);
  }

  async ingest(rawItem: RawItem): Promise<RawItemIngestResult> {
    const existing = await this.#findExisting(rawItem);
    if (existing !== null) {
      return existing;
    }

    try {
      const record = await this.#client.rawItem.create({ data: rawItemToCreateData(rawItem) });
      return Object.freeze({ created: true, item: rawItemFromRecord(record), matchedBy: null });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const racedItem = await this.#findExisting(rawItem);
        if (racedItem !== null) {
          return racedItem;
        }
      }
      throw new PersistenceError("RAW_ITEM_INGEST_FAILED", "Unable to persist raw item", error);
    }
  }

  async #findExisting(rawItem: RawItem): Promise<RawItemIngestResult | null> {
    const byId = await this.#client.rawItem.findUnique({ where: { id: rawItem.id } });
    if (byId !== null) {
      this.#assertCompatibleEvidence(byId, rawItem, "id");
      return Object.freeze({ created: false, item: rawItemFromRecord(byId), matchedBy: "ID" });
    }

    if (rawItem.externalId !== null) {
      const byExternalId = await this.#client.rawItem.findUnique({
        where: {
          sourceId_externalId: {
            externalId: rawItem.externalId,
            sourceId: rawItem.sourceId,
          },
        },
      });
      if (byExternalId !== null) {
        this.#assertCompatibleEvidence(byExternalId, rawItem, "externalId");
        return Object.freeze({
          created: false,
          item: rawItemFromRecord(byExternalId),
          matchedBy: "EXTERNAL_ID",
        });
      }
    }

    const byHash = await this.#client.rawItem.findUnique({
      where: {
        sourceId_contentHash: {
          contentHash: rawItem.contentHash,
          sourceId: rawItem.sourceId,
        },
      },
    });
    if (byHash === null) {
      return null;
    }
    this.#assertCompatibleEvidence(byHash, rawItem, "contentHash");
    return Object.freeze({
      created: false,
      item: rawItemFromRecord(byHash),
      matchedBy: "CONTENT_HASH",
    });
  }

  #assertCompatibleEvidence(
    existing: { readonly contentHash: string; readonly rawText: string; readonly sourceId: string },
    candidate: RawItem,
    identity: "contentHash" | "externalId" | "id",
  ): void {
    if (
      existing.sourceId !== candidate.sourceId ||
      existing.contentHash !== candidate.contentHash ||
      existing.rawText !== candidate.rawText
    ) {
      throw new RawItemIdentityConflictError(
        `Raw item ${identity} is already attached to different immutable content`,
      );
    }
  }
}
