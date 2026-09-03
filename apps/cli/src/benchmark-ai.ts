import { FakeAIProvider } from "@radar/ai-adapters";
import { loadEvalGoldDataset, runAIBenchmark } from "@radar/evals";

import { parseAIBenchmarkCliOptions } from "./benchmark-ai-options.js";

const defaultDatasetPath = new URL("../../../fixtures/evals/v1/dataset.json", import.meta.url);

const main = async (): Promise<void> => {
  const options = parseAIBenchmarkCliOptions(process.argv.slice(2));
  if (options.provider !== "fake") {
    throw new Error(`Unsupported AI benchmark provider: ${options.provider}`);
  }

  const dataset = await loadEvalGoldDataset(options.dataset ?? defaultDatasetPath);
  const provider = new FakeAIProvider({ model: options.model, provider: options.provider });
  const report = await runAIBenchmark({
    dataset,
    promptVersion: options.promptVersion,
    provider,
    selectedSplit: options.selectedSplit,
    ...(options.vramPeakMiB === null ? {} : { vramPeakMiB: options.vramPeakMiB }),
  });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
};

try {
  await main();
} catch (error: unknown) {
  const message = error instanceof Error ? error.message : "AI benchmark failed";
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}
