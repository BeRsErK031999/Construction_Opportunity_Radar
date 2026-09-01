import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { createDevelopmentSeedData } from "../src/index.js";

const migrationPath = new URL(
  "../prisma/migrations/20260901090000_init_domain/migration.sql",
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
});
