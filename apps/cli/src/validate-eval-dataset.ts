import { loadEvalGoldDataset, summarizeEvalGoldDataset } from "@radar/evals";

const defaultDatasetPath = new URL("../../../fixtures/evals/v1/dataset.json", import.meta.url);

const dataset = await loadEvalGoldDataset(process.argv[2] ?? defaultDatasetPath);
process.stdout.write(`${JSON.stringify(summarizeEvalGoldDataset(dataset), null, 2)}\n`);
