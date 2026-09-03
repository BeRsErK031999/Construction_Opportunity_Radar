import { FakeAIProvider, OllamaAIProvider } from "@radar/ai-adapters";
import { type AIProvider } from "@radar/application";
import { type AIConfig } from "@radar/config";
import { type AIBenchmarkExecutor } from "@radar/evals";

export interface ConfiguredAIProvider {
  readonly benchmarkExecutor: AIBenchmarkExecutor | null;
  readonly provider: AIProvider;
}

export const createConfiguredAIProvider = (
  config: AIConfig,
  fakeModel = "fixture-analysis-v1",
): ConfiguredAIProvider => {
  if (config.provider === "fake") {
    return Object.freeze({
      benchmarkExecutor: null,
      provider: new FakeAIProvider({ model: fakeModel }),
    });
  }

  const provider = new OllamaAIProvider({
    allowRemotePrivateHost: config.allowRemotePrivateHost,
    baseUrl: config.baseUrl,
    contextTokens: config.contextTokens,
    healthTimeoutMs: config.healthTimeoutMs,
    keepAlive: config.keepAlive,
    maxConcurrentRequests: config.maxConcurrentRequests,
    maxInputCharacters: config.maxInputCharacters,
    model: config.model,
    requestTimeoutMs: config.requestTimeoutMs,
    seed: config.seed,
  });
  const benchmarkExecutor: AIBenchmarkExecutor = async (_selectedProvider, request) => {
    const result = await provider.analyzeSignalWithMetrics(request);
    return {
      analysis: result.analysis,
      tokenUsage: result.tokenUsage,
    };
  };
  return Object.freeze({ benchmarkExecutor, provider });
};
