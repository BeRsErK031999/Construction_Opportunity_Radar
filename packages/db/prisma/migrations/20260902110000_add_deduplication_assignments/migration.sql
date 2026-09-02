-- CreateEnum
CREATE TYPE "DeduplicationMatchKind" AS ENUM (
  'REPRESENTATIVE',
  'SOURCE_IDENTITY',
  'CANONICAL_URL',
  'NORMALIZED_HASH',
  'NEAR_TEXT'
);

-- CreateTable
CREATE TABLE "deduplication_assignments" (
  "normalized_item_id" UUID NOT NULL,
  "deduplicator_version" VARCHAR(100) NOT NULL,
  "representative_normalized_item_id" UUID NOT NULL,
  "matched_to_normalized_item_id" UUID NOT NULL,
  "match_kind" "DeduplicationMatchKind" NOT NULL,
  "similarity" DOUBLE PRECISION NOT NULL,
  "time_distance_hours" DOUBLE PRECISION NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "deduplication_assignments_pkey"
    PRIMARY KEY ("normalized_item_id", "deduplicator_version")
);

-- CreateIndex
CREATE INDEX "deduplication_assignments_cluster_idx"
  ON "deduplication_assignments"("deduplicator_version", "representative_normalized_item_id");

-- CreateIndex
CREATE INDEX "deduplication_assignments_kind_idx"
  ON "deduplication_assignments"("deduplicator_version", "match_kind");

-- AddForeignKey
ALTER TABLE "deduplication_assignments"
  ADD CONSTRAINT "deduplication_assignments_normalized_item_id_fkey"
    FOREIGN KEY ("normalized_item_id") REFERENCES "normalized_items"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deduplication_assignments"
  ADD CONSTRAINT "deduplication_assignments_representative_id_fkey"
    FOREIGN KEY ("representative_normalized_item_id") REFERENCES "normalized_items"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deduplication_assignments"
  ADD CONSTRAINT "deduplication_assignments_matched_to_id_fkey"
    FOREIGN KEY ("matched_to_normalized_item_id") REFERENCES "normalized_items"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- Keep metrics bounded and make representative rows explicit self-evidence.
ALTER TABLE "deduplication_assignments"
  ADD CONSTRAINT "deduplication_assignments_metrics_check"
    CHECK (
      "similarity" >= 0
      AND "similarity" <= 1
      AND "time_distance_hours" >= 0
    ),
  ADD CONSTRAINT "deduplication_assignments_representative_check"
    CHECK (
      (
        "match_kind" = 'REPRESENTATIVE'
        AND "normalized_item_id" = "representative_normalized_item_id"
        AND "normalized_item_id" = "matched_to_normalized_item_id"
        AND "similarity" = 1
        AND "time_distance_hours" = 0
      )
      OR "match_kind" <> 'REPRESENTATIVE'
    );
