CREATE TYPE "ProcessingJobType" AS ENUM (
  'fetchSources',
  'normalize',
  'deduplicate',
  'classify',
  'analyze',
  'buildDigest',
  'deliverDigest'
);

CREATE TYPE "ProcessingJobStatus" AS ENUM ('SCHEDULED', 'RUNNING', 'SUCCEEDED', 'FAILED');

CREATE TABLE "processing_jobs" (
  "id" UUID NOT NULL,
  "job_type" "ProcessingJobType" NOT NULL,
  "entity_key" VARCHAR(200) NOT NULL,
  "concurrency_key" VARCHAR(200) NOT NULL,
  "idempotency_key" VARCHAR(200) NOT NULL,
  "payload" JSONB NOT NULL,
  "payload_version" VARCHAR(100) NOT NULL,
  "status" "ProcessingJobStatus" NOT NULL,
  "attempts" INTEGER NOT NULL,
  "max_attempts" INTEGER NOT NULL,
  "scheduled_at" TIMESTAMPTZ(3) NOT NULL,
  "locked_at" TIMESTAMPTZ(3),
  "lease_expires_at" TIMESTAMPTZ(3),
  "lease_owner" VARCHAR(200),
  "last_error_code" VARCHAR(100),
  "last_error_reason" TEXT,
  "correlation_id" UUID NOT NULL,
  "completed_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "processing_jobs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "processing_jobs_keys_check" CHECK (
    btrim("entity_key") <> ''
    AND btrim("concurrency_key") <> ''
    AND btrim("idempotency_key") <> ''
    AND btrim("payload_version") <> ''
  ),
  CONSTRAINT "processing_jobs_attempts_check" CHECK (
    "attempts" >= 0
    AND "max_attempts" BETWEEN 1 AND 20
    AND "attempts" <= "max_attempts"
  ),
  CONSTRAINT "processing_jobs_lease_order_check" CHECK (
    "lease_expires_at" IS NULL
    OR ("locked_at" IS NOT NULL AND "lease_expires_at" > "locked_at")
  ),
  CONSTRAINT "processing_jobs_state_check" CHECK (
    ("status" = 'SCHEDULED'
      AND "locked_at" IS NULL
      AND "lease_expires_at" IS NULL
      AND "lease_owner" IS NULL
      AND "completed_at" IS NULL)
    OR ("status" = 'RUNNING'
      AND "locked_at" IS NOT NULL
      AND "lease_expires_at" IS NOT NULL
      AND "lease_owner" IS NOT NULL
      AND "completed_at" IS NULL)
    OR ("status" = 'SUCCEEDED'
      AND "locked_at" IS NULL
      AND "lease_expires_at" IS NULL
      AND "lease_owner" IS NULL
      AND "last_error_code" IS NULL
      AND "last_error_reason" IS NULL
      AND "completed_at" IS NOT NULL)
    OR ("status" = 'FAILED'
      AND "locked_at" IS NULL
      AND "lease_expires_at" IS NULL
      AND "lease_owner" IS NULL
      AND "last_error_code" IS NOT NULL
      AND "last_error_reason" IS NOT NULL
      AND "completed_at" IS NOT NULL)
  )
);

CREATE UNIQUE INDEX "processing_jobs_identity_key"
  ON "processing_jobs"("job_type", "idempotency_key");

CREATE UNIQUE INDEX "processing_jobs_active_concurrency_key"
  ON "processing_jobs"("job_type", "concurrency_key")
  WHERE "status" IN ('SCHEDULED', 'RUNNING');

CREATE INDEX "processing_jobs_claim_idx"
  ON "processing_jobs"("status", "scheduled_at");

CREATE INDEX "processing_jobs_stale_idx"
  ON "processing_jobs"("status", "lease_expires_at");

CREATE INDEX "processing_jobs_entity_status_idx"
  ON "processing_jobs"("job_type", "entity_key", "status");
