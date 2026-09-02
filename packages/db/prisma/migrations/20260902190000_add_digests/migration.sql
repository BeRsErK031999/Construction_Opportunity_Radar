CREATE TYPE "DigestKind" AS ENUM ('DAILY', 'WEEKLY');

CREATE TABLE "digests" (
  "id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "user_profile_id" UUID NOT NULL,
  "user_profile_revision" INTEGER NOT NULL,
  "kind" "DigestKind" NOT NULL,
  "period_start" TIMESTAMPTZ(3) NOT NULL,
  "period_end" TIMESTAMPTZ(3) NOT NULL,
  "digest_version" VARCHAR(100) NOT NULL,
  "processed_count" INTEGER,
  "unique_count" INTEGER,
  "relevant_count" INTEGER,
  "opportunity_count" INTEGER,
  "high_priority_count" INTEGER,
  "correlation_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "digests_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "digests_period_check" CHECK (
    ("kind" = 'DAILY' AND "period_end" = "period_start" + INTERVAL '1 day')
    OR ("kind" = 'WEEKLY' AND "period_end" = "period_start" + INTERVAL '7 days')
  ),
  CONSTRAINT "digests_period_alignment_check" CHECK (
    date_trunc('day', "period_start" AT TIME ZONE 'UTC') = "period_start" AT TIME ZONE 'UTC'
    AND ("kind" = 'DAILY' OR EXTRACT(ISODOW FROM "period_start" AT TIME ZONE 'UTC') = 1)
  ),
  CONSTRAINT "digests_summary_shape_check" CHECK (
    ("kind" = 'DAILY'
      AND "processed_count" IS NULL
      AND "unique_count" IS NULL
      AND "relevant_count" IS NULL
      AND "opportunity_count" IS NULL
      AND "high_priority_count" IS NULL)
    OR ("kind" = 'WEEKLY'
      AND "processed_count" IS NOT NULL
      AND "unique_count" IS NOT NULL
      AND "relevant_count" IS NOT NULL
      AND "opportunity_count" IS NOT NULL
      AND "high_priority_count" IS NOT NULL)
  ),
  CONSTRAINT "digests_summary_counts_check" CHECK (
    "kind" = 'DAILY'
    OR (
      "processed_count" >= 0
      AND "unique_count" >= 0
      AND "relevant_count" >= 0
      AND "opportunity_count" >= 0
      AND "high_priority_count" >= 0
      AND "high_priority_count" <= "opportunity_count"
    )
  )
);

CREATE TABLE "digest_items" (
  "digest_id" UUID NOT NULL,
  "recommendation_id" UUID NOT NULL,
  "rank" INTEGER NOT NULL,

  CONSTRAINT "digest_items_pkey" PRIMARY KEY ("digest_id", "recommendation_id"),
  CONSTRAINT "digest_items_rank_check" CHECK ("rank" BETWEEN 1 AND 5)
);

CREATE TABLE "digest_category_trends" (
  "digest_id" UUID NOT NULL,
  "category" VARCHAR(200) NOT NULL,
  "current_count" INTEGER NOT NULL,
  "previous_count" INTEGER NOT NULL,
  "delta" INTEGER NOT NULL,
  "rank" INTEGER NOT NULL,

  CONSTRAINT "digest_category_trends_pkey" PRIMARY KEY ("digest_id", "category"),
  CONSTRAINT "digest_category_trends_counts_check" CHECK (
    "current_count" >= 0
    AND "previous_count" >= 0
    AND "delta" = "current_count" - "previous_count"
    AND "delta" > 0
  ),
  CONSTRAINT "digest_category_trends_rank_check" CHECK ("rank" BETWEEN 1 AND 5)
);

CREATE TABLE "digest_deliveries" (
  "id" UUID NOT NULL,
  "digest_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "channel" "DeliveryChannel" NOT NULL,
  "idempotency_key" VARCHAR(200) NOT NULL,
  "status" "DeliveryStatus" NOT NULL,
  "provider_message_id" VARCHAR(200),
  "failure_code" VARCHAR(100),
  "failure_reason" TEXT,
  "correlation_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "digest_deliveries_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "digest_deliveries_status_outcome_check" CHECK (
    ("status" = 'PENDING' AND "provider_message_id" IS NULL AND "failure_code" IS NULL AND "failure_reason" IS NULL)
    OR ("status" = 'SENT' AND "provider_message_id" IS NOT NULL AND "failure_code" IS NULL AND "failure_reason" IS NULL)
    OR ("status" = 'FAILED' AND "provider_message_id" IS NULL AND "failure_code" IS NOT NULL AND "failure_reason" IS NOT NULL)
  ),
  CONSTRAINT "digest_deliveries_time_order_check" CHECK ("updated_at" >= "created_at")
);

CREATE UNIQUE INDEX "digests_id_user_key" ON "digests"("id", "user_id");
CREATE UNIQUE INDEX "digests_identity_key"
  ON "digests"("user_id", "kind", "period_start", "period_end", "digest_version");
CREATE INDEX "digests_user_kind_period_idx" ON "digests"("user_id", "kind", "period_start");
CREATE UNIQUE INDEX "digest_items_rank_key" ON "digest_items"("digest_id", "rank");
CREATE INDEX "digest_items_recommendation_idx" ON "digest_items"("recommendation_id");
CREATE UNIQUE INDEX "digest_category_trends_rank_key"
  ON "digest_category_trends"("digest_id", "rank");
CREATE UNIQUE INDEX "digest_deliveries_channel_digest_key"
  ON "digest_deliveries"("channel", "digest_id");
CREATE UNIQUE INDEX "digest_deliveries_channel_idempotency_key"
  ON "digest_deliveries"("channel", "idempotency_key");
CREATE UNIQUE INDEX "digest_deliveries_channel_user_provider_message_key"
  ON "digest_deliveries"("channel", "user_id", "provider_message_id");
CREATE INDEX "digest_deliveries_user_status_created_idx"
  ON "digest_deliveries"("user_id", "status", "created_at");

ALTER TABLE "digests"
  ADD CONSTRAINT "digests_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "digests"
  ADD CONSTRAINT "digests_user_profile_fkey"
  FOREIGN KEY ("user_profile_id", "user_profile_revision")
  REFERENCES "company_profile_revisions"("id", "revision")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "digest_items"
  ADD CONSTRAINT "digest_items_digest_id_fkey"
  FOREIGN KEY ("digest_id") REFERENCES "digests"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "digest_items"
  ADD CONSTRAINT "digest_items_recommendation_id_fkey"
  FOREIGN KEY ("recommendation_id") REFERENCES "recommendations"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "digest_category_trends"
  ADD CONSTRAINT "digest_category_trends_digest_id_fkey"
  FOREIGN KEY ("digest_id") REFERENCES "digests"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "digest_deliveries"
  ADD CONSTRAINT "digest_deliveries_digest_user_fkey"
  FOREIGN KEY ("digest_id", "user_id") REFERENCES "digests"("id", "user_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "digest_deliveries"
  ADD CONSTRAINT "digest_deliveries_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
