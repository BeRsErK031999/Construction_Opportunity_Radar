import type { EnqueueJobInput, EnqueueJobResult, ProcessingJob, ProcessingJobType } from "./job.js";

export interface ClaimJobInput {
  readonly leaseExpiresAt: string;
  readonly now: string;
  readonly types?: readonly ProcessingJobType[];
  readonly workerId: string;
}

export interface CompleteJobInput {
  readonly completedAt: string;
  readonly jobId: string;
  readonly workerId: string;
}

export interface FailJobInput {
  readonly errorCode: string;
  readonly errorReason: string;
  readonly failedAt: string;
  readonly jobId: string;
  readonly nextScheduledAt: string;
  readonly retryable: boolean;
  readonly workerId: string;
}

export interface FailJobResult {
  readonly job: ProcessingJob;
  readonly outcome: "RETRY_SCHEDULED" | "TERMINAL_FAILURE";
}

export interface RecoverStaleJobsInput {
  readonly limit: number;
  readonly now: string;
  readonly retryBaseDelayMs: number;
  readonly retryMaximumDelayMs: number;
}

export interface RecoverStaleJobsResult {
  readonly failed: number;
  readonly jobs: readonly ProcessingJob[];
  readonly requeued: number;
}

export interface RenewJobLeaseInput {
  readonly jobId: string;
  readonly leaseExpiresAt: string;
  readonly now: string;
  readonly workerId: string;
}

export interface ProcessingJobRepository {
  claimNext(input: ClaimJobInput): Promise<ProcessingJob | null>;
  complete(input: CompleteJobInput): Promise<ProcessingJob>;
  enqueue(input: EnqueueJobInput): Promise<EnqueueJobResult>;
  fail(input: FailJobInput): Promise<FailJobResult>;
  findById(id: string): Promise<ProcessingJob | null>;
  recoverStale(input: RecoverStaleJobsInput): Promise<RecoverStaleJobsResult>;
  renewLease(input: RenewJobLeaseInput): Promise<boolean>;
}
