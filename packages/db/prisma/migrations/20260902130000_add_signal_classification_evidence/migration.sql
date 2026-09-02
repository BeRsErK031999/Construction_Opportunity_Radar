ALTER TABLE "signals"
  ADD COLUMN "classification_rule_ids" TEXT[] NOT NULL,
  ADD COLUMN "deduplicator_version" VARCHAR(100) NOT NULL,
  ADD COLUMN "deduplication_representative_normalized_item_id" UUID NOT NULL;

CREATE UNIQUE INDEX "signals_classification_identity_key"
  ON "signals"(
    "deduplication_representative_normalized_item_id",
    "deduplicator_version",
    "classifier_version",
    "taxonomy_version"
  );

ALTER TABLE "signals"
  ADD CONSTRAINT "signals_deduplication_representative_normalized_item_id_fkey"
  FOREIGN KEY ("deduplication_representative_normalized_item_id")
  REFERENCES "normalized_items"("id")
  ON DELETE RESTRICT
  ON UPDATE CASCADE;

ALTER TABLE "signals"
  ADD CONSTRAINT "signals_classification_rule_ids_check"
  CHECK (cardinality("classification_rule_ids") > 0);
