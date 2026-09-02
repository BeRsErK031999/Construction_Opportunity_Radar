import {
  type AIAnalysisCandidate,
  type AnalysisIdentity,
  type AnalysisRepository,
  type AnalysisSaveResult,
  type OfflineAnalysisRepository,
} from "@radar/application";
import { type Analysis } from "@radar/core";

import { type DatabaseClient } from "../client.js";
import { AnalysisIdentityConflictError, PersistenceError } from "../errors.js";
import { Prisma } from "../generated/prisma/client.js";
import { analysisFromRecord, analysisToCreateData } from "../mappers/analysis-mapper.js";
import { normalizedItemFromRecord } from "../mappers/normalized-item-mapper.js";
import { signalFromRecord } from "../mappers/signal-mapper.js";
import { sourceFromRecord } from "../mappers/source-mapper.js";

const analysisInclude = { sources: true } as const;
const signalCandidateInclude = {
  evidence: { include: { normalizedItem: true, source: true } },
} as const;

const comparable = (analysis: Analysis): Omit<Analysis, "createdAt" | "id"> => {
  const { createdAt, id, ...value } = analysis;
  void createdAt;
  void id;
  return value;
};

const compatible = (existing: Analysis, candidate: Analysis): boolean =>
  JSON.stringify(comparable(existing)) === JSON.stringify(comparable(candidate));

const assertCompatible = (existing: Analysis, candidate: Analysis): void => {
  if (!compatible(existing, candidate)) {
    throw new AnalysisIdentityConflictError(
      `Analysis identity for signal ${candidate.signalId} already has a different outcome`,
    );
  }
};

export class PrismaAnalysisRepository implements AnalysisRepository, OfflineAnalysisRepository {
  readonly #client: DatabaseClient;

  constructor(client: DatabaseClient) {
    this.#client = client;
  }

  count(): Promise<number> {
    return this.#client.analysis.count();
  }

  async findByIdentity(identity: AnalysisIdentity): Promise<Analysis | null> {
    const record = await this.#client.analysis.findUnique({
      include: analysisInclude,
      where: {
        signalId_provider_model_promptVersion_schemaVersion_analysisVersion: {
          analysisVersion: identity.analysisVersion,
          model: identity.model,
          promptVersion: identity.promptVersion,
          provider: identity.provider,
          schemaVersion: identity.schemaVersion,
          signalId: identity.signalId,
        },
      },
    });
    return record === null ? null : analysisFromRecord(record);
  }

  async listCandidates(options: {
    readonly classifierVersion: string;
    readonly limit?: number;
  }): Promise<readonly AIAnalysisCandidate[]> {
    const limit = options.limit ?? 1_000;
    if (!Number.isInteger(limit) || limit < 1 || limit > 10_000) {
      throw new RangeError("limit must be an integer between 1 and 10000");
    }
    const records = await this.#client.signal.findMany({
      include: signalCandidateInclude,
      orderBy: { id: "asc" },
      take: limit,
      where: {
        classifierVersion: options.classifierVersion,
        status: { in: ["ACTIVE", "CANDIDATE"] },
      },
    });
    return Object.freeze(
      records.map((record) =>
        Object.freeze({
          evidence: Object.freeze(
            record.evidence.map((evidence) =>
              Object.freeze({
                normalizedItem: normalizedItemFromRecord(evidence.normalizedItem),
                source: sourceFromRecord(evidence.source),
              }),
            ),
          ),
          signal: signalFromRecord(record),
        }),
      ),
    );
  }

  async save(analysis: Analysis): Promise<AnalysisSaveResult> {
    const existing = await this.findByIdentity({
      analysisVersion: analysis.analysisVersion,
      model: analysis.model,
      promptVersion: analysis.promptVersion,
      provider: analysis.provider,
      schemaVersion: analysis.schemaVersion,
      signalId: analysis.signalId,
    });
    if (existing !== null) {
      assertCompatible(existing, analysis);
      return Object.freeze({ analysis: existing, created: false });
    }

    try {
      const record = await this.#client.analysis.create({
        data: analysisToCreateData(analysis),
        include: analysisInclude,
      });
      return Object.freeze({ analysis: analysisFromRecord(record), created: true });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const raced = await this.findByIdentity({
          analysisVersion: analysis.analysisVersion,
          model: analysis.model,
          promptVersion: analysis.promptVersion,
          provider: analysis.provider,
          schemaVersion: analysis.schemaVersion,
          signalId: analysis.signalId,
        });
        if (raced !== null) {
          assertCompatible(raced, analysis);
          return Object.freeze({ analysis: raced, created: false });
        }
        throw new AnalysisIdentityConflictError(
          `Analysis id ${analysis.id} already belongs to a different identity`,
        );
      }
      if (error instanceof AnalysisIdentityConflictError) {
        throw error;
      }
      throw new PersistenceError("ANALYSIS_SAVE_FAILED", "Unable to persist analysis", error);
    }
  }
}
