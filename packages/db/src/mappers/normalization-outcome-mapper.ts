import {
  createNormalizationRejected,
  NORMALIZATION_REJECTION_CODES,
  normalizationOutcomeRawItemId,
  normalizationOutcomeVersion,
  type CorrelationId,
  type NormalizationOutcome,
  type NormalizationRejectionCode,
  type RawItemId,
} from "@radar/core";

import { PersistenceError } from "../errors.js";
import { type Prisma } from "../generated/prisma/client.js";
import { normalizedItemFromRecord } from "./normalized-item-mapper.js";

export type NormalizationAttemptWithItem = Prisma.NormalizationAttemptGetPayload<{
  include: { normalizedItem: true };
}>;

const rejectionCode = (value: string): NormalizationRejectionCode => {
  const code = value as NormalizationRejectionCode;
  if (!NORMALIZATION_REJECTION_CODES.includes(code)) {
    throw new PersistenceError(
      "NORMALIZATION_OUTCOME_MAPPING_FAILED",
      `Unknown normalization rejection code ${value}`,
    );
  }
  return code;
};

export const normalizationAttemptToCreateData = (
  id: string,
  outcome: NormalizationOutcome,
): Prisma.NormalizationAttemptCreateInput => {
  const rawItemId = normalizationOutcomeRawItemId(outcome);
  const normalizerVersion = normalizationOutcomeVersion(outcome);
  if (outcome.status === "SUCCEEDED") {
    return {
      correlationId: outcome.item.correlationId,
      createdAt: new Date(outcome.item.createdAt),
      id,
      normalizedItem: { connect: { id: outcome.item.id } },
      normalizerVersion,
      rawItem: { connect: { id: rawItemId } },
      status: "SUCCEEDED",
    };
  }

  return {
    correlationId: outcome.correlationId,
    createdAt: new Date(outcome.createdAt),
    id,
    normalizerVersion,
    rawItem: { connect: { id: rawItemId } },
    rejectionCode: outcome.rejectionCode,
    rejectionDetail: outcome.detail,
    status: "REJECTED",
  };
};

export const normalizationOutcomeFromRecord = (
  record: NormalizationAttemptWithItem,
): NormalizationOutcome => {
  if (record.status === "SUCCEEDED") {
    if (
      record.normalizedItem === null ||
      record.rejectionCode !== null ||
      record.rejectionDetail !== null
    ) {
      throw new PersistenceError(
        "NORMALIZATION_OUTCOME_MAPPING_FAILED",
        "Successful normalization attempt has an invalid payload shape",
      );
    }
    return Object.freeze({
      item: normalizedItemFromRecord(record.normalizedItem),
      status: "SUCCEEDED",
    });
  }

  if (
    record.normalizedItem !== null ||
    record.rejectionCode === null ||
    record.rejectionDetail === null
  ) {
    throw new PersistenceError(
      "NORMALIZATION_OUTCOME_MAPPING_FAILED",
      "Rejected normalization attempt has an invalid payload shape",
    );
  }
  return createNormalizationRejected({
    correlationId: record.correlationId as CorrelationId,
    createdAt: record.createdAt.toISOString(),
    detail: record.rejectionDetail,
    normalizerVersion: record.normalizerVersion,
    rawItemId: record.rawItemId as RawItemId,
    rejectionCode: rejectionCode(record.rejectionCode),
  });
};
