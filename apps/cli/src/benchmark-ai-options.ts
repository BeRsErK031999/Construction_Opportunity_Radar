import { AI_BENCHMARK_PROMPT_VERSION_V1, type AIBenchmarkSplit } from "@radar/evals";

export interface AIBenchmarkCliOptions {
  readonly dataset: string | null;
  readonly model: string;
  readonly promptVersion: string;
  readonly provider: string;
  readonly selectedSplit: AIBenchmarkSplit;
  readonly vramPeakMiB: number | null;
}

const optionValue = (
  argument: string,
  argumentsList: readonly string[],
  index: number,
): { readonly consumed: number; readonly name: string; readonly value: string } => {
  const separatorIndex = argument.indexOf("=");
  if (separatorIndex > 2) {
    return {
      consumed: 1,
      name: argument.slice(2, separatorIndex),
      value: argument.slice(separatorIndex + 1),
    };
  }
  const value = argumentsList[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`Missing value for ${argument}`);
  }
  return { consumed: 2, name: argument.slice(2), value };
};

const nonBlank = (value: string, name: string, maximum: number): string => {
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > maximum) {
    throw new Error(`Invalid value for --${name}`);
  }
  return normalized;
};

const splitFrom = (value: string): AIBenchmarkSplit => {
  const normalized = value.trim().toUpperCase();
  if (normalized !== "ALL" && normalized !== "CALIBRATION" && normalized !== "HOLDOUT") {
    throw new Error("--split must be all, calibration, or holdout");
  }
  return normalized;
};

const positiveNumber = (value: string, name: string): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`--${name} must be a positive number`);
  }
  return parsed;
};

export const parseAIBenchmarkCliOptions = (
  argumentsList: readonly string[],
): AIBenchmarkCliOptions => {
  let dataset: string | null = null;
  let model = "fixture-analysis-v1";
  let promptVersion: string = AI_BENCHMARK_PROMPT_VERSION_V1;
  let provider = "fake";
  let selectedSplit: AIBenchmarkSplit = "ALL";
  let vramPeakMiB: number | null = null;
  const seen = new Set<string>();

  for (let index = 0; index < argumentsList.length;) {
    const argument = argumentsList[index];
    if (argument?.startsWith("--") !== true) {
      throw new Error(`Unexpected argument: ${argument ?? ""}`);
    }
    const option = optionValue(argument, argumentsList, index);
    if (seen.has(option.name)) {
      throw new Error(`Duplicate option: --${option.name}`);
    }
    seen.add(option.name);

    switch (option.name) {
      case "dataset":
        dataset = nonBlank(option.value, option.name, 1_000);
        break;
      case "model":
        model = nonBlank(option.value, option.name, 200);
        break;
      case "prompt-version":
        promptVersion = nonBlank(option.value, option.name, 100);
        break;
      case "provider":
        provider = nonBlank(option.value, option.name, 100);
        break;
      case "split":
        selectedSplit = splitFrom(option.value);
        break;
      case "vram-peak-mib":
        vramPeakMiB = positiveNumber(option.value, option.name);
        break;
      default:
        throw new Error(`Unknown option: --${option.name}`);
    }
    index += option.consumed;
  }

  return Object.freeze({
    dataset,
    model,
    promptVersion,
    provider,
    selectedSplit,
    vramPeakMiB,
  });
};
