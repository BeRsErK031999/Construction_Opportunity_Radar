import { type SourceId } from "../shared/identifiers.js";
import { assertInvariant } from "../shared/invariant.js";
import {
  assertTimestampOrder,
  httpUrl,
  isoDateTime,
  nonEmptyString,
  optionalString,
  positiveInteger,
  score,
  uniqueStrings,
  uniqueValues,
  type HttpUrl,
  type IsoDateTime,
  type Score,
} from "../shared/primitives.js";
import { type Vertical } from "../shared/taxonomy.js";

export const SOURCE_TYPES = [
  "FIXTURE",
  "RSS",
  "PUBLIC_API",
  "WEB",
  "PARTNER_FEED",
  "PARTNER_TELEGRAM",
  "MANUAL",
] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

export const RIGHTS_STATUSES = [
  "OPEN_DATA",
  "PUBLIC_API",
  "PARTNER",
  "CONSENT",
  "REVIEW_REQUIRED",
  "BLOCKED",
] as const;
export type RightsStatus = (typeof RIGHTS_STATUSES)[number];

export const PARSER_KINDS = ["FIXTURE_JSON", "RSS", "JSON_API", "HTML", "MANUAL"] as const;
export type ParserKind = (typeof PARSER_KINDS)[number];

export interface SourceCollectionPolicy {
  readonly parserKind: ParserKind;
  readonly pollIntervalMinutes: number | null;
}

export interface Source {
  readonly aiProcessingAllowed: boolean;
  readonly collectionPolicy: SourceCollectionPolicy;
  readonly country: string;
  readonly createdAt: IsoDateTime;
  readonly enabled: boolean;
  readonly id: SourceId;
  readonly lastErrorAt: IsoDateTime | null;
  readonly lastSuccessAt: IsoDateTime | null;
  readonly name: string;
  readonly ownerContact: string | null;
  readonly regions: readonly string[];
  readonly reliabilityScore: Score;
  readonly rightsBasis: string | null;
  readonly rightsStatus: RightsStatus;
  readonly signalQualityNotes: string | null;
  readonly type: SourceType;
  readonly updatedAt: IsoDateTime;
  readonly url: HttpUrl;
  readonly verticals: readonly Vertical[];
}

export interface CreateSourceInput {
  readonly aiProcessingAllowed: boolean;
  readonly collectionPolicy: {
    readonly parserKind: ParserKind;
    readonly pollIntervalMinutes?: number | null;
  };
  readonly country: string;
  readonly createdAt: string;
  readonly enabled: boolean;
  readonly id: SourceId;
  readonly lastErrorAt?: string | null;
  readonly lastSuccessAt?: string | null;
  readonly name: string;
  readonly ownerContact?: string | null;
  readonly regions: readonly string[];
  readonly reliabilityScore: number;
  readonly rightsBasis?: string | null;
  readonly rightsStatus: RightsStatus;
  readonly signalQualityNotes?: string | null;
  readonly type: SourceType;
  readonly updatedAt: string;
  readonly url: string;
  readonly verticals: readonly Vertical[];
}

const AI_ELIGIBLE_RIGHTS = new Set<RightsStatus>(["OPEN_DATA", "PUBLIC_API", "PARTNER", "CONSENT"]);

const optionalTimestamp = (value: string | null | undefined, field: string): IsoDateTime | null =>
  value === null || value === undefined ? null : isoDateTime(value, field);

export const createSource = (input: CreateSourceInput): Source => {
  const createdAt = isoDateTime(input.createdAt, "createdAt");
  const updatedAt = isoDateTime(input.updatedAt, "updatedAt");
  const lastSuccessAt = optionalTimestamp(input.lastSuccessAt, "lastSuccessAt");
  const lastErrorAt = optionalTimestamp(input.lastErrorAt, "lastErrorAt");
  const rightsBasis = optionalString(input.rightsBasis, "rightsBasis", 4_000);
  const pollInterval = input.collectionPolicy.pollIntervalMinutes ?? null;

  assertTimestampOrder(createdAt, updatedAt, "updatedAt");
  if (lastSuccessAt !== null) {
    assertTimestampOrder(createdAt, lastSuccessAt, "lastSuccessAt");
  }
  if (lastErrorAt !== null) {
    assertTimestampOrder(createdAt, lastErrorAt, "lastErrorAt");
  }

  if (input.aiProcessingAllowed) {
    assertInvariant(
      AI_ELIGIBLE_RIGHTS.has(input.rightsStatus),
      "AI_PROCESSING_RIGHTS_REQUIRED",
      "AI processing requires an approved rights status",
    );
    assertInvariant(
      rightsBasis !== null,
      "AI_PROCESSING_BASIS_REQUIRED",
      "AI processing requires a documented rights basis",
    );
  }

  if (input.type === "PARTNER_TELEGRAM") {
    assertInvariant(
      input.rightsStatus === "PARTNER" || input.rightsStatus === "CONSENT",
      "TELEGRAM_PERMISSION_REQUIRED",
      "Partner Telegram sources require PARTNER or CONSENT rights",
    );
  }

  if (pollInterval !== null) {
    positiveInteger(pollInterval, "pollIntervalMinutes");
  } else {
    assertInvariant(
      input.type === "FIXTURE" || input.type === "MANUAL",
      "POLL_INTERVAL_REQUIRED",
      "Live sources require a polling interval",
    );
  }

  return Object.freeze({
    aiProcessingAllowed: input.aiProcessingAllowed,
    collectionPolicy: Object.freeze({
      parserKind: input.collectionPolicy.parserKind,
      pollIntervalMinutes: pollInterval,
    }),
    country: nonEmptyString(input.country, "country", 100),
    createdAt,
    enabled: input.enabled,
    id: input.id,
    lastErrorAt,
    lastSuccessAt,
    name: nonEmptyString(input.name, "name", 300),
    ownerContact: optionalString(input.ownerContact, "ownerContact", 500),
    regions: uniqueStrings(input.regions, "regions", { caseInsensitive: true, minItems: 1 }),
    reliabilityScore: score(input.reliabilityScore, "reliabilityScore"),
    rightsBasis,
    rightsStatus: input.rightsStatus,
    signalQualityNotes: optionalString(input.signalQualityNotes, "signalQualityNotes", 4_000),
    type: input.type,
    updatedAt,
    url: httpUrl(input.url, "url"),
    verticals: uniqueValues(input.verticals, "verticals", 1),
  });
};

export const isAiProcessingPermitted = (source: Source): boolean =>
  source.enabled && source.aiProcessingAllowed && AI_ELIGIBLE_RIGHTS.has(source.rightsStatus);
