ALTER TABLE "feedback"
  DROP CONSTRAINT "feedback_delivery_id_fkey";

CREATE UNIQUE INDEX "deliveries_feedback_context_key"
  ON "deliveries"("id", "user_id", "recommendation_id");

ALTER TABLE "feedback"
  ADD CONSTRAINT "feedback_delivery_context_fkey"
  FOREIGN KEY ("delivery_id", "user_id", "recommendation_id")
  REFERENCES "deliveries"("id", "user_id", "recommendation_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
