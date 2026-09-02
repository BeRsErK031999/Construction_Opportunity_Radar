-- CreateEnum
CREATE TYPE "NormalizationStatus" AS ENUM ('SUCCEEDED', 'REJECTED');

-- CreateTable
CREATE TABLE "normalization_attempts" (
    "id" UUID NOT NULL,
    "raw_item_id" UUID NOT NULL,
    "normalizer_version" VARCHAR(100) NOT NULL,
    "status" "NormalizationStatus" NOT NULL,
    "normalized_item_id" UUID,
    "rejection_code" VARCHAR(100),
    "rejection_detail" TEXT,
    "correlation_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "normalization_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "normalized_items_attempt_identity_key"
  ON "normalized_items"("id", "raw_item_id", "normalizer_version");

-- CreateIndex
CREATE UNIQUE INDEX "normalization_attempts_normalized_item_key"
  ON "normalization_attempts"("normalized_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "normalization_attempts_raw_version_key"
  ON "normalization_attempts"("raw_item_id", "normalizer_version");

-- CreateIndex
CREATE INDEX "normalization_attempts_status_created_idx"
  ON "normalization_attempts"("status", "created_at");

-- AddForeignKey
ALTER TABLE "normalization_attempts"
  ADD CONSTRAINT "normalization_attempts_raw_item_id_fkey"
    FOREIGN KEY ("raw_item_id") REFERENCES "raw_items"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "normalization_attempts"
  ADD CONSTRAINT "normalization_attempts_normalized_item_id_fkey"
    FOREIGN KEY ("normalized_item_id") REFERENCES "normalized_items"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- Keep a successful attempt attached to a normalized item for the same raw/version identity.
ALTER TABLE "normalization_attempts"
  ADD CONSTRAINT "normalization_attempts_normalized_identity_fkey"
    FOREIGN KEY ("normalized_item_id", "raw_item_id", "normalizer_version")
    REFERENCES "normalized_items"("id", "raw_item_id", "normalizer_version")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- Make success and rejection payloads mutually exclusive.
ALTER TABLE "normalization_attempts"
  ADD CONSTRAINT "normalization_attempts_payload_shape_check"
    CHECK (
      (
        "status" = 'SUCCEEDED'
        AND "normalized_item_id" IS NOT NULL
        AND "rejection_code" IS NULL
        AND "rejection_detail" IS NULL
      )
      OR
      (
        "status" = 'REJECTED'
        AND "normalized_item_id" IS NULL
        AND "rejection_code" IS NOT NULL
        AND btrim("rejection_code") <> ''
        AND "rejection_detail" IS NOT NULL
        AND btrim("rejection_detail") <> ''
      )
    );
