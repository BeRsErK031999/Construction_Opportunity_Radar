import {
  createNormalizationRejected,
  createRawItem,
  correlationId,
  normalizedItemId,
  rawItemId,
  sourceId,
  type NormalizationOutcome,
} from "@radar/core";
import { describe, expect, it } from "vitest";

import {
  executeNormalization,
  type NormalizationOutcomeRepository,
  type RawItemNormalizer,
} from "../src/index.js";

const rawItem = createRawItem({
  contentHash: "a".repeat(64),
  correlationId: correlationId("correlation-1"),
  externalId: "notice-1",
  id: rawItemId("raw-1"),
  originalUrl: "https://fixtures.radar.local/items/1",
  publishedAt: "2026-09-01T00:01:00Z",
  rawPayload: null,
  rawText: "Evidence",
  receivedAt: "2026-09-01T00:02:00Z",
  sourceId: sourceId("source-1"),
});

const rejectedOutcome = (
  overrides: {
    readonly rawItemId?: ReturnType<typeof rawItemId>;
    readonly version?: string;
  } = {},
): NormalizationOutcome =>
  createNormalizationRejected({
    correlationId: rawItem.correlationId,
    createdAt: "2026-09-01T00:03:00Z",
    detail: "No meaningful text remained",
    normalizerVersion: overrides.version ?? "normalizer-v1",
    rawItemId: overrides.rawItemId ?? rawItem.id,
    rejectionCode: "EMPTY_NORMALIZED_TEXT",
  });

class MemoryNormalizationOutcomeRepository implements NormalizationOutcomeRepository {
  readonly outcomes: NormalizationOutcome[] = [];

  count(): Promise<number> {
    return Promise.resolve(this.outcomes.length);
  }

  save(
    outcome: NormalizationOutcome,
  ): Promise<{ created: boolean; outcome: NormalizationOutcome }> {
    this.outcomes.push(outcome);
    return Promise.resolve({ created: true, outcome });
  }
}

const repository = (): MemoryNormalizationOutcomeRepository =>
  new MemoryNormalizationOutcomeRepository();

const execute = (
  normalizer: RawItemNormalizer,
  selectedRepository: NormalizationOutcomeRepository,
) =>
  executeNormalization({
    createdAt: "2026-09-01T00:03:00Z",
    id: normalizedItemId("normalized-1"),
    normalizer,
    rawItem,
    repository: selectedRepository,
  });

describe("executeNormalization", () => {
  it("persists an outcome only when its identity and declared version match", async () => {
    const selectedRepository = repository();
    const outcome = rejectedOutcome();

    await expect(
      execute({ normalize: () => outcome, version: "normalizer-v1" }, selectedRepository),
    ).resolves.toEqual({ created: true, outcome });
    expect(selectedRepository.outcomes).toEqual([outcome]);
  });

  it("rejects an outcome for another raw item before persistence", async () => {
    const selectedRepository = repository();

    await expect(
      execute(
        {
          normalize: () => rejectedOutcome({ rawItemId: rawItemId("raw-2") }),
          version: "normalizer-v1",
        },
        selectedRepository,
      ),
    ).rejects.toMatchObject({ code: "NORMALIZER_IDENTITY_MISMATCH" });
    expect(selectedRepository.outcomes).toEqual([]);
  });

  it("rejects an undeclared normalizer version before persistence", async () => {
    const selectedRepository = repository();

    await expect(
      execute(
        {
          normalize: () => rejectedOutcome({ version: "normalizer-v2" }),
          version: "normalizer-v1",
        },
        selectedRepository,
      ),
    ).rejects.toMatchObject({ code: "NORMALIZER_VERSION_MISMATCH" });
    expect(selectedRepository.outcomes).toEqual([]);
  });
});
