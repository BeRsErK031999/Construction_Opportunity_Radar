import {
  isProcessingJobType,
  type JobPayload,
  type ProcessingJob,
  type ProcessingJobStatus,
} from "@radar/jobs";

export interface ProcessingJobRecord {
  readonly attempts: number;
  readonly completedAt: Date | null;
  readonly concurrencyKey: string;
  readonly correlationId: string;
  readonly createdAt: Date;
  readonly entityKey: string;
  readonly id: string;
  readonly idempotencyKey: string;
  readonly jobType: string;
  readonly lastErrorCode: string | null;
  readonly lastErrorReason: string | null;
  readonly leaseExpiresAt: Date | null;
  readonly leaseOwner: string | null;
  readonly lockedAt: Date | null;
  readonly maxAttempts: number;
  readonly payload: unknown;
  readonly payloadVersion: string;
  readonly scheduledAt: Date;
  readonly status: string;
  readonly updatedAt: Date;
}

const JOB_STATUSES = new Set<ProcessingJobStatus>(["SCHEDULED", "RUNNING", "SUCCEEDED", "FAILED"]);

const isPayload = (value: unknown): value is JobPayload =>
  value !== null && typeof value === "object" && !Array.isArray(value);

export const processingJobFromRecord = (record: ProcessingJobRecord): ProcessingJob => {
  if (!isProcessingJobType(record.jobType)) {
    throw new Error(`Unknown processing job type: ${record.jobType}`);
  }
  if (!JOB_STATUSES.has(record.status as ProcessingJobStatus)) {
    throw new Error(`Unknown processing job status: ${record.status}`);
  }
  if (!isPayload(record.payload)) {
    throw new Error("Processing job payload must be a JSON object");
  }
  return Object.freeze({
    attempts: record.attempts,
    completedAt: record.completedAt?.toISOString() ?? null,
    concurrencyKey: record.concurrencyKey,
    correlationId: record.correlationId,
    createdAt: record.createdAt.toISOString(),
    entityKey: record.entityKey,
    id: record.id,
    idempotencyKey: record.idempotencyKey,
    lastErrorCode: record.lastErrorCode,
    lastErrorReason: record.lastErrorReason,
    leaseExpiresAt: record.leaseExpiresAt?.toISOString() ?? null,
    leaseOwner: record.leaseOwner,
    lockedAt: record.lockedAt?.toISOString() ?? null,
    maxAttempts: record.maxAttempts,
    payload: record.payload,
    payloadVersion: record.payloadVersion,
    scheduledAt: record.scheduledAt.toISOString(),
    status: record.status as ProcessingJobStatus,
    type: record.jobType,
    updatedAt: record.updatedAt.toISOString(),
  });
};
