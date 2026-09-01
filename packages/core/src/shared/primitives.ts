import { assertInvariant } from "./invariant.js";

declare const brand: unique symbol;

type Branded<Value, Name extends string> = Value & { readonly [brand]: Name };

export type HttpUrl = Branded<string, "HttpUrl">;
export type IsoDateTime = Branded<string, "IsoDateTime">;
export type Probability = Branded<number, "Probability">;
export type Score = Branded<number, "Score">;
export type Sha256 = Branded<string, "Sha256">;
export type Version = Branded<string, "Version">;

export type JsonPrimitive = boolean | number | string | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type ReadonlyJsonValue =
  JsonPrimitive | readonly ReadonlyJsonValue[] | { readonly [key: string]: ReadonlyJsonValue };

export const nonEmptyString = (value: string, field: string, maxLength = 2_000): string => {
  const normalized = value.trim();
  assertInvariant(normalized.length > 0, "EMPTY_TEXT", `${field} must not be empty`);
  assertInvariant(normalized.length <= maxLength, "TEXT_TOO_LONG", `${field} is too long`);
  return normalized;
};

export const nonBlankText = (value: string, field: string, maxLength = 1_000_000): string => {
  assertInvariant(value.trim().length > 0, "EMPTY_TEXT", `${field} must not be empty`);
  assertInvariant(value.length <= maxLength, "TEXT_TOO_LONG", `${field} is too long`);
  return value;
};

export const optionalString = (
  value: string | null | undefined,
  field: string,
  maxLength = 2_000,
): string | null =>
  value === null || value === undefined ? null : nonEmptyString(value, field, maxLength);

export const isoDateTime = (value: string, field = "timestamp"): IsoDateTime => {
  const milliseconds = Date.parse(value);
  assertInvariant(
    Number.isFinite(milliseconds),
    "INVALID_TIMESTAMP",
    `${field} must be an ISO date-time`,
  );
  return new Date(milliseconds).toISOString() as IsoDateTime;
};

export const assertTimestampOrder = (
  earlier: IsoDateTime,
  later: IsoDateTime,
  laterField: string,
): void => {
  assertInvariant(
    later >= earlier,
    "INVALID_TIMESTAMP_ORDER",
    `${laterField} must not precede creation time`,
  );
};

export const httpUrl = (value: string, field = "url"): HttpUrl => {
  const normalized = value.trim();
  let parsed: URL;

  try {
    parsed = new URL(normalized);
  } catch {
    assertInvariant(false, "INVALID_HTTP_URL", `${field} must be an absolute HTTP(S) URL`);
  }

  assertInvariant(
    parsed.protocol === "http:" || parsed.protocol === "https:",
    "INVALID_HTTP_URL",
    `${field} must be an absolute HTTP(S) URL`,
  );
  return normalized as HttpUrl;
};

export const sha256 = (value: string, field = "hash"): Sha256 => {
  const normalized = value.trim().toLowerCase();
  assertInvariant(
    /^[a-f0-9]{64}$/.test(normalized),
    "INVALID_SHA256",
    `${field} must be a SHA-256 hex digest`,
  );
  return normalized as Sha256;
};

export const score = (value: number, field: string): Score => {
  assertInvariant(Number.isFinite(value), "INVALID_SCORE", `${field} must be finite`);
  assertInvariant(
    value >= 0 && value <= 100,
    "INVALID_SCORE",
    `${field} must be between 0 and 100`,
  );
  return value as Score;
};

export const probability = (value: number, field: string): Probability => {
  assertInvariant(Number.isFinite(value), "INVALID_PROBABILITY", `${field} must be finite`);
  assertInvariant(
    value >= 0 && value <= 1,
    "INVALID_PROBABILITY",
    `${field} must be between 0 and 1`,
  );
  return value as Probability;
};

export const version = (value: string, field: string): Version =>
  nonEmptyString(value, field, 100) as Version;

export const positiveInteger = (value: number, field: string): number => {
  assertInvariant(
    Number.isInteger(value) && value > 0,
    "INVALID_POSITIVE_INTEGER",
    `${field} must be a positive integer`,
  );
  return value;
};

export interface StringListOptions {
  readonly caseInsensitive?: boolean;
  readonly maxItems?: number;
  readonly minItems?: number;
}

export const uniqueStrings = (
  values: readonly string[],
  field: string,
  options: StringListOptions = {},
): readonly string[] => {
  const normalized = values.map((value) => nonEmptyString(value, field));
  const keys = normalized.map((value) =>
    options.caseInsensitive === true ? value.toLocaleLowerCase("ru") : value,
  );
  assertInvariant(
    new Set(keys).size === keys.length,
    "DUPLICATE_LIST_VALUE",
    `${field} must contain unique values`,
  );
  assertInvariant(
    normalized.length >= (options.minItems ?? 0),
    "TOO_FEW_LIST_VALUES",
    `${field} has too few values`,
  );
  assertInvariant(
    normalized.length <= (options.maxItems ?? Number.POSITIVE_INFINITY),
    "TOO_MANY_LIST_VALUES",
    `${field} has too many values`,
  );
  return Object.freeze(normalized);
};

export const uniqueValues = <Value extends string>(
  values: readonly Value[],
  field: string,
  minimum = 0,
): readonly Value[] => {
  assertInvariant(values.length >= minimum, "TOO_FEW_LIST_VALUES", `${field} has too few values`);
  assertInvariant(
    new Set(values).size === values.length,
    "DUPLICATE_LIST_VALUE",
    `${field} must contain unique values`,
  );
  return Object.freeze([...values]);
};

export const assertDisjoint = (
  left: readonly string[],
  right: readonly string[],
  code: string,
  message: string,
): void => {
  const normalizedLeft = new Set(left.map((value) => value.toLocaleLowerCase("ru")));
  assertInvariant(
    right.every((value) => !normalizedLeft.has(value.toLocaleLowerCase("ru"))),
    code,
    message,
  );
};

export const freezeJson = (value: JsonValue): ReadonlyJsonValue => {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    assertInvariant(Number.isFinite(value), "INVALID_JSON_NUMBER", "JSON numbers must be finite");
    return value;
  }

  if (Array.isArray(value)) {
    return Object.freeze(value.map(freezeJson));
  }

  const result: Record<string, ReadonlyJsonValue> = {};
  for (const [key, nestedValue] of Object.entries(value)) {
    result[key] = freezeJson(nestedValue);
  }
  return Object.freeze(result);
};
