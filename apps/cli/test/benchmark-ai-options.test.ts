import { describe, expect, it } from "vitest";

import { parseAIBenchmarkCliOptions } from "../src/benchmark-ai-options.js";

describe("benchmark:ai CLI options", () => {
  it("uses the deterministic fake benchmark defaults", () => {
    expect(parseAIBenchmarkCliOptions([])).toEqual({
      dataset: null,
      model: "fixture-analysis-v1",
      promptVersion: "benchmark-prompt/v1",
      provider: "fake",
      selectedSplit: "ALL",
      vramPeakMiB: null,
    });
  });

  it("accepts provider, model, dataset, prompt, and split in both flag forms", () => {
    expect(
      parseAIBenchmarkCliOptions([
        "--provider=fake",
        "--model",
        "fake-custom-v2",
        "--dataset=fixtures/evals/v1/dataset.json",
        "--prompt-version",
        "benchmark-prompt/v2",
        "--split=holdout",
        "--vram-peak-mib=8192.5",
      ]),
    ).toEqual({
      dataset: "fixtures/evals/v1/dataset.json",
      model: "fake-custom-v2",
      promptVersion: "benchmark-prompt/v2",
      provider: "fake",
      selectedSplit: "HOLDOUT",
      vramPeakMiB: 8192.5,
    });
  });

  it("rejects unknown, duplicate, and incomplete options", () => {
    expect(() => parseAIBenchmarkCliOptions(["--unknown", "value"])).toThrow("Unknown option");
    expect(() => parseAIBenchmarkCliOptions(["--provider", "fake", "--provider", "fake"])).toThrow(
      "Duplicate option",
    );
    expect(() => parseAIBenchmarkCliOptions(["--model"])).toThrow("Missing value");
    expect(() => parseAIBenchmarkCliOptions(["--split", "train"])).toThrow(
      "--split must be all, calibration, or holdout",
    );
    expect(() => parseAIBenchmarkCliOptions(["--vram-peak-mib", "0"])).toThrow(
      "must be a positive number",
    );
  });
});
