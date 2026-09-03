import { createHash } from "node:crypto";

import { createAIAnalysisRequest } from "@radar/application";
import { AI_ANALYSIS_SCHEMA_VERSION_V1 } from "@radar/contracts";
import {
  analysisId,
  correlationId,
  createNormalizedItem,
  createSignal,
  createSource,
  normalizedItemId,
  rawItemId,
  signalId,
  sourceId,
} from "@radar/core";
import { describe, expect, it, vi } from "vitest";

import { OllamaAIProvider, type OllamaFetch } from "../src/index.js";

const timestamp = "2026-09-03T08:00:00Z";

const request = () => {
  const text = "Опубликован тендер на строительство гостиницы в Барнауле.";
  const item = createNormalizedItem({
    canonicalUrl: "https://fixtures.radar.local/items/hotel-tender",
    correlationId: correlationId("correlation-ollama-provider"),
    createdAt: timestamp,
    entities: [{ kind: "region", value: "Барнаул" }],
    id: normalizedItemId("normalized-ollama-hotel-tender"),
    language: "ru",
    normalizedHash: createHash("sha256").update(text).digest("hex"),
    normalizerVersion: "normalizer-v1",
    publishedAt: timestamp,
    rawItemId: rawItemId("raw-ollama-hotel-tender"),
    text,
    title: "Тендер на строительство гостиницы",
  });
  const source = createSource({
    aiProcessingAllowed: true,
    collectionPolicy: { parserKind: "FIXTURE_JSON" },
    country: "RU",
    createdAt: timestamp,
    enabled: true,
    id: sourceId("source-ollama-hotel-tender"),
    name: "Fixture Hotel Tender",
    regions: ["Алтайский край"],
    reliabilityScore: 90,
    rightsBasis: "Синтетический тестовый материал",
    rightsStatus: "CONSENT",
    type: "FIXTURE",
    updatedAt: timestamp,
    url: "https://fixtures.radar.local/sources/hotel-tender",
    verticals: ["CONSTRUCTION"],
  });
  const signal = createSignal({
    category: "TENDER",
    classificationConfidence: 90,
    classificationRuleIds: ["construction.tender"],
    classifierVersion: "classifier-v1",
    correlationId: correlationId("correlation-ollama-provider"),
    createdAt: timestamp,
    deduplicationRepresentativeNormalizedItemId: item.id,
    deduplicatorVersion: "deduplicator-v1",
    id: signalId("signal-ollama-hotel-tender"),
    normalizedItemIds: [item.id],
    relevanceScore: 80,
    sourceIds: [source.id],
    status: "CANDIDATE",
    taxonomyVersion: "signal-taxonomy-v1",
    updatedAt: timestamp,
    vertical: "CONSTRUCTION",
  });
  return createAIAnalysisRequest({
    analysisId: analysisId("analysis-ollama-hotel-tender"),
    analysisVersion: "analysis-v1",
    createdAt: timestamp,
    evidence: [{ normalizedItem: item, source }],
    promptVersion: "ollama-prompt/v1",
    schemaVersion: AI_ANALYSIS_SCHEMA_VERSION_V1,
    signal,
  });
};

const validAnalysisResponse = (analysisRequest: ReturnType<typeof request>) => {
  const evidence = analysisRequest.evidence[0];
  if (evidence === undefined) {
    throw new Error("Test request requires evidence");
  }
  return {
    actionability: 75,
    analysisId: analysisRequest.analysisId,
    analysisVersion: analysisRequest.analysisVersion,
    businessImpact: 85,
    candidateActions: [
      {
        kind: "VERIFY",
        priority: 1,
        rationale: "Проверить исходную публикацию и условия тендера.",
        title: "Проверить тендер",
      },
      {
        kind: "PREPARE_OFFER",
        priority: 2,
        rationale: "Оценить соответствие проекта возможностям компании.",
        title: "Подготовить предложение",
      },
    ],
    confidence: 0.9,
    correlationId: analysisRequest.signal.correlationId,
    createdAt: analysisRequest.createdAt,
    deadline: null,
    entities: ["Барнаул"],
    eventType: "TENDER",
    facts: [
      {
        id: "fact-hotel-tender",
        sourceIds: [evidence.sourceId],
        statement: "Опубликован тендер на строительство гостиницы в Барнауле.",
      },
    ],
    headline: "Тендер на строительство гостиницы",
    inferences: [
      {
        basisFactIds: ["fact-hotel-tender"],
        id: "inference-hotel-tender",
        statement: "Проект может быть релевантен строительным подрядчикам региона.",
      },
    ],
    model: "deepseek-r1:8b",
    promptVersion: analysisRequest.promptVersion,
    provider: "ollama",
    risks: ["Условия участия требуют проверки."],
    schemaVersion: analysisRequest.schemaVersion,
    signalId: analysisRequest.signal.id,
    sourceIds: [evidence.sourceId],
    status: "SUCCEEDED",
    summary: "В Барнауле опубликован строительный тендер на объект гостиничного назначения.",
    urgency: 70,
    whyImportant: "Тендер может создать проверяемую возможность для профильной компании.",
  };
};

