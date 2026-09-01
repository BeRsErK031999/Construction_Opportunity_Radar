import { type Source, type SourceId } from "@radar/core";

import { type DatabaseClient } from "../client.js";
import {
  sourceFromRecord,
  sourceToCreateData,
  sourceToUpdateData,
} from "../mappers/source-mapper.js";

export interface ListSourcesOptions {
  readonly enabled?: boolean;
  readonly limit?: number;
}

export class PrismaSourceRepository {
  readonly #client: DatabaseClient;

  constructor(client: DatabaseClient) {
    this.#client = client;
  }

  async count(): Promise<number> {
    return this.#client.source.count();
  }

  async findById(id: SourceId): Promise<Source | null> {
    const record = await this.#client.source.findUnique({ where: { id } });
    return record === null ? null : sourceFromRecord(record);
  }

  async list(options: ListSourcesOptions = {}): Promise<readonly Source[]> {
    const limit = options.limit ?? 100;
    if (!Number.isInteger(limit) || limit < 1 || limit > 1_000) {
      throw new RangeError("limit must be an integer between 1 and 1000");
    }

    const records = await this.#client.source.findMany({
      orderBy: { id: "asc" },
      take: limit,
      ...(options.enabled === undefined ? {} : { where: { enabled: options.enabled } }),
    });
    return Object.freeze(records.map(sourceFromRecord));
  }

  async save(source: Source): Promise<Source> {
    const record = await this.#client.source.upsert({
      create: sourceToCreateData(source),
      update: sourceToUpdateData(source),
      where: { id: source.id },
    });
    return sourceFromRecord(record);
  }
}
