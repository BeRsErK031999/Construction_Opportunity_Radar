import { createHash } from "node:crypto";

import {
  CLASSIFIER_VERSION_V1,
  classifyCandidateV1,
  correlationId,
  createNormalizedItem,
  createSource,
  normalizedItemId,
  rawItemId,
  SIGNAL_TAXONOMY_VERSION_V1,
  sourceId,
  type ClassificationCandidate,
  type ClassificationDecision,
} from "@radar/core";
import { describe, expect, it } from "vitest";

import {
  executeClassification,
  type ClassificationSaveResult,
  type ClassificationSignalRepository,
  type Classifier,
  type PersistableClassifiedSignal,
} from "../src/index.js";

interface CandidateOptions {
  readonly allowed?: boolean;
  readonly id: string;
  readonly text: string;
}

const candidate = (options: CandidateOptions): ClassificationCandidate => {
  const allowed = options.allowed ?? true;
  const textHash = createHash("sha256").update(options.text).digest("hex");
  const itemId = normalizedItemId(options.id);
  return Object.freeze({
    deduplicatorVersion: "deduplicator-v1",
    evidence: Object.freeze([
      Object.freeze({
        normalizedItem: createNormalizedItem({
          canonicalUrl: `https://fixtures.radar.local/items/${options.id}`,
          correlationId: correlationId("82000000-0000-4000-8000-000000000001"),
          createdAt: "2026-09-01T00:00:00Z",
          id: itemId,
          language: "ru",
          normalizedHash: textHash,
          normalizerVersion: "normalizer-v1",
          rawItemId: rawItemId(`raw-${options.id}`),
          text: options.text,
        }),
        source: createSource({
          aiProcessingAllowed: allowed,
          collectionPolicy: { parserKind: "FIXTURE_JSON" },
          country: "RU",
          createdAt: "2026-09-01T00:00:00Z",
          enabled: true,
          id: sourceId(`source-${options.id}`),
          name: `Source ${options.id}`,
          regions: ["Алтайский край"],
          reliabilityScore: 80,
          rightsBasis: allowed ? "Синтетический тестовый материал" : null,
          rightsStatus: allowed ? "CONSENT" : "REVIEW_REQUIRED",
          type: "FIXTURE",
          updatedAt: "2026-09-01T00:00:00Z",
          url: `https://fixtures.radar.local/sources/${options.id}`,
          verticals: ["CONSTRUCTION"],
        }),
      }),
    ]),
    representativeNormalizedItemId: itemId,
  });
};

class MemoryClassificationRepository implements ClassificationSignalRepository {
  readonly saved: PersistableClassifiedSignal[] = [];

  countSignals(): Promise<number> {
    return Promise.resolve(this.saved.length);
  }

  save(signals: readonly PersistableClassifiedSignal[]): Promise<ClassificationSaveResult> {
    this.saved.push(...signals);
    return Promise.resolve({ created: signals.length, existing: 0, signals: signals.length });
  }
}

const classifier: Classifier = Object.freeze({
  classify: classifyCandidateV1,
  taxonomyVersion: SIGNAL_TAXONOMY_VERSION_V1,
  version: CLASSIFIER_VERSION_V1,
});

describe("executeClassification", () => {
  it("persists only unique, relevant, permitted signals and reports every decision", async () => {
    const repository = new MemoryClassificationRepository();
    const relevant = candidate({
      id: "relevant",
      text: "Запланированы строительно-монтажные работы, приём заявок открыт.",
    });
    const advertisement = candidate({
      id: "advertisement",
      text: "Реклама: скидка на строительные смеси. Оставьте заявку.",
    });
    const denied = candidate({
      allowed: false,
      id: "denied",
      text: "Строительный тендер, приём заявок открыт.",
    });

    const result = await executeClassification({
      candidates: [relevant, advertisement, denied],
      classifier,
      createdAt: "2026-09-02T00:00:00Z",
      repository,
    });

    expect(result.metrics).toEqual({
      aiEligible: 1,
      construction: 2,
      horeca: 0,
      inputClusters: 3,
      irrelevant: 1,
      other: 0,
      permissionDenied: 1,
    });
    expect(result.persistence).toEqual({ created: 1, existing: 0, signals: 1 });
    expect(repository.saved).toHaveLength(1);
    expect(repository.saved[0]?.signal).toMatchObject({
      classifierVersion: CLASSIFIER_VERSION_V1,
      normalizedItemIds: ["relevant"],
      sourceIds: ["source-relevant"],
      status: "CANDIDATE",
      vertical: "CONSTRUCTION",
    });
  });

  it("rejects duplicate cluster coverage and classifier version drift before persistence", async () => {
    const item = candidate({
      id: "duplicate",
      text: "Запланировано строительство, приём заявок открыт.",
    });
    const repository = new MemoryClassificationRepository();

    await expect(
      executeClassification({
        candidates: [item, item],
        classifier,
        createdAt: "2026-09-02T00:00:00Z",
        repository,
      }),
    ).rejects.toMatchObject({ code: "DUPLICATE_CLASSIFICATION_CLUSTER" });

    await expect(
      executeClassification({
        candidates: [item],
        classifier: { ...classifier, version: "classifier-v2" },
        createdAt: "2026-09-02T00:00:00Z",
        repository,
      }),
    ).rejects.toMatchObject({ code: "CLASSIFIER_VERSION_MISMATCH" });
    expect(repository.saved).toEqual([]);
  });

  it("defensively rejects AI evidence that is outside the permitted cluster", async () => {
    const item = candidate({
      id: "leak-test",
      text: "Запланировано строительство, приём заявок открыт.",
    });
    const unsafeClassifier: Classifier = {
      ...classifier,
      classify(input): ClassificationDecision {
        const decision = classifyCandidateV1(input);
        if (decision.outcome !== "AI_ELIGIBLE") {
          return decision;
        }
        return {
          ...decision,
          aiInputEvidence: [
            { normalizedItemId: decision.selectedNormalizedItemId, sourceId: sourceId("outside") },
          ],
        };
      },
    };
    const repository = new MemoryClassificationRepository();

    await expect(
      executeClassification({
        candidates: [item],
        classifier: unsafeClassifier,
        createdAt: "2026-09-02T00:00:00Z",
        repository,
      }),
    ).rejects.toMatchObject({ code: "INVALID_AI_INPUT_EVIDENCE" });
    expect(repository.saved).toEqual([]);
  });
});
