import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { createDevelopmentSeedData } from "../src/index.js";

const migrationPath = new URL(
  "../prisma/migrations/20260901090000_init_domain/migration.sql",
  import.meta.url,
);
const normalizationMigrationPath = new URL(
  "../prisma/migrations/20260902090000_add_normalization_attempts/migration.sql",
  import.meta.url,
);
const deduplicationMigrationPath = new URL(
  "../prisma/migrations/20260902110000_add_deduplication_assignments/migration.sql",
  import.meta.url,
);
const deliveryMigrationPath = new URL(
  "../prisma/migrations/20260902150000_add_telegram_deliveries/migration.sql",
  import.meta.url,
);
const feedbackContextMigrationPath = new URL(
  "../prisma/migrations/20260902170000_enforce_feedback_delivery_context/migration.sql",
  import.meta.url,
);

describe("development seed contract", () => {
  it("contains ten sources and one hundred uniquely attributable raw items", () => {
    const seed = createDevelopmentSeedData();

    expect(seed.sources).toHaveLength(10);
    expect(seed.rawItems).toHaveLength(100);
    expect(new Set(seed.sources.map((source) => source.id)).size).toBe(10);
    expect(new Set(seed.rawItems.map((item) => item.id)).size).toBe(100);
    expect(new Set(seed.rawItems.map((item) => item.contentHash)).size).toBe(100);
    expect(
      seed.sources.every(
        (source) => seed.rawItems.filter((item) => item.sourceId === source.id).length === 10,
      ),
    ).toBe(true);
  });

  it("stays limited to the two MVP profile verticals", () => {
    const verticals = new Set(
      createDevelopmentSeedData().sources.flatMap((source) => source.verticals),
    );
    expect(verticals).toEqual(new Set(["CONSTRUCTION", "HORECA"]));
  });
});

describe("initial migration contract", () => {
  it("keeps permission, idempotency, score, and feedback constraints in SQL", async () => {
    const migration = await readFile(migrationPath, "utf8");

    expect(migration).toContain('CONSTRAINT "sources_ai_permission_check"');
    expect(migration).toContain('"raw_items_source_external_key"');
    expect(migration).toContain('"raw_items_source_hash_key"');
    expect(migration).toContain('CONSTRAINT "recommendations_scores_check"');
    expect(migration).toContain('CREATE UNIQUE INDEX "feedback_sentiment_key"');
  });

  it("stores versioned normalization success and rejection outcomes separately", async () => {
    const migration = await readFile(normalizationMigrationPath, "utf8");

    expect(migration).toContain('CREATE TABLE "normalization_attempts"');
    expect(migration).toContain('"normalization_attempts_raw_version_key"');
    expect(migration).toContain('CONSTRAINT "normalization_attempts_payload_shape_check"');
    expect(migration).toContain(
      'FOREIGN KEY ("normalized_item_id", "raw_item_id", "normalizer_version")',
    );
  });

  it("keeps versioned dedup evidence and metric bounds in SQL", async () => {
    const migration = await readFile(deduplicationMigrationPath, "utf8");

    expect(migration).toContain('CREATE TABLE "deduplication_assignments"');
    expect(migration).toContain('CONSTRAINT "deduplication_assignments_metrics_check"');
    expect(migration).toContain('CONSTRAINT "deduplication_assignments_representative_check"');
    expect(migration).toContain('"deduplication_assignments_cluster_idx"');
  });

  it("persists idempotent Telegram outcomes and links feedback to delivery", async () => {
    const migration = await readFile(deliveryMigrationPath, "utf8");

    expect(migration).toContain('CREATE TABLE "deliveries"');
    expect(migration).toContain('CONSTRAINT "deliveries_status_outcome_check"');
    expect(migration).toContain('CONSTRAINT "deliveries_time_order_check"');
    expect(migration).toContain('"deliveries_channel_idempotency_key"');
    expect(migration).toContain('"deliveries_channel_user_provider_message_key"');
    expect(migration).toContain('CONSTRAINT "feedback_delivery_id_fkey"');
  });

  it("binds feedback delivery to the same user and recommendation", async () => {
    const migration = await readFile(feedbackContextMigrationPath, "utf8");

    expect(migration).toContain('"deliveries_feedback_context_key"');
    expect(migration).toContain('CONSTRAINT "feedback_delivery_context_fkey"');
    expect(migration).toContain('FOREIGN KEY ("delivery_id", "user_id", "recommendation_id")');
  });
});
