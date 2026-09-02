import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  CLASSIFIER_VERSION_V1,
  classificationSignalIdV1,
  classifyCandidateV1,
  correlationId,
  createNormalizedItem,
  createSource,
  normalizedItemId,
  rawItemId,
  SIGNAL_TAXONOMY_VERSION_V1,
  sourceId,
  type ClassificationCandidate,
  type RightsStatus,
  type Vertical,
} from "../src/index.js";

interface EvidenceOptions {
  readonly aiProcessingAllowed?: boolean;
  readonly id: string;
  readonly publishedAt?: string;
  readonly rightsStatus?: RightsStatus;
  readonly source?: string;
  readonly text: string;
  readonly verticals?: readonly Vertical[];
}

const evidence = (options: EvidenceOptions) => {
  const source = options.source ?? `source-${options.id}`;
  const rightsStatus = options.rightsStatus ?? "CONSENT";
  const aiProcessingAllowed = options.aiProcessingAllowed ?? true;
  return Object.freeze({
    normalizedItem: createNormalizedItem({
      canonicalUrl: `https://fixtures.radar.local/items/${options.id}`,
      correlationId: correlationId("81000000-0000-4000-8000-000000000001"),
      createdAt: options.publishedAt ?? "2026-09-01T00:00:00Z",
      id: normalizedItemId(options.id),
      language: "ru",
      normalizedHash: createHash("sha256").update(options.text).digest("hex"),
      normalizerVersion: "normalizer-v1",
      publishedAt: options.publishedAt ?? "2026-09-01T00:00:00Z",
      rawItemId: rawItemId(`raw-${options.id}`),
      text: options.text,
    }),
    source: createSource({
      aiProcessingAllowed,
      collectionPolicy: { parserKind: "FIXTURE_JSON" },
      country: "RU",
      createdAt: "2026-09-01T00:00:00Z",
      enabled: true,
      id: sourceId(source),
      name: source,
      regions: ["Алтайский край"],
      reliabilityScore: 80,
      rightsBasis: aiProcessingAllowed ? "Синтетический тестовый материал" : null,
      rightsStatus,
      type: "FIXTURE",
      updatedAt: "2026-09-01T00:00:00Z",
      url: `https://fixtures.radar.local/sources/${source}`,
      verticals: options.verticals ?? ["CONSTRUCTION"],
    }),
  });
};

const candidate = (
  items: readonly ReturnType<typeof evidence>[],
  representative = items[0]?.normalizedItem.id,
): ClassificationCandidate => {
  if (representative === undefined) {
    throw new Error("Test candidate requires evidence");
  }
  return Object.freeze({
    deduplicatorVersion: "deduplicator-v1",
    evidence: Object.freeze([...items]),
    representativeNormalizedItemId: representative,
  });
};

