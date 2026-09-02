import { FixtureIngestionDatasetV1Schema, type FixtureItemV1 } from "@radar/contracts";
import { createSource, type Source } from "@radar/core";
import { beforeAll, describe, expect, it } from "vitest";

import {
  createFixtureSources,
  FixtureSourceAdapter,
  loadFixtureDataset,
  type FixtureSourceAdapterError,
} from "../src/index.js";

const fixturePath = new URL("../../../../fixtures/ingestion/v1/dataset.json", import.meta.url);

let dataset: Awaited<ReturnType<typeof loadFixtureDataset>>;
let sources: readonly Source[];

beforeAll(async () => {
  dataset = await loadFixtureDataset(fixturePath);
  sources = createFixtureSources(dataset);
});

const itemsByGroup = (items: readonly FixtureItemV1[]): Map<string, FixtureItemV1[]> => {
  const groups = new Map<string, FixtureItemV1[]>();
  for (const item of items) {
    if (item.labels.duplicateGroup === null) {
      continue;
    }
    const group = groups.get(item.labels.duplicateGroup) ?? [];
    group.push(item);
    groups.set(item.labels.duplicateGroup, group);
  }
  return groups;
};

describe("fixture-ingestion/v1 dataset", () => {
  it("contains the versioned 200-item quality corpus promised by ART-005", () => {
    expect(dataset.schemaVersion).toBe("fixture-ingestion/v1");
    expect(dataset.sources).toHaveLength(10);
    expect(dataset.items).toHaveLength(200);
    expect(dataset.items.filter((item) => item.labels.vertical === "CONSTRUCTION")).toHaveLength(
      100,
    );
    expect(dataset.items.filter((item) => item.labels.vertical === "HORECA")).toHaveLength(80);
    expect(dataset.items.filter((item) => item.labels.vertical === "OTHER")).toHaveLength(20);
    expect(dataset.items.filter((item) => item.labels.isAdvertisement)).toHaveLength(20);
    expect(dataset.items.filter((item) => item.labels.duplicateKind === "EXACT")).toHaveLength(25);
    expect(dataset.items.filter((item) => item.labels.duplicateKind === "NEAR")).toHaveLength(25);

    const externalIdentities = dataset.items.map((item) =>
      [item.sourceId, item.externalId].join("\u0000"),
    );
    expect(new Set(externalIdentities).size).toBe(200);
  });

  it("validates raw text without trimming the preserved evidence", () => {
    const firstItem = dataset.items[0];
    if (firstItem === undefined) {
      throw new Error("Fixture item is missing");
    }
    const parsed = FixtureIngestionDatasetV1Schema.parse({
      ...dataset,
      items: dataset.items.map((item, index) =>
        index === 0 ? { ...item, rawText: `  ${item.rawText}  ` } : item,
      ),
    });

    expect(parsed.items[0]?.rawText).toBe(`  ${firstItem.rawText}  `);
  });

  it("keeps exact and near duplicate evidence explicit and cross-source", () => {
    const groups = itemsByGroup(dataset.items);

    expect(groups.size).toBe(50);
    for (const group of groups.values()) {
      expect(group).toHaveLength(2);
      const original = group.find((item) => item.labels.duplicateKind === "ORIGINAL");
      const duplicate = group.find((item) => item.labels.duplicateKind !== "ORIGINAL");
      expect(original).toBeDefined();
      expect(duplicate).toBeDefined();
      expect(duplicate?.sourceId).not.toBe(original?.sourceId);

      if (duplicate?.labels.duplicateKind === "EXACT") {
        expect(duplicate.rawText).toBe(original?.rawText);
      } else {
        expect(duplicate?.rawText).not.toBe(original?.rawText);
        expect(duplicate?.rawText.startsWith(original?.rawText ?? "missing")).toBe(true);
      }
    }
  });

  it("contains review-required material to exercise the AI permission boundary", () => {
    const reviewSource = dataset.sources.find(
      (source) => source.rightsStatus === "REVIEW_REQUIRED",
    );

    expect(reviewSource).toBeDefined();
    expect(reviewSource?.aiProcessingAllowed).toBe(false);
    expect(dataset.items.some((item) => item.sourceId === reviewSource?.id)).toBe(true);
  });

  it("rejects cross-record source references that are not declared", () => {
    const invalid = {
      ...dataset,
      items: dataset.items.map((item, index) =>
        index === 0 ? { ...item, sourceId: "62000000-0000-4000-8000-000000000999" } : item,
      ),
    };

    expect(FixtureIngestionDatasetV1Schema.safeParse(invalid).success).toBe(false);
  });
});

describe("FixtureSourceAdapter", () => {
  it("returns deterministic pages without writing persistence", async () => {
    const selectedSource = sources[0];
    if (selectedSource === undefined) {
      throw new Error("Fixture source is missing");
    }
    const adapter = new FixtureSourceAdapter(dataset, {
      now: () => "2026-09-01T12:00:00.000Z",
      pageSize: 7,
    });

    const first = await adapter.fetch({ cursor: null, source: selectedSource });
    const second = await adapter.fetch({ cursor: first.nextCursor, source: selectedSource });

    expect(first).toMatchObject({
      adapter: "fixture-json-v1",
      fetchedAt: "2026-09-01T12:00:00.000Z",
      nextCursor: "7",
      sourceId: selectedSource.id,
      version: "fixture-ingestion/v1",
    });
    expect(first.candidates).toHaveLength(7);
    expect(second.candidates).toHaveLength(7);
    expect(first.candidates[0]).not.toEqual(second.candidates[0]);
  });

  it("rejects invalid cursors and registry configuration drift", async () => {
    const selectedSource = sources[0];
    if (selectedSource === undefined) {
      throw new Error("Fixture source is missing");
    }
    const adapter = new FixtureSourceAdapter(dataset);

    await expect(adapter.fetch({ cursor: "not-a-cursor", source: selectedSource })).rejects.toEqual(
      expect.objectContaining<Partial<FixtureSourceAdapterError>>({
        code: "FIXTURE_CURSOR_INVALID",
      }),
    );

    const changedSource = createSource({
      ...selectedSource,
      url: "https://fixtures.radar.local/changed-source",
    });
    await expect(adapter.fetch({ cursor: null, source: changedSource })).rejects.toEqual(
      expect.objectContaining<Partial<FixtureSourceAdapterError>>({
        code: "FIXTURE_SOURCE_CONFIGURATION_MISMATCH",
      }),
    );
  });
});
