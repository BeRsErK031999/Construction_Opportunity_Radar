import { loadAIConfig } from "@radar/config";
import { loadEvalGoldDataset, runAIBenchmark } from "@radar/evals";

import { parseAIBenchmarkCliOptions } from "./benchmark-ai-options.js";
import { createConfiguredAIProvider } from "./configured-ai-provider.js";

const defaultDatasetPath = new URL("../../../fixtures/evals/v1/dataset.json", import.meta.url);

const main = async (): Promise<void> => {
  const options = parseAIBenchmarkCliOptions(process.argv.slice(2));
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    AI_PROVIDER: options.provider,
    ...(options.provider === "ollama" && options.model !== null
      ? { OLLAMA_MODEL: options.model }
      : {}),
  };
  const config = loadAIConfig(environment);

  const dataset = await loadEvalGoldDataset(options.dataset ?? defaultDatasetPath);
  const configured = createConfiguredAIProvider(config, options.model ?? "fixture-analysis-v1");
  const report = await runAIBenchmark({
    dataset,
    promptVersion: options.promptVersion,
    provider: configured.provider,
    selectedSplit: options.selectedSplit,
    ...(configured.benchmarkExecutor === null ? {} : { executor: configured.benchmarkExecutor }),
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
