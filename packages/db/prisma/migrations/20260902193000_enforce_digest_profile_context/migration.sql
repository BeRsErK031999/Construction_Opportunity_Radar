ALTER TABLE "digests"
  DROP CONSTRAINT "digests_user_profile_fkey";

CREATE UNIQUE INDEX "company_profile_identity_user_key"
  ON "company_profile_revisions"("id", "revision", "user_id");

ALTER TABLE "digests"
  ADD CONSTRAINT "digests_user_profile_context_fkey"
  FOREIGN KEY ("user_profile_id", "user_profile_revision", "user_id")
  REFERENCES "company_profile_revisions"("id", "revision", "user_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
