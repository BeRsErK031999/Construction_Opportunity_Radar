-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "SourceType" AS ENUM ('FIXTURE', 'RSS', 'PUBLIC_API', 'WEB', 'PARTNER_FEED', 'PARTNER_TELEGRAM', 'MANUAL');

-- CreateEnum
CREATE TYPE "RightsStatus" AS ENUM ('OPEN_DATA', 'PUBLIC_API', 'PARTNER', 'CONSENT', 'REVIEW_REQUIRED', 'BLOCKED');

-- CreateEnum
CREATE TYPE "ParserKind" AS ENUM ('FIXTURE_JSON', 'RSS', 'JSON_API', 'HTML', 'MANUAL');

-- CreateEnum
CREATE TYPE "Vertical" AS ENUM ('CONSTRUCTION', 'HORECA', 'OTHER');

-- CreateEnum
CREATE TYPE "SignalStatus" AS ENUM ('CANDIDATE', 'ACTIVE', 'DISMISSED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "AnalysisStatus" AS ENUM ('SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'BLOCKED', 'DELETED');

-- CreateEnum
CREATE TYPE "CompanySize" AS ENUM ('SELF_EMPLOYED', 'MICRO', 'SMALL', 'MEDIUM', 'LARGE');

-- CreateEnum
CREATE TYPE "ProfileVertical" AS ENUM ('CONSTRUCTION', 'HORECA');