describe("classifier-v1", () => {
  it("classifies a construction tender with versioned explainable evidence", () => {
    const decision = classifyCandidateV1(
      candidate([
        evidence({
          id: "construction",
          text: "Запланированы строительно-монтажные работы. Бюджет 50 млн, приём заявок до 10 октября.",
        }),
      ]),
    );

    expect(decision).toMatchObject({
      category: "CONSTRUCTION_TENDER",
      classifierVersion: CLASSIFIER_VERSION_V1,
      outcome: "AI_ELIGIBLE",
      reasonCode: "RELEVANT_OPPORTUNITY",
      taxonomyVersion: SIGNAL_TAXONOMY_VERSION_V1,
      vertical: "CONSTRUCTION",
    });
    expect(decision.relevanceScore).toBeGreaterThanOrEqual(80);
    expect(decision.matchedRuleIds).toContain("opportunity.applications");
    expect(decision.aiInputEvidence).toEqual([
      { normalizedItemId: "construction", sourceId: "source-construction" },
    ]);
    if (decision.outcome !== "AI_ELIGIBLE") {
      throw new Error("Expected an AI-eligible decision");
    }
    expect(classificationSignalIdV1(decision)).toMatch(
      /^[a-f0-9]{8}-[a-f0-9]{4}-8[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u,
    );
    expect(classificationSignalIdV1(decision)).toBe(classificationSignalIdV1(decision));
  });

  it("classifies a HoReCa opening and supplier selection", () => {
    const decision = classifyCandidateV1(
      candidate([
        evidence({
          id: "horeca",
          text: "Готовится открытие объекта HoReCa на 80 посадочных мест. Идёт отбор поставщиков оборудования.",
          verticals: ["HORECA"],
        }),
      ]),
    );

    expect(decision).toMatchObject({
      category: "HORECA_PROCUREMENT",
      outcome: "AI_ELIGIBLE",
      vertical: "HORECA",
    });
    expect(decision.matchedRuleIds).toContain("opportunity.supplier-selection");
  });

  it("rejects advertisements before opportunity eligibility", () => {
    const decision = classifyCandidateV1(
      candidate([
        evidence({
          id: "advertisement",
          text: "Реклама: скидка на строительные смеси. Оставьте заявку на коммерческое предложение.",
        }),
      ]),
    );

    expect(decision).toMatchObject({
      aiInputEvidence: [],
      outcome: "IRRELEVANT",
      reasonCode: "ADVERTISEMENT",
      relevanceScore: 0,
      vertical: "CONSTRUCTION",
    });
  });

  it("keeps generic, negated and ambiguous notices outside the MVP verticals", () => {
    const generic = classifyCandidateV1(
      candidate([
        evidence({
          id: "generic",
          text: "Опубликована информация общего назначения. Закупок для Construction или HoReCa не заявлено.",
          verticals: ["OTHER"],
        }),
      ]),
    );
    const ambiguous = classifyCandidateV1(
      candidate([
        evidence({
          id: "ambiguous",
          text: "Строительство гостиницы включено в проект, приём заявок открыт.",
          verticals: ["OTHER"],
        }),
      ]),
    );

    expect(generic).toMatchObject({
      outcome: "IRRELEVANT",
      reasonCode: "EXPLICITLY_IRRELEVANT",
      vertical: "OTHER",
    });
    expect(ambiguous).toMatchObject({
      outcome: "IRRELEVANT",
      reasonCode: "UNSUPPORTED_OR_AMBIGUOUS_VERTICAL",
      vertical: "OTHER",
    });
  });

  it("requires an opportunity cue even when source metadata identifies the vertical", () => {
    const decision = classifyCandidateV1(
      candidate([
        evidence({
          id: "construction-background",
          text: "Обзор рынка строительных материалов за прошедший квартал.",
        }),
      ]),
    );

    expect(decision).toMatchObject({
      outcome: "IRRELEVANT",
      reasonCode: "NO_OPPORTUNITY_CUE",
      vertical: "CONSTRUCTION",
    });
  });

  it("denies a cluster without permitted evidence without inspecting it for AI eligibility", () => {
    const decision = classifyCandidateV1(
      candidate([
        evidence({
          aiProcessingAllowed: false,
          id: "review-required",
          rightsStatus: "REVIEW_REQUIRED",
          text: "Крупный строительный тендер, приём заявок открыт.",
        }),
      ]),
    );

    expect(decision).toEqual(
      expect.objectContaining({
        aiInputEvidence: [],
        category: null,
        correlationId: null,
        matchedRuleIds: ["permission.no-ai-permitted-evidence"],
        outcome: "PERMISSION_DENIED",
        reasonCode: "NO_AI_PERMITTED_EVIDENCE",
        selectedNormalizedItemId: null,
        vertical: null,
      }),
    );
  });

  it("uses a permitted duplicate when the deduplication representative is not AI-permitted", () => {
    const blockedRepresentative = evidence({
      aiProcessingAllowed: false,
      id: "representative",
      publishedAt: "2026-09-01T00:00:00Z",
      rightsStatus: "REVIEW_REQUIRED",
      text: "Закрытый для AI текст",
    });
    const permittedDuplicate = evidence({
      id: "permitted-copy",
      publishedAt: "2026-09-01T01:00:00Z",
      source: "permitted-source",
      text: "Запланировано строительство склада, подрядчиков приглашают подать заявки.",
    });

    const decision = classifyCandidateV1(candidate([blockedRepresentative, permittedDuplicate]));

    expect(decision).toMatchObject({
      aiInputEvidence: [{ normalizedItemId: "permitted-copy", sourceId: "permitted-source" }],
      outcome: "AI_ELIGIBLE",
      selectedNormalizedItemId: "permitted-copy",
      vertical: "CONSTRUCTION",
    });
  });

  it("rejects malformed cluster evidence", () => {
    const item = evidence({ id: "member", text: "Строительный тендер" });

    expect(() => classifyCandidateV1(candidate([item, item]))).toThrow(
      expect.objectContaining({ code: "DUPLICATE_CLASSIFICATION_EVIDENCE" }),
    );
    expect(() =>
      classifyCandidateV1(candidate([item], normalizedItemId("missing-representative"))),
    ).toThrow(expect.objectContaining({ code: "MISSING_CLASSIFICATION_REPRESENTATIVE" }));
  });
});
