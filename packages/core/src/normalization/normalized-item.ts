import {
  type CorrelationId,
  type NormalizedItemId,
  type RawItemId,
} from "../shared/identifiers.js";
import { assertInvariant } from "../shared/invariant.js";
import {
  httpUrl,
  isoDateTime,
  nonBlankText,
  nonEmptyString,
  optionalString,
  sha256,
  version,
  type HttpUrl,
  type IsoDateTime,
  type Sha256,
  type Version,
} from "../shared/primitives.js";

export interface NormalizedEntity {
  readonly kind: string;
  readonly value: string;
}

export interface NormalizedItem {
  readonly canonicalUrl: HttpUrl;
  readonly correlationId: CorrelationId;
  readonly createdAt: IsoDateTime;
  readonly entities: readonly NormalizedEntity[];
  readonly id: NormalizedItemId;
  readonly language: string;
  readonly normalizedHash: Sha256;
  readonly normalizerVersion: Version;
  readonly publishedAt: IsoDateTime | null;
  readonly rawItemId: RawItemId;
  readonly text: string;
  readonly title: string | null;
}

export interface CreateNormalizedItemInput {
  readonly canonicalUrl: string;
  readonly correlationId: CorrelationId;
  readonly createdAt: string;
  readonly entities?: readonly {
    readonly kind: string;
    readonly value: string;
  }[];
  readonly id: NormalizedItemId;
  readonly language: string;
  readonly normalizedHash: string;
  readonly normalizerVersion: string;
  readonly publishedAt?: string | null;
  readonly rawItemId: RawItemId;
  readonly text: string;
  readonly title?: string | null;
}

const canonicalLanguage = (value: string): string => {
  let languages: string[];
  try {
    languages = Intl.getCanonicalLocales(nonEmptyString(value, "language", 35));
  } catch {
    assertInvariant(false, "INVALID_LANGUAGE", "language must be a valid BCP 47 tag");
  }
  const language = languages[0];
  assertInvariant(
    language !== undefined,
    "INVALID_LANGUAGE",
    "language must be a valid BCP 47 tag",
  );
  return language;
};

const createEntities = (
  values: CreateNormalizedItemInput["entities"],
): readonly NormalizedEntity[] => {
  const entities = (values ?? []).map((entity) =>
    Object.freeze({
      kind: nonEmptyString(entity.kind, "entities.kind", 100),
      value: nonEmptyString(entity.value, "entities.value", 500),
    }),
  );
  const keys = entities.map(
    (entity) =>
      `${entity.kind.toLocaleLowerCase("ru")}\u0000${entity.value.toLocaleLowerCase("ru")}`,
  );
  assertInvariant(
    new Set(keys).size === keys.length,
    "DUPLICATE_ENTITY",
    "entities must be unique",
  );
  return Object.freeze(entities);
};

export const createNormalizedItem = (input: CreateNormalizedItemInput): NormalizedItem =>
  Object.freeze({
    canonicalUrl: httpUrl(input.canonicalUrl, "canonicalUrl"),
    correlationId: input.correlationId,
    createdAt: isoDateTime(input.createdAt, "createdAt"),
    entities: createEntities(input.entities),
    id: input.id,
    language: canonicalLanguage(input.language),
    normalizedHash: sha256(input.normalizedHash, "normalizedHash"),
    normalizerVersion: version(input.normalizerVersion, "normalizerVersion"),
    publishedAt:
      input.publishedAt === null || input.publishedAt === undefined
        ? null
        : isoDateTime(input.publishedAt, "publishedAt"),
    rawItemId: input.rawItemId,
    text: nonBlankText(input.text, "text"),
    title: optionalString(input.title, "title", 1_000),
  });

export const normalizedItemIdentityKey = (item: NormalizedItem): string =>
  JSON.stringify([item.rawItemId, item.normalizerVersion]);
