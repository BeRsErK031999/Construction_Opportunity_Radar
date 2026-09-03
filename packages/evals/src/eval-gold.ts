import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { EvalGoldDatasetV1Schema, type EvalGoldDatasetV1 } from "@radar/contracts";

export interface EvalGoldDatasetSummary {
  readonly contentSha256: string;
  readonly datasetId: string;
  readonly facts: {
    readonly maximumPerItem: number;
    readonly minimumPerItem: number;
    readonly total: number;
  };
  readonly items: number;
  readonly relevance: Readonly<Record<"irrelevant" | "relevant", number>>;
  readonly schemaVersion: string;
  readonly splits: Readonly<Record<"calibration" | "holdout", number>>;
  readonly verticals: Readonly<Record<"construction" | "horeca", number>>;
}

export const loadEvalGoldDataset = async (path: string | URL): Promise<EvalGoldDatasetV1> => {
  const contents = await readFile(path, "utf8");
  return EvalGoldDatasetV1Schema.parse(JSON.parse(contents) as unknown);
};

export const summarizeEvalGoldDataset = (dataset: EvalGoldDatasetV1): EvalGoldDatasetSummary => {
  const factsPerItem = dataset.items.map(({ labels }) => labels.facts.length);

  return Object.freeze({
    contentSha256: createHash("sha256").update(JSON.stringify(dataset)).digest("hex"),
    datasetId: dataset.datasetId,
    facts: Object.freeze({
      maximumPerItem: Math.max(...factsPerItem),
      minimumPerItem: Math.min(...factsPerItem),
      total: factsPerItem.reduce((total, count) => total + count, 0),
    }),
    items: dataset.items.length,
    relevance: Object.freeze({
      irrelevant: dataset.items.filter(({ labels }) => !labels.relevant).length,
      relevant: dataset.items.filter(({ labels }) => labels.relevant).length,
    }),
    schemaVersion: dataset.schemaVersion,
    splits: Object.freeze({
      calibration: dataset.items.filter(({ split }) => split === "CALIBRATION").length,
      holdout: dataset.items.filter(({ split }) => split === "HOLDOUT").length,
    }),
    verticals: Object.freeze({
      construction: dataset.items.filter(({ labels }) => labels.vertical === "CONSTRUCTION").length,
      horeca: dataset.items.filter(({ labels }) => labels.vertical === "HORECA").length,
    }),
  });
};
