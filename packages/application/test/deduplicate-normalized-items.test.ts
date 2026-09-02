import {
  correlationId,
  createNormalizedItem,
  deduplicateCandidatesV1,
  normalizedItemId,
  rawItemId,
  sourceId,
  version,
  type DeduplicationCandidate,
  type DeduplicationResult,
} from "@radar/core";
import { describe, expect, it } from "vitest";

import {
  executeDeduplication,
  type DeduplicationRepository,
  type Deduplicator,
} from "../src/index.js";

const candidate: DeduplicationCandidate = Object.freeze({
  normalizedItem: createNormalizedItem({
    canonicalUrl: "https://fixtures.radar.local/items/1",
    correlationId: correlationId("correlation-1"),
    createdAt: "2026-09-01T00:00:00Z",
    id: normalizedItemId("normalized-1"),
    language: "ru",
    normalizedHash: "a".repeat(64),
    normalizerVersion: "normalizer-v1",
    publishedAt: "2026-09-01T00:00:00Z",
    rawItemId: rawItemId("raw-1"),
    text: "Проверяемый материал",
  }),
  sourceExternalId: "notice-1",
  sourceId: sourceId("source-1"),
  verticals: Object.freeze(["CONSTRUCTION"] as const),
});

class MemoryDeduplicationRepository implements DeduplicationRepository {
  readonly saved: DeduplicationResult[] = [];

  countAssignments(): Promise<number> {
    return Promise.resolve(0);
  }

  countClusters(): Promise<number> {
    return Promise.resolve(0);
  }

  listCandidates(): Promise<readonly DeduplicationCandidate[]> {
    return Promise.resolve([candidate]);
  }

  save(result: DeduplicationResult) {
    this.saved.push(result);
    return Promise.resolve({
      assignments: result.assignments.length,
      clusters: result.metrics.clusters,
      created: result.assignments.length,
      existing: 0,
      version: result.version,
    });
  }
}

const execute = (
  deduplicate: Deduplicator["deduplicate"],
  selectedRepository: MemoryDeduplicationRepository,
) =>
  executeDeduplication({
    candidates: [candidate],
    createdAt: "2026-09-01T01:00:00Z",
    deduplicator: { deduplicate, version: "deduplicator-v1" },
    repository: selectedRepository,
  });

describe("executeDeduplication", () => {
  it("persists a complete result with the declared version", async () => {
    const repository = new MemoryDeduplicationRepository();

    const result = await execute(deduplicateCandidatesV1, repository);

    expect(result.persistence).toMatchObject({ assignments: 1, clusters: 1, created: 1 });
    expect(repository.saved).toHaveLength(1);
  });

  it("rejects version mismatch before persistence", async () => {
    const repository = new MemoryDeduplicationRepository();

    await expect(
      execute(
        (candidates) => ({
          ...deduplicateCandidatesV1(candidates),
          version: version("deduplicator-v2", "deduplicatorVersion"),
        }),
        repository,
      ),
    ).rejects.toMatchObject({ code: "DEDUPLICATOR_VERSION_MISMATCH" });
    expect(repository.saved).toEqual([]);
  });

  it("rejects incomplete assignment coverage before persistence", async () => {
    const repository = new MemoryDeduplicationRepository();

    await expect(
      execute(
        (candidates) => ({
          ...deduplicateCandidatesV1(candidates),
          assignments: [],
        }),
        repository,
      ),
    ).rejects.toMatchObject({ code: "DEDUPLICATOR_COVERAGE_MISMATCH" });
    expect(repository.saved).toEqual([]);
  });

  it("rejects assignment evidence with another version or an out-of-batch reference", async () => {
    const versionRepository = new MemoryDeduplicationRepository();
    await expect(
      execute((candidates) => {
        const result = deduplicateCandidatesV1(candidates);
        return {
          ...result,
          assignments: result.assignments.map((assignment) => ({
            ...assignment,
            deduplicatorVersion: version("deduplicator-v2", "deduplicatorVersion"),
          })),
        };
      }, versionRepository),
    ).rejects.toMatchObject({ code: "DEDUPLICATOR_VERSION_MISMATCH" });
    expect(versionRepository.saved).toEqual([]);

    const referenceRepository = new MemoryDeduplicationRepository();
    await expect(
      execute((candidates) => {
        const result = deduplicateCandidatesV1(candidates);
        return {
          ...result,
          assignments: result.assignments.map((assignment) => ({
            ...assignment,
            matchedToNormalizedItemId: normalizedItemId("outside-batch"),
          })),
        };
      }, referenceRepository),
    ).rejects.toMatchObject({ code: "DEDUPLICATOR_COVERAGE_MISMATCH" });
    expect(referenceRepository.saved).toEqual([]);
  });
});
