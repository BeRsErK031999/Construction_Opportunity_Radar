import type {
  ClaimJobInput,
  CompleteJobInput,
  EnqueueJobInput,
  EnqueueJobResult,
  FailJobInput,
  FailJobResult,
  ProcessingJob,
  ProcessingJobRepository,
  RecoverStaleJobsInput,
  RecoverStaleJobsResult,
  RenewJobLeaseInput,
} from "@radar/jobs";

import { type DatabaseClient } from "../client.js";
import { JobStateConflictError, PersistenceError } from "../errors.js";
import { Prisma } from "../generated/prisma/client.js";
import {
  processingJobFromRecord,
  type ProcessingJobRecord,
} from "../mappers/processing-job-mapper.js";

const recordColumns = Prisma.sql`
  "processing_jobs"."id",
  "processing_jobs"."job_type" AS "jobType",
  "processing_jobs"."entity_key" AS "entityKey",
  "processing_jobs"."concurrency_key" AS "concurrencyKey",
  "processing_jobs"."idempotency_key" AS "idempotencyKey",
  "processing_jobs"."payload",
  "processing_jobs"."payload_version" AS "payloadVersion",
  "processing_jobs"."status",
  "processing_jobs"."attempts",
  "processing_jobs"."max_attempts" AS "maxAttempts",
  "processing_jobs"."scheduled_at" AS "scheduledAt",
  "processing_jobs"."locked_at" AS "lockedAt",
  "processing_jobs"."lease_expires_at" AS "leaseExpiresAt",
  "processing_jobs"."lease_owner" AS "leaseOwner",
  "processing_jobs"."last_error_code" AS "lastErrorCode",
  "processing_jobs"."last_error_reason" AS "lastErrorReason",
  "processing_jobs"."correlation_id" AS "correlationId",
  "processing_jobs"."completed_at" AS "completedAt",
  "processing_jobs"."created_at" AS "createdAt",
  "processing_jobs"."updated_at" AS "updatedAt"
`;

const isUniqueConstraintError = (error: unknown): boolean =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";

export class PrismaProcessingJobRepository implements ProcessingJobRepository {
  readonly #client: DatabaseClient;

  constructor(client: DatabaseClient) {
    this.#client = client;
  }

