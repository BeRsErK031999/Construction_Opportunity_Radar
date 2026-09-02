import { randomUUID } from "node:crypto";

import {
  type NormalizationOutcomeRepository,
  type NormalizationSaveResult,
} from "@radar/application";
import {
  normalizationOutcomeRawItemId,
  normalizationOutcomeVersion,
  type NormalizationOutcome,
} from "@radar/core";

import { type DatabaseClient } from "../client.js";
import { NormalizationIdentityConflictError, PersistenceError } from "../errors.js";
import { Prisma } from "../generated/prisma/client.js";
import {
  normalizationAttemptToCreateData,
  normalizationOutcomeFromRecord,
  type NormalizationAttemptWithItem,
} from "../mappers/normalization-outcome-mapper.js";
import { normalizedItemToCreateData } from "../mappers/normalized-item-mapper.js";

const includeNormalizedItem = { normalizedItem: true } as const;

export class PrismaNormalizationOutcomeRepository implements NormalizationOutcomeRepository {
  readonly #client: DatabaseClient;

  constructor(client: DatabaseClient) {
    this.#client = client;
  }

  async count(): Promise<number> {
    return this.#client.normalizationAttempt.count();
  }

  async countNormalizedItems(): Promise<number> {
    return this.#client.normalizedItem.count();
  }

  async save(outcome: NormalizationOutcome): Promise<NormalizationSaveResult> {
    const existing = await this.#findExisting(outcome);
    if (existing !== null) {
      return existing;
    }

    try {
      const record = await this.#client.$transaction(async (transaction) => {
        if (outcome.status === "SUCCEEDED") {
          await transaction.normalizedItem.create({
            data: normalizedItemToCreateData(outcome.item),
          });
        }
        return transaction.normalizationAttempt.create({
          data: normalizationAttemptToCreateData(randomUUID(), outcome),
          include: includeNormalizedItem,
        });
      });
      return Object.freeze({ created: true, outcome: normalizationOutcomeFromRecord(record) });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const racedOutcome = await this.#findExisting(outcome);
        if (racedOutcome !== null) {
          return racedOutcome;
        }
      }
      throw new PersistenceError(
        "NORMALIZATION_OUTCOME_SAVE_FAILED",
        "Unable to persist normalization outcome",
        error,
      );
    }
  }

  async #findExisting(outcome: NormalizationOutcome): Promise<NormalizationSaveResult | null> {
    const record = await this.#client.normalizationAttempt.findUnique({
      include: includeNormalizedItem,
      where: {
        rawItemId_normalizerVersion: {
          normalizerVersion: normalizationOutcomeVersion(outcome),
          rawItemId: normalizationOutcomeRawItemId(outcome),
        },
      },
    });
    if (record === null) {
      return null;
    }
    const existing = normalizationOutcomeFromRecord(record);
    this.#assertCompatible(existing, outcome, record);
    return Object.freeze({ created: false, outcome: existing });
  }

  #assertCompatible(
    existing: NormalizationOutcome,
    candidate: NormalizationOutcome,
    record: NormalizationAttemptWithItem,
  ): void {
    let same = false;
    if (existing.status === "REJECTED" && candidate.status === "REJECTED") {
      same = existing.detail === candidate.detail;
    } else if (existing.status === "SUCCEEDED" && candidate.status === "SUCCEEDED") {
      same =
        existing.item.normalizedHash === candidate.item.normalizedHash &&
        existing.item.text === candidate.item.text &&
        existing.item.canonicalUrl === candidate.item.canonicalUrl &&
        existing.item.language === candidate.item.language &&
        existing.item.title === candidate.item.title;
    }

    if (!same) {
      throw new NormalizationIdentityConflictError(
        `Normalization identity ${record.rawItemId}/${record.normalizerVersion} already has a different outcome`,
      );
    }
  }
}