const chatResponse = (analysisRequest: ReturnType<typeof request>): Response =>
  Response.json({
    done: true,
    eval_count: 120,
    eval_duration: 2_500_000_000,
    message: {
      content: JSON.stringify(validAnalysisResponse(analysisRequest)),
      role: "assistant",
    },
    model: "deepseek-r1:8b",
    prompt_eval_count: 240,
  });

const providerOptions = (fetchImplementation: OllamaFetch) => ({
  baseUrl: "http://127.0.0.1:11434",
  contextTokens: 8_192,
  fetch: fetchImplementation,
  healthTimeoutMs: 1_000,
  keepAlive: "5m",
  maxConcurrentRequests: 1,
  maxInputCharacters: 24_000,
  model: "deepseek-r1:8b",
  requestTimeoutMs: 1_000,
  seed: 42,
});

describe("OllamaAIProvider", () => {
  it("uses non-streaming structured chat and maps validated analysis plus usage", async () => {
    const analysisRequest = request();
    const fetchMock = vi.fn<OllamaFetch>(() => Promise.resolve(chatResponse(analysisRequest)));
    const provider = new OllamaAIProvider(providerOptions(fetchMock));

    const result = await provider.analyzeSignalWithMetrics(analysisRequest);

    expect(result.analysis).toMatchObject({
      model: "deepseek-r1:8b",
      provider: "ollama",
      signalId: analysisRequest.signal.id,
      status: "SUCCEEDED",
    });
    expect(result.tokenUsage).toEqual({
      generationDurationMs: 2_500,
      inputTokens: 240,
      outputTokens: 120,
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("http://127.0.0.1:11434/api/chat");
    expect(init?.redirect).toBe("error");
    if (typeof init?.body !== "string") {
      throw new Error("Expected serialized Ollama request body");
    }
    const body = JSON.parse(init.body) as Record<string, unknown>;
    expect(body).toMatchObject({
      keep_alive: "5m",
      model: "deepseek-r1:8b",
      options: { num_ctx: 8_192, seed: 42, temperature: 0 },
      stream: false,
      think: false,
    });
    expect(body.format).toMatchObject({ additionalProperties: false, type: "object" });
    expect(JSON.stringify(body.messages)).not.toContain("Синтетический тестовый материал");
  });

  it("turns malformed model content into a safe failed Analysis", async () => {
    const fetchMock = vi.fn<OllamaFetch>(() =>
      Promise.resolve(
        Response.json({
          done: true,
          message: { content: "not-json", role: "assistant" },
          model: "deepseek-r1:8b",
        }),
      ),
    );
    const provider = new OllamaAIProvider(providerOptions(fetchMock));

    await expect(provider.analyzeSignal(request())).resolves.toMatchObject({
      failureCode: "AI_INVALID_RESPONSE",
      failureReason: "AI response failed ai-analysis/v1 schema validation",
      retryable: false,
      status: "FAILED",
    });
  });

  it("maps HTTP status and timeout failures to the stable provider taxonomy", async () => {
    const limited = new OllamaAIProvider(
      providerOptions(
        vi.fn<OllamaFetch>(() => Promise.resolve(new Response(null, { status: 429 }))),
      ),
    );
    await expect(limited.analyzeSignal(request())).rejects.toMatchObject({
      code: "AI_RATE_LIMITED",
      retryable: true,
    });

    const timeoutFetch = vi.fn<OllamaFetch>(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(new Error("aborted")), {
            once: true,
          });
        }),
    );
    const timedOut = new OllamaAIProvider({
      ...providerOptions(timeoutFetch),
      requestTimeoutMs: 5,
    });
    await expect(timedOut.analyzeSignal(request())).rejects.toMatchObject({
      code: "AI_TIMEOUT",
      message: "AI provider request timed out",
      retryable: true,
    });
  });

  it("checks both endpoint availability and exact local model presence", async () => {
    const healthyFetch = vi.fn<OllamaFetch>(() =>
      Promise.resolve(
        Response.json({ models: [{ model: "deepseek-r1:8b", name: "deepseek-r1:8b" }] }),
      ),
    );
    const provider = new OllamaAIProvider(providerOptions(healthyFetch));
    await expect(provider.healthCheck()).resolves.toEqual({
      failureCode: null,
      model: "deepseek-r1:8b",
      provider: "ollama",
      retryable: false,
      status: "HEALTHY",
    });
    expect(healthyFetch).toHaveBeenCalledWith(
      "http://127.0.0.1:11434/api/tags",
      expect.objectContaining({ method: "GET" }),
    );

    const missingModel = new OllamaAIProvider(
      providerOptions(
        vi.fn<OllamaFetch>(() =>
          Promise.resolve(Response.json({ models: [{ name: "other:latest" }] })),
        ),
      ),
    );
    await expect(missingModel.healthCheck()).resolves.toMatchObject({
      failureCode: "AI_UNAVAILABLE",
      retryable: false,
      status: "UNHEALTHY",
    });
  });

  it("rejects oversized input before transport", async () => {
    const fetchMock = vi.fn<OllamaFetch>(() => Promise.resolve(chatResponse(request())));
    const provider = new OllamaAIProvider({
      ...providerOptions(fetchMock),
      maxInputCharacters: 10,
    });

    await expect(provider.analyzeSignal(request())).rejects.toMatchObject({
      code: "AI_INPUT_TOO_LARGE",
      retryable: false,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects an oversized upstream body without exposing it", async () => {
    const fetchMock = vi.fn<OllamaFetch>(() =>
      Promise.resolve(Response.json({ unexpected: "x".repeat(2_000) })),
    );
    const provider = new OllamaAIProvider({
      ...providerOptions(fetchMock),
      maxResponseBytes: 128,
    });

    await expect(provider.analyzeSignal(request())).rejects.toMatchObject({
      code: "AI_INVALID_RESPONSE",
      message: "AI provider returned an invalid response",
      retryable: false,
    });
  });

  it("does not exceed configured inference concurrency", async () => {
    const analysisRequest = request();
    const resolvers: (() => void)[] = [];
    let active = 0;
    let peak = 0;
    const fetchMock = vi.fn<OllamaFetch>(
      () =>
        new Promise((resolve) => {
          active += 1;
          peak = Math.max(peak, active);
          resolvers.push(() => {
            active -= 1;
            resolve(chatResponse(analysisRequest));
          });
        }),
    );
    const provider = new OllamaAIProvider(providerOptions(fetchMock));

    const first = provider.analyzeSignal(analysisRequest);
    const second = provider.analyzeSignal(analysisRequest);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    resolvers.shift()?.();
    await first;
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    resolvers.shift()?.();
    await second;

    expect(peak).toBe(1);
  });

  it("requires loopback unless private remote HTTPS is explicitly enabled", () => {
    expect(
      () =>
        new OllamaAIProvider({
          ...providerOptions(vi.fn<OllamaFetch>()),
          baseUrl: "https://denis-pc.internal:11434",
        }),
    ).toThrow(/explicitly allowed/);
    expect(
      () =>
        new OllamaAIProvider({
          ...providerOptions(vi.fn<OllamaFetch>()),
          allowRemotePrivateHost: true,
          baseUrl: "https://ollama.example.com",
        }),
    ).toThrow(/private HTTPS/);
  });
});
