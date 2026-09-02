CREATE TYPE "DeliveryChannel" AS ENUM ('TELEGRAM');
CREATE TYPE "DeliveryKind" AS ENUM ('OPPORTUNITY');
CREATE TYPE "DeliveryStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');

CREATE TABLE "deliveries" (
  "id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "recommendation_id" UUID NOT NULL,
  "channel" "DeliveryChannel" NOT NULL,
  "kind" "DeliveryKind" NOT NULL,
  "idempotency_key" VARCHAR(200) NOT NULL,
  "status" "DeliveryStatus" NOT NULL,
  "provider_message_id" VARCHAR(200),
  "failure_code" VARCHAR(100),
  "failure_reason" TEXT,
  "correlation_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "deliveries_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "deliveries_status_outcome_check" CHECK (
    ("status" = 'PENDING' AND "provider_message_id" IS NULL AND "failure_code" IS NULL AND "failure_reason" IS NULL)
    OR ("status" = 'SENT' AND "provider_message_id" IS NOT NULL AND "failure_code" IS NULL AND "failure_reason" IS NULL)
    OR ("status" = 'FAILED' AND "provider_message_id" IS NULL AND "failure_code" IS NOT NULL AND "failure_reason" IS NOT NULL)
  ),
  CONSTRAINT "deliveries_time_order_check" CHECK ("updated_at" >= "created_at")
);

CREATE UNIQUE INDEX "deliveries_channel_idempotency_key"
  ON "deliveries"("channel", "idempotency_key");
CREATE UNIQUE INDEX "deliveries_channel_user_provider_message_key"
  ON "deliveries"("channel", "user_id", "provider_message_id");
CREATE INDEX "deliveries_user_status_created_idx"
  ON "deliveries"("user_id", "status", "created_at");
CREATE INDEX "deliveries_recommendation_idx"
  ON "deliveries"("recommendation_id");

ALTER TABLE "deliveries"
  ADD CONSTRAINT "deliveries_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "deliveries"
  ADD CONSTRAINT "deliveries_recommendation_id_fkey"
  FOREIGN KEY ("recommendation_id") REFERENCES "recommendations"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "feedback"
  ADD CONSTRAINT "feedback_delivery_id_fkey"
  FOREIGN KEY ("delivery_id") REFERENCES "deliveries"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