-- CreateEnum
CREATE TYPE "OpportunityBand" AS ENUM ('IGNORE', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "FeedbackAction" AS ENUM ('USEFUL', 'NOT_USEFUL', 'SAVED', 'ACTED', 'ALREADY_KNOWN');

-- CreateTable
CREATE TABLE "sources" (
    "id" UUID NOT NULL,
    "name" VARCHAR(300) NOT NULL,
    "url" TEXT NOT NULL,
    "type" "SourceType" NOT NULL,
    "country" VARCHAR(100) NOT NULL,
    "regions" TEXT[],
    "verticals" "Vertical"[],
    "rights_status" "RightsStatus" NOT NULL,
    "rights_basis" TEXT,
    "owner_contact" VARCHAR(500),
    "ai_processing_allowed" BOOLEAN NOT NULL,
    "parser_kind" "ParserKind" NOT NULL,
    "poll_interval_minutes" INTEGER,
    "reliability_score" DOUBLE PRECISION NOT NULL,
    "signal_quality_notes" TEXT,
    "enabled" BOOLEAN NOT NULL,
    "last_success_at" TIMESTAMPTZ(3),
    "last_error_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "raw_items" (
    "id" UUID NOT NULL,
    "source_id" UUID NOT NULL,
    "external_id" VARCHAR(500),
    "original_url" TEXT NOT NULL,
    "published_at" TIMESTAMPTZ(3),
    "received_at" TIMESTAMPTZ(3) NOT NULL,
    "raw_text" TEXT NOT NULL,
    "raw_payload" JSONB,
    "content_hash" CHAR(64) NOT NULL,
    "correlation_id" UUID NOT NULL,

    CONSTRAINT "raw_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "normalized_items" (
    "id" UUID NOT NULL,
    "raw_item_id" UUID NOT NULL,
    "normalizer_version" VARCHAR(100) NOT NULL,
    "title" VARCHAR(1000),
    "text" TEXT NOT NULL,
    "language" VARCHAR(35) NOT NULL,
    "published_at" TIMESTAMPTZ(3),
    "canonical_url" TEXT NOT NULL,
    "entities" JSONB NOT NULL DEFAULT '[]',
    "normalized_hash" CHAR(64) NOT NULL,
    "correlation_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "normalized_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "signals" (
    "id" UUID NOT NULL,
    "vertical" "Vertical" NOT NULL,
    "category" VARCHAR(200) NOT NULL,
    "relevance_score" DOUBLE PRECISION NOT NULL,
    "classification_confidence" DOUBLE PRECISION NOT NULL,
    "classifier_version" VARCHAR(100) NOT NULL,
    "taxonomy_version" VARCHAR(100) NOT NULL,
    "status" "SignalStatus" NOT NULL,
    "superseded_by_signal_id" UUID,
    "correlation_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "signals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "signal_evidence" (
    "signal_id" UUID NOT NULL,
    "normalized_item_id" UUID NOT NULL,
    "source_id" UUID NOT NULL,

    CONSTRAINT "signal_evidence_pkey" PRIMARY KEY ("signal_id","normalized_item_id","source_id")
);

-- CreateTable
CREATE TABLE "analyses" (
    "id" UUID NOT NULL,
    "signal_id" UUID NOT NULL,
    "provider" VARCHAR(100) NOT NULL,
    "model" VARCHAR(200) NOT NULL,
    "prompt_version" VARCHAR(100) NOT NULL,
    "schema_version" VARCHAR(100) NOT NULL,
    "analysis_version" VARCHAR(100) NOT NULL,
    "status" "AnalysisStatus" NOT NULL,
    "headline" VARCHAR(500),
    "summary" TEXT,
    "why_important" TEXT,
    "event_type" VARCHAR(200),
    "facts" JSONB,
    "inferences" JSONB,
    "entities" JSONB,
    "risks" JSONB,
    "candidate_actions" JSONB,
    "deadline" TIMESTAMPTZ(3),
    "business_impact" DOUBLE PRECISION,
    "urgency" DOUBLE PRECISION,
    "confidence" DOUBLE PRECISION,
    "actionability" DOUBLE PRECISION,
    "failure_code" VARCHAR(100),
    "failure_reason" TEXT,
    "retryable" BOOLEAN,
    "correlation_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "analyses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analysis_sources" (
    "analysis_id" UUID NOT NULL,
    "source_id" UUID NOT NULL,

    CONSTRAINT "analysis_sources_pkey" PRIMARY KEY ("analysis_id","source_id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "telegram_user_id" VARCHAR(100) NOT NULL,
    "status" "UserStatus" NOT NULL,
    "revision" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_profile_revisions" (
    "id" UUID NOT NULL,
    "revision" INTEGER NOT NULL,
    "user_id" UUID NOT NULL,
    "company_type" VARCHAR(300) NOT NULL,
    "company_size" "CompanySize" NOT NULL,
    "verticals" "ProfileVertical"[],
    "regions" TEXT[],
    "services_and_products" TEXT[],
    "target_clients" TEXT[],
    "interested_event_types" TEXT[],
    "ignored_event_types" TEXT[],
    "keywords" TEXT[],
    "excluded_keywords" TEXT[],
    "project_value_minimum" DOUBLE PRECISION,
    "project_value_maximum" DOUBLE PRECISION,
    "project_value_currency" CHAR(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "company_profile_revisions_pkey" PRIMARY KEY ("id","revision")
);

-- CreateTable
CREATE TABLE "recommendations" (
    "id" UUID NOT NULL,
    "signal_id" UUID NOT NULL,
    "analysis_id" UUID NOT NULL,
    "user_profile_id" UUID NOT NULL,
    "user_profile_revision" INTEGER NOT NULL,
    "business_impact" DOUBLE PRECISION NOT NULL,
    "company_fit" DOUBLE PRECISION NOT NULL,
    "urgency" DOUBLE PRECISION NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "actionability" DOUBLE PRECISION NOT NULL,
    "total_score" DOUBLE PRECISION NOT NULL,
    "band" "OpportunityBand" NOT NULL,
    "explanation" TEXT NOT NULL,
    "recommended_actions" JSONB NOT NULL,
    "scoring_version" VARCHAR(100) NOT NULL,
    "correlation_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "recommendations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recommendation_sources" (
    "recommendation_id" UUID NOT NULL,
    "source_id" UUID NOT NULL,

    CONSTRAINT "recommendation_sources_pkey" PRIMARY KEY ("recommendation_id","source_id")
);

-- CreateTable
CREATE TABLE "feedback" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "recommendation_id" UUID NOT NULL,
    "delivery_id" UUID,
    "action" "FeedbackAction" NOT NULL,
    "reason" TEXT,
    "correlation_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "feedback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sources_permission_idx" ON "sources"("enabled", "rights_status", "ai_processing_allowed");

-- CreateIndex
CREATE INDEX "raw_items_source_published_idx" ON "raw_items"("source_id", "published_at");

-- CreateIndex
CREATE INDEX "raw_items_received_idx" ON "raw_items"("received_at");

-- CreateIndex
CREATE UNIQUE INDEX "raw_items_source_external_key" ON "raw_items"("source_id", "external_id");

-- CreateIndex
CREATE UNIQUE INDEX "raw_items_source_hash_key" ON "raw_items"("source_id", "content_hash");

-- CreateIndex
CREATE INDEX "normalized_items_hash_idx" ON "normalized_items"("normalized_hash");

-- CreateIndex
CREATE INDEX "normalized_items_canonical_url_idx" ON "normalized_items"("canonical_url");

-- CreateIndex
CREATE INDEX "normalized_items_published_idx" ON "normalized_items"("published_at");

-- CreateIndex
CREATE UNIQUE INDEX "normalized_items_raw_version_key" ON "normalized_items"("raw_item_id", "normalizer_version");

-- CreateIndex
CREATE INDEX "signals_discovery_idx" ON "signals"("vertical", "category", "status", "created_at");

-- CreateIndex
CREATE INDEX "signal_evidence_normalized_idx" ON "signal_evidence"("normalized_item_id");

-- CreateIndex
CREATE INDEX "signal_evidence_source_idx" ON "signal_evidence"("source_id");

-- CreateIndex
CREATE INDEX "analyses_signal_status_idx" ON "analyses"("signal_id", "status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "analyses_identity_key" ON "analyses"("signal_id", "provider", "model", "prompt_version", "schema_version", "analysis_version");

-- CreateIndex
CREATE UNIQUE INDEX "analyses_id_signal_key" ON "analyses"("id", "signal_id");

-- CreateIndex
CREATE INDEX "analysis_sources_source_idx" ON "analysis_sources"("source_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_telegram_user_key" ON "users"("telegram_user_id");

-- CreateIndex
CREATE INDEX "company_profile_user_revision_idx" ON "company_profile_revisions"("user_id", "revision");

-- CreateIndex
CREATE INDEX "recommendations_profile_score_idx" ON "recommendations"("user_profile_id", "user_profile_revision", "band", "total_score");

-- CreateIndex
CREATE UNIQUE INDEX "recommendations_identity_key" ON "recommendations"("signal_id", "analysis_id", "user_profile_id", "user_profile_revision", "scoring_version");

-- CreateIndex
CREATE INDEX "recommendation_sources_source_idx" ON "recommendation_sources"("source_id");

-- CreateIndex
CREATE INDEX "feedback_created_idx" ON "feedback"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "feedback_identity_key" ON "feedback"("user_id", "recommendation_id", "action");

-- AddForeignKey
ALTER TABLE "raw_items" ADD CONSTRAINT "raw_items_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "sources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "normalized_items" ADD CONSTRAINT "normalized_items_raw_item_id_fkey" FOREIGN KEY ("raw_item_id") REFERENCES "raw_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "signals" ADD CONSTRAINT "signals_superseded_by_signal_id_fkey" FOREIGN KEY ("superseded_by_signal_id") REFERENCES "signals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "signal_evidence" ADD CONSTRAINT "signal_evidence_signal_id_fkey" FOREIGN KEY ("signal_id") REFERENCES "signals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "signal_evidence" ADD CONSTRAINT "signal_evidence_normalized_item_id_fkey" FOREIGN KEY ("normalized_item_id") REFERENCES "normalized_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "signal_evidence" ADD CONSTRAINT "signal_evidence_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "sources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analyses" ADD CONSTRAINT "analyses_signal_id_fkey" FOREIGN KEY ("signal_id") REFERENCES "signals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analysis_sources" ADD CONSTRAINT "analysis_sources_analysis_id_fkey" FOREIGN KEY ("analysis_id") REFERENCES "analyses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analysis_sources" ADD CONSTRAINT "analysis_sources_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "sources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_profile_revisions" ADD CONSTRAINT "company_profile_revisions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recommendations" ADD CONSTRAINT "recommendations_signal_id_fkey" FOREIGN KEY ("signal_id") REFERENCES "signals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recommendations" ADD CONSTRAINT "recommendations_analysis_id_signal_id_fkey" FOREIGN KEY ("analysis_id", "signal_id") REFERENCES "analyses"("id", "signal_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recommendations" ADD CONSTRAINT "recommendations_user_profile_id_user_profile_revision_fkey" FOREIGN KEY ("user_profile_id", "user_profile_revision") REFERENCES "company_profile_revisions"("id", "revision") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recommendation_sources" ADD CONSTRAINT "recommendation_sources_recommendation_id_fkey" FOREIGN KEY ("recommendation_id") REFERENCES "recommendations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recommendation_sources" ADD CONSTRAINT "recommendation_sources_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "sources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_recommendation_id_fkey" FOREIGN KEY ("recommendation_id") REFERENCES "recommendations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Domain invariants not expressible in Prisma Schema Language.
ALTER TABLE "sources"
  ADD CONSTRAINT "sources_nonempty_dimensions_check"
    CHECK (cardinality("regions") > 0 AND cardinality("verticals") > 0),
  ADD CONSTRAINT "sources_reliability_score_check"
    CHECK ("reliability_score" >= 0 AND "reliability_score" <= 100),
  ADD CONSTRAINT "sources_timestamp_order_check"
    CHECK (
      "updated_at" >= "created_at"
      AND ("last_success_at" IS NULL OR "last_success_at" >= "created_at")
      AND ("last_error_at" IS NULL OR "last_error_at" >= "created_at")
    ),
  ADD CONSTRAINT "sources_poll_policy_check"
    CHECK (
      ("poll_interval_minutes" IS NOT NULL AND "poll_interval_minutes" > 0)
      OR ("poll_interval_minutes" IS NULL AND "type" IN ('FIXTURE', 'MANUAL'))
    ),
  ADD CONSTRAINT "sources_ai_permission_check"
    CHECK (
      NOT "ai_processing_allowed"
      OR (
        "rights_status" IN ('OPEN_DATA', 'PUBLIC_API', 'PARTNER', 'CONSENT')
        AND "rights_basis" IS NOT NULL
        AND btrim("rights_basis") <> ''
      )
    ),
  ADD CONSTRAINT "sources_telegram_permission_check"
    CHECK (
      "type" <> 'PARTNER_TELEGRAM'
      OR "rights_status" IN ('PARTNER', 'CONSENT')
    );

ALTER TABLE "raw_items"
  ADD CONSTRAINT "raw_items_raw_text_check"
    CHECK (btrim("raw_text") <> ''),
  ADD CONSTRAINT "raw_items_content_hash_check"
    CHECK ("content_hash" ~ '^[0-9a-f]{64}$');

ALTER TABLE "normalized_items"
  ADD CONSTRAINT "normalized_items_text_check"
    CHECK (btrim("text") <> ''),
  ADD CONSTRAINT "normalized_items_entities_check"
    CHECK (jsonb_typeof("entities") = 'array'),
  ADD CONSTRAINT "normalized_items_hash_check"
    CHECK ("normalized_hash" ~ '^[0-9a-f]{64}$');

ALTER TABLE "signals"
  ADD CONSTRAINT "signals_scores_check"
    CHECK (
      "relevance_score" >= 0 AND "relevance_score" <= 100
      AND "classification_confidence" >= 0 AND "classification_confidence" <= 100
    ),
  ADD CONSTRAINT "signals_timestamp_order_check"
    CHECK ("updated_at" >= "created_at"),
  ADD CONSTRAINT "signals_supersession_check"
    CHECK (
      ("status" = 'SUPERSEDED') = ("superseded_by_signal_id" IS NOT NULL)
      AND "superseded_by_signal_id" IS DISTINCT FROM "id"
    );

ALTER TABLE "analyses"
  ADD CONSTRAINT "analyses_payload_shape_check"
    CHECK (
      (
        "status" = 'SUCCEEDED'
        AND "headline" IS NOT NULL
        AND "summary" IS NOT NULL
        AND "why_important" IS NOT NULL
        AND "event_type" IS NOT NULL
        AND jsonb_typeof("facts") = 'array'
        AND jsonb_array_length("facts") > 0
        AND jsonb_typeof("inferences") = 'array'
        AND jsonb_typeof("entities") = 'array'
        AND jsonb_typeof("risks") = 'array'
        AND jsonb_typeof("candidate_actions") = 'array'
        AND jsonb_array_length("candidate_actions") <= 5
        AND "business_impact" IS NOT NULL
        AND "urgency" IS NOT NULL
        AND "confidence" IS NOT NULL
        AND "actionability" IS NOT NULL
        AND "failure_code" IS NULL
        AND "failure_reason" IS NULL
        AND "retryable" IS NULL
      )
      OR (
        "status" = 'FAILED'
        AND "headline" IS NULL
        AND "summary" IS NULL
        AND "why_important" IS NULL
        AND "event_type" IS NULL
        AND "facts" IS NULL
        AND "inferences" IS NULL
        AND "entities" IS NULL
        AND "risks" IS NULL
        AND "candidate_actions" IS NULL
        AND "deadline" IS NULL
        AND "business_impact" IS NULL
        AND "urgency" IS NULL
        AND "confidence" IS NULL
        AND "actionability" IS NULL
        AND "failure_code" IS NOT NULL
        AND "failure_reason" IS NOT NULL
        AND "retryable" IS NOT NULL
      )
    ),
  ADD CONSTRAINT "analyses_scores_check"
    CHECK (
      ("business_impact" IS NULL OR ("business_impact" >= 0 AND "business_impact" <= 100))
      AND ("urgency" IS NULL OR ("urgency" >= 0 AND "urgency" <= 100))
      AND ("confidence" IS NULL OR ("confidence" >= 0 AND "confidence" <= 1))
      AND ("actionability" IS NULL OR ("actionability" >= 0 AND "actionability" <= 100))
    );

ALTER TABLE "users"
  ADD CONSTRAINT "users_revision_check"
    CHECK ("revision" > 0),
  ADD CONSTRAINT "users_timestamp_order_check"
    CHECK ("updated_at" >= "created_at");

ALTER TABLE "company_profile_revisions"
  ADD CONSTRAINT "company_profiles_revision_check"
    CHECK ("revision" > 0),
  ADD CONSTRAINT "company_profiles_dimensions_check"
    CHECK (cardinality("verticals") > 0 AND cardinality("regions") > 0 AND cardinality("services_and_products") > 0),
  ADD CONSTRAINT "company_profiles_project_value_check"
    CHECK (
      ("project_value_minimum" IS NULL OR "project_value_minimum" >= 0)
      AND ("project_value_maximum" IS NULL OR "project_value_maximum" >= 0)
      AND (
        "project_value_minimum" IS NULL
        OR "project_value_maximum" IS NULL
        OR "project_value_minimum" <= "project_value_maximum"
      )
      AND (
        ("project_value_minimum" IS NULL AND "project_value_maximum" IS NULL AND "project_value_currency" IS NULL)
        OR (
          ("project_value_minimum" IS NOT NULL OR "project_value_maximum" IS NOT NULL)
          AND "project_value_currency" ~ '^[A-Z]{3}$'
        )
      )
    ),
  ADD CONSTRAINT "company_profiles_timestamp_order_check"
    CHECK ("updated_at" >= "created_at");

ALTER TABLE "recommendations"
  ADD CONSTRAINT "recommendations_scores_check"
    CHECK (
      "business_impact" >= 0 AND "business_impact" <= 100
      AND "company_fit" >= 0 AND "company_fit" <= 100
      AND "urgency" >= 0 AND "urgency" <= 100
      AND "confidence" >= 0 AND "confidence" <= 100
      AND "actionability" >= 0 AND "actionability" <= 100
      AND "total_score" >= 0 AND "total_score" <= 100
    ),
  ADD CONSTRAINT "recommendations_actions_check"
    CHECK (
      jsonb_typeof("recommended_actions") = 'array'
      AND jsonb_array_length("recommended_actions") BETWEEN 2 AND 5
    );

CREATE UNIQUE INDEX "feedback_sentiment_key"
  ON "feedback"("user_id", "recommendation_id")
  WHERE "action" IN ('USEFUL', 'NOT_USEFUL');
