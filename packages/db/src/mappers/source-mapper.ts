import { createSource, type CreateSourceInput, type Source } from "@radar/core";

import { type Prisma, type Source as SourceRecord } from "../generated/prisma/client.js";

export const sourceToCreateData = (source: Source): Prisma.SourceCreateInput => ({
  aiProcessingAllowed: source.aiProcessingAllowed,
  country: source.country,
  createdAt: new Date(source.createdAt),
  enabled: source.enabled,
  id: source.id,
  lastErrorAt: source.lastErrorAt === null ? null : new Date(source.lastErrorAt),
  lastSuccessAt: source.lastSuccessAt === null ? null : new Date(source.lastSuccessAt),
  name: source.name,
  ownerContact: source.ownerContact,
  parserKind: source.collectionPolicy.parserKind,
  pollIntervalMinutes: source.collectionPolicy.pollIntervalMinutes,
  regions: [...source.regions],
  reliabilityScore: source.reliabilityScore,
  rightsBasis: source.rightsBasis,
  rightsStatus: source.rightsStatus,
  signalQualityNotes: source.signalQualityNotes,
  type: source.type,
  updatedAt: new Date(source.updatedAt),
  url: source.url,
  verticals: [...source.verticals],
});

export const sourceToUpdateData = (source: Source): Prisma.SourceUpdateInput => ({
  aiProcessingAllowed: source.aiProcessingAllowed,
  country: source.country,
  enabled: source.enabled,
  lastErrorAt: source.lastErrorAt === null ? null : new Date(source.lastErrorAt),
  lastSuccessAt: source.lastSuccessAt === null ? null : new Date(source.lastSuccessAt),
  name: source.name,
  ownerContact: source.ownerContact,
  parserKind: source.collectionPolicy.parserKind,
  pollIntervalMinutes: source.collectionPolicy.pollIntervalMinutes,
  regions: [...source.regions],
  reliabilityScore: source.reliabilityScore,
  rightsBasis: source.rightsBasis,
  rightsStatus: source.rightsStatus,
  signalQualityNotes: source.signalQualityNotes,
  type: source.type,
  updatedAt: new Date(source.updatedAt),
  url: source.url,
  verticals: [...source.verticals],
});

export const sourceFromRecord = (record: SourceRecord): Source =>
  createSource({
    aiProcessingAllowed: record.aiProcessingAllowed,
    collectionPolicy: {
      parserKind: record.parserKind,
      pollIntervalMinutes: record.pollIntervalMinutes,
    },
    country: record.country,
    createdAt: record.createdAt.toISOString(),
    enabled: record.enabled,
    id: record.id as Source["id"],
    lastErrorAt: record.lastErrorAt?.toISOString() ?? null,
    lastSuccessAt: record.lastSuccessAt?.toISOString() ?? null,
    name: record.name,
    ownerContact: record.ownerContact,
    regions: record.regions,
    reliabilityScore: record.reliabilityScore,
    rightsBasis: record.rightsBasis,
    rightsStatus: record.rightsStatus,
    signalQualityNotes: record.signalQualityNotes,
    type: record.type,
    updatedAt: record.updatedAt.toISOString(),
    url: record.url,
    verticals: record.verticals,
  } satisfies CreateSourceInput);
