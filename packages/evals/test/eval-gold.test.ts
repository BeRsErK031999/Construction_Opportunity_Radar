import { readFile } from "node:fs/promises";

import { EvalGoldDatasetV1Schema, FixtureIngestionDatasetV1Schema } from "@radar/contracts";
import { describe, expect, it } from "vitest";

import { loadEvalGoldDataset, summarizeEvalGoldDataset } from "../src/index.js";

const evalDatasetPath = new URL("../../../fixtures/evals/v1/dataset.json", import.meta.url);
const ingestionDatasetPath = new URL(
  "../../../fixtures/ingestion/v1/dataset.json",
  import.meta.url,
);

const normalizeText = (value: string): string =>
  value.replace(/\s+/gu, " ").trim().toLocaleLowerCase("ru");

describe("eval-gold/v1", () => {
  it("loads the versioned 200-item Construction and HoReCa baseline", async () => {
    const dataset = await loadEvalGoldDataset(evalDatasetPath);
    const summary = summarizeEvalGoldDataset(dataset);

    expect(summary.contentSha256).toMatch(/^[a-f\d]{64}$/u);
    expect(summary).toEqual({
      contentSha256: "5457ac44d5fc1fff1b216d9aa0fb6a1a168e913b195811e5b633fc2d8238357a",
      datasetId: "construction-opportunity-radar-eval-gold-v1",
      facts: { maximumPerItem: 2, minimumPerItem: 1, total: 360 },
      items: 200,
      relevance: { irrelevant: 40, relevant: 160 },
      schemaVersion: "eval-gold/v1",
      splits: { calibration: 80, holdout: 120 },
      verticals: { construction: 100, horeca: 100 },
    });
  });

  it("keeps every fact grounded in an exact source fragment", async () => {
    const dataset = await loadEvalGoldDataset(evalDatasetPath);

    for (const item of dataset.items) {
      expect(item.labels.facts.length).toBeGreaterThanOrEqual(1);
      expect(item.labels.facts.length).toBeLessThanOrEqual(3);
      for (const fact of item.labels.facts) {
        expect(item.source.text).toContain(fact.evidenceQuote);
      }
    }
  });

  it("has no source-text overlap with ingestion fixtures", async () => {
    const evalDataset = await loadEvalGoldDataset(evalDatasetPath);
    const ingestionDataset = FixtureIngestionDatasetV1Schema.parse(
      JSON.parse(await readFile(ingestionDatasetPath, "utf8")) as unknown,
    );
    const ingestionTexts = new Set(
      ingestionDataset.items.map(({ rawText }) => normalizeText(rawText)),
    );

    const overlappingTexts = evalDataset.items.filter(({ source }) =>
      ingestionTexts.has(normalizeText(source.text)),
    );

    expect(overlappingTexts).toEqual([]);
  });

  it("rejects labels whose evidence is absent from the source text", async () => {
    const dataset = structuredClone(await loadEvalGoldDataset(evalDatasetPath));
    const firstItem = dataset.items[0];
    const firstFact = firstItem?.labels.facts[0];
    if (firstFact === undefined) {
      throw new Error("The fixture must contain a first fact");
    }
    firstFact.evidenceQuote = "Этого фрагмента нет в исходном тексте.";

    const result = EvalGoldDatasetV1Schema.safeParse(dataset);

    expect(result.success).toBe(false);
  });
});
