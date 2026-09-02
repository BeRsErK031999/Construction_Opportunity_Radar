export const PROCESSING_JOB_TYPES = [
  "fetchSources",
  "normalize",
  "deduplicate",
  "classify",
  "analyze",
  "buildDigest",
  "deliverDigest",
] as const;

export type ProcessingJobType = (typeof PROCESSING_JOB_TYPES)[number];
export type ProcessingJobStatus = "SCHEDULED" | "RUNNING" | "SUCCEEDED" | "FAILED";

export type JobJsonPrimitive = boolean | number | string | null;
export type JobJsonValue =
  JobJsonPrimitive | readonly JobJsonValue[] | { readonly [key: string]: JobJsonValue };
export type JobPayload = Readonly<Record<string, JobJsonValue>>;

export interface ProcessingJob {
  readonly attempts: number;
  readonly completedAt: string | null;
  readonly concurrencyKey: string;
  readonly correlationId: string;
  readonly createdAt: string;
  readonly entityKey: string;
  readonly id: string;
  readonly idempotencyKey: string;
  readonly lastErrorCode: string | null;
  readonly lastErrorReason: string | null;
  readonly leaseExpiresAt: string | null;
  readonly leaseOwner: string | null;
  readonly lockedAt: string | null;
  readonly maxAttempts: number;
  readonly payload: JobPayload;
  readonly payloadVersion: string;
  readonly scheduledAt: string;
  readonly status: ProcessingJobStatus;
  readonly type: ProcessingJobType;
  readonly updatedAt: string;
}

export interface EnqueueJobInput {
  readonly concurrencyKey: string;
  readonly correlationId: string;
  readonly createdAt: string;
  readonly entityKey: string;
  readonly id: string;
  readonly idempotencyKey: string;
  readonly maxAttempts: number;
  readonly payload: JobPayload;
  readonly payloadVersion: string;
  readonly scheduledAt: string;
  readonly type: ProcessingJobType;
}

export type EnqueueJobOutcome = "CREATED" | "EXISTING" | "OVERLAP_BLOCKED";

export interface EnqueueJobResult {
  readonly job: ProcessingJob;
  readonly outcome: EnqueueJobOutcome;
}

export const isProcessingJobType = (value: string): value is ProcessingJobType =>
  PROCESSING_JOB_TYPES.some((type) => type === value);