  async enqueue(input: EnqueueJobInput): Promise<EnqueueJobResult> {
    try {
      const record = await this.#client.processingJob.create({
        data: {
          attempts: 0,
          concurrencyKey: input.concurrencyKey,
          correlationId: input.correlationId,
          createdAt: new Date(input.createdAt),
          entityKey: input.entityKey,
          id: input.id,
          idempotencyKey: input.idempotencyKey,
          jobType: input.type,
          maxAttempts: input.maxAttempts,
          payload: input.payload,
          payloadVersion: input.payloadVersion,
          scheduledAt: new Date(input.scheduledAt),
          status: "SCHEDULED",
          updatedAt: new Date(input.createdAt),
        },
      });
      return Object.freeze({ job: processingJobFromRecord(record), outcome: "CREATED" });
    } catch (error) {
      if (!isUniqueConstraintError(error)) {
        throw new PersistenceError("JOB_ENQUEUE_FAILED", "Unable to enqueue processing job", error);
      }
      const existing = await this.#client.processingJob.findUnique({
        where: {
          jobType_idempotencyKey: {
            idempotencyKey: input.idempotencyKey,
            jobType: input.type,
          },
        },
      });
      if (existing !== null) {
        return Object.freeze({ job: processingJobFromRecord(existing), outcome: "EXISTING" });
      }
      const active = await this.#client.processingJob.findFirst({
        orderBy: [{ scheduledAt: "asc" }, { id: "asc" }],
        where: {
          concurrencyKey: input.concurrencyKey,
          jobType: input.type,
          status: { in: ["SCHEDULED", "RUNNING"] },
        },
      });
      if (active !== null) {
        return Object.freeze({ job: processingJobFromRecord(active), outcome: "OVERLAP_BLOCKED" });
      }
      throw new PersistenceError(
        "JOB_IDENTITY_CONFLICT",
        "Processing job identifier conflicts with another job",
        error,
      );
    }
  }

  async claimNext(input: ClaimJobInput): Promise<ProcessingJob | null> {
    if (input.types?.length === 0) {
      return null;
    }
    const typeFilter =
      input.types === undefined
        ? Prisma.empty
        : Prisma.sql`AND "job_type" IN (${Prisma.join(input.types)})`;
    const rows = await this.#client.$queryRaw<ProcessingJobRecord[]>(Prisma.sql`
      WITH candidate AS (
        SELECT "id"
        FROM "processing_jobs"
        WHERE "status" = 'SCHEDULED'
          AND "scheduled_at" <= ${new Date(input.now)}
          AND "attempts" < "max_attempts"
          ${typeFilter}
        ORDER BY "scheduled_at" ASC, "created_at" ASC, "id" ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      UPDATE "processing_jobs"
      SET
        "status" = 'RUNNING',
        "attempts" = "processing_jobs"."attempts" + 1,
        "locked_at" = ${new Date(input.now)},
        "lease_expires_at" = ${new Date(input.leaseExpiresAt)},
        "lease_owner" = ${input.workerId},
        "updated_at" = ${new Date(input.now)}
      FROM candidate
      WHERE "processing_jobs"."id" = candidate."id"
      RETURNING ${recordColumns}
    `);
    const claimed = rows[0];
    return claimed === undefined ? null : processingJobFromRecord(claimed);
  }

  async complete(input: CompleteJobInput): Promise<ProcessingJob> {
    const completedAt = new Date(input.completedAt);
    const result = await this.#client.processingJob.updateMany({
      data: {
        completedAt,
        lastErrorCode: null,
        lastErrorReason: null,
        leaseExpiresAt: null,
        leaseOwner: null,
        lockedAt: null,
        status: "SUCCEEDED",
        updatedAt: completedAt,
      },
      where: {
        id: input.jobId,
        leaseExpiresAt: { gt: completedAt },
        leaseOwner: input.workerId,
        status: "RUNNING",
      },
    });
    if (result.count !== 1) {
      throw new JobStateConflictError("Job is not owned by this worker or its lease has expired");
    }
    const completed = await this.findById(input.jobId);
    if (completed === null) {
      throw new JobStateConflictError("Completed job disappeared");
    }
    return completed;
  }

  async fail(input: FailJobInput): Promise<FailJobResult> {
    return this.#client.$transaction(async (transaction) => {
      const locked = await transaction.$queryRaw<readonly { readonly id: string }[]>(Prisma.sql`
        SELECT "id"
        FROM "processing_jobs"
        WHERE "id" = ${input.jobId}::uuid
        FOR UPDATE
      `);
      if (locked.length !== 1) {
        throw new JobStateConflictError("Job does not exist");
      }
      const current = await transaction.processingJob.findUnique({ where: { id: input.jobId } });
      const failedAt = new Date(input.failedAt);
      if (
        current?.status !== "RUNNING" ||
        current.leaseOwner !== input.workerId ||
        current.leaseExpiresAt === null ||
        current.leaseExpiresAt <= failedAt
      ) {
        throw new JobStateConflictError("Job is not owned by this worker or its lease has expired");
      }
      const terminal = !input.retryable || current.attempts >= current.maxAttempts;
      const record = await transaction.processingJob.update({
        data: {
          completedAt: terminal ? failedAt : null,
          lastErrorCode: input.errorCode,
          lastErrorReason: input.errorReason,
          leaseExpiresAt: null,
          leaseOwner: null,
          lockedAt: null,
          scheduledAt: terminal ? current.scheduledAt : new Date(input.nextScheduledAt),
          status: terminal ? "FAILED" : "SCHEDULED",
          updatedAt: failedAt,
        },
        where: { id: input.jobId },
      });
      return Object.freeze({
        job: processingJobFromRecord(record),
        outcome: terminal ? "TERMINAL_FAILURE" : "RETRY_SCHEDULED",
      });
    });
  }

  async findById(id: string): Promise<ProcessingJob | null> {
    const record = await this.#client.processingJob.findUnique({ where: { id } });
    return record === null ? null : processingJobFromRecord(record);
  }

  async recoverStale(input: RecoverStaleJobsInput): Promise<RecoverStaleJobsResult> {
    const rows = await this.#client.$queryRaw<ProcessingJobRecord[]>(Prisma.sql`
      WITH stale AS (
        SELECT "id"
        FROM "processing_jobs"
        WHERE "status" = 'RUNNING'
          AND "lease_expires_at" <= ${new Date(input.now)}
        ORDER BY "lease_expires_at" ASC, "id" ASC
        FOR UPDATE SKIP LOCKED
        LIMIT ${input.limit}
      )
      UPDATE "processing_jobs"
      SET
        "status" = CASE
          WHEN "processing_jobs"."attempts" < "processing_jobs"."max_attempts"
            THEN 'SCHEDULED'::"ProcessingJobStatus"
          ELSE 'FAILED'::"ProcessingJobStatus"
        END,
        "scheduled_at" = CASE
          WHEN "processing_jobs"."attempts" < "processing_jobs"."max_attempts"
            THEN ${new Date(input.now)}::timestamptz + (
              LEAST(
                ${input.retryBaseDelayMs}::double precision
                  * power(2, GREATEST("processing_jobs"."attempts" - 1, 0)),
                ${input.retryMaximumDelayMs}::double precision
              ) * interval '1 millisecond'
            )
          ELSE "processing_jobs"."scheduled_at"
        END,
        "locked_at" = NULL,
        "lease_expires_at" = NULL,
        "lease_owner" = NULL,
        "last_error_code" = 'JOB_LEASE_EXPIRED',
        "last_error_reason" = 'Worker lease expired before completion',
        "completed_at" = CASE
          WHEN "processing_jobs"."attempts" < "processing_jobs"."max_attempts"
            THEN NULL::timestamptz
          ELSE ${new Date(input.now)}::timestamptz
        END,
        "updated_at" = ${new Date(input.now)}
      FROM stale
      WHERE "processing_jobs"."id" = stale."id"
      RETURNING ${recordColumns}
    `);
    const jobs = Object.freeze(rows.map(processingJobFromRecord));
    return Object.freeze({
      failed: jobs.filter(({ status }) => status === "FAILED").length,
      jobs,
      requeued: jobs.filter(({ status }) => status === "SCHEDULED").length,
    });
  }

  async renewLease(input: RenewJobLeaseInput): Promise<boolean> {
    const now = new Date(input.now);
    const result = await this.#client.processingJob.updateMany({
      data: {
        leaseExpiresAt: new Date(input.leaseExpiresAt),
        updatedAt: now,
      },
      where: {
        id: input.jobId,
        leaseExpiresAt: { gt: now },
        leaseOwner: input.workerId,
        status: "RUNNING",
      },
    });
    return result.count === 1;
  }
}
