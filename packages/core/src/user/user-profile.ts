import { type UserId, type UserProfileId } from "../shared/identifiers.js";
import { assertInvariant } from "../shared/invariant.js";
import {
  assertDisjoint,
  assertTimestampOrder,
  isoDateTime,
  nonEmptyString,
  positiveInteger,
  uniqueStrings,
  uniqueValues,
  type IsoDateTime,
} from "../shared/primitives.js";
import { PROFILE_VERTICALS, type ProfileVertical } from "../shared/taxonomy.js";

export const COMPANY_SIZES = ["SELF_EMPLOYED", "MICRO", "SMALL", "MEDIUM", "LARGE"] as const;
export type CompanySize = (typeof COMPANY_SIZES)[number];

export interface ProjectValueRange {
  readonly currency: string;
  readonly maximum: number | null;
  readonly minimum: number | null;
}

export interface CreateProjectValueRangeInput {
  readonly currency: string;
  readonly maximum?: number | null;
  readonly minimum?: number | null;
}

export interface UserProfile {
  readonly companySize: CompanySize;
  readonly companyType: string;
  readonly createdAt: IsoDateTime;
  readonly excludedKeywords: readonly string[];
  readonly id: UserProfileId;
  readonly ignoredEventTypes: readonly string[];
  readonly interestedEventTypes: readonly string[];
  readonly keywords: readonly string[];
  readonly projectValueRange: ProjectValueRange | null;
  readonly regions: readonly string[];
  readonly revision: number;
  readonly servicesAndProducts: readonly string[];
  readonly targetClients: readonly string[];
  readonly updatedAt: IsoDateTime;
  readonly userId: UserId;
  readonly verticals: readonly ProfileVertical[];
}

export interface CreateUserProfileInput {
  readonly companySize: CompanySize;
  readonly companyType: string;
  readonly createdAt: string;
  readonly excludedKeywords?: readonly string[];
  readonly id: UserProfileId;
  readonly ignoredEventTypes?: readonly string[];
  readonly interestedEventTypes?: readonly string[];
  readonly keywords?: readonly string[];
  readonly projectValueRange?: CreateProjectValueRangeInput | null;
  readonly regions: readonly string[];
  readonly revision: number;
  readonly servicesAndProducts: readonly string[];
  readonly targetClients?: readonly string[];
  readonly updatedAt: string;
  readonly userId: UserId;
  readonly verticals: readonly ProfileVertical[];
}

const createProjectValueRange = (input: CreateProjectValueRangeInput): ProjectValueRange => {
  const minimum = input.minimum ?? null;
  const maximum = input.maximum ?? null;
  const isValidValue = (value: number | null): boolean =>
    value === null || (Number.isFinite(value) && value >= 0);

  assertInvariant(
    isValidValue(minimum) && isValidValue(maximum),
    "INVALID_PROJECT_VALUE",
    "Project values must be finite non-negative numbers",
  );
  assertInvariant(
    minimum !== null || maximum !== null,
    "EMPTY_PROJECT_VALUE_RANGE",
    "At least one project value boundary is required",
  );
  assertInvariant(
    minimum === null || maximum === null || minimum <= maximum,
    "INVALID_PROJECT_VALUE_RANGE",
    "Project value minimum must not exceed maximum",
  );

  const currency = input.currency.trim().toUpperCase();
  assertInvariant(
    /^[A-Z]{3}$/.test(currency),
    "INVALID_CURRENCY",
    "currency must be an ISO 4217 code",
  );

  return Object.freeze({ currency, maximum, minimum });
};

export const createUserProfile = (input: CreateUserProfileInput): UserProfile => {
  const createdAt = isoDateTime(input.createdAt, "createdAt");
  const updatedAt = isoDateTime(input.updatedAt, "updatedAt");
  assertTimestampOrder(createdAt, updatedAt, "updatedAt");

  const verticals = uniqueValues(input.verticals, "verticals", 1);
  assertInvariant(
    verticals.every((vertical) => PROFILE_VERTICALS.includes(vertical)),
    "UNSUPPORTED_PROFILE_VERTICAL",
    "Profiles support only Construction and HoReCa before Gate G4",
  );

  const keywords = uniqueStrings(input.keywords ?? [], "keywords", {
    caseInsensitive: true,
    maxItems: 100,
  });
  const excludedKeywords = uniqueStrings(input.excludedKeywords ?? [], "excludedKeywords", {
    caseInsensitive: true,
    maxItems: 100,
  });
  assertDisjoint(
    keywords,
    excludedKeywords,
    "CONFLICTING_KEYWORDS",
    "keywords and excludedKeywords must not overlap",
  );

  const interestedEventTypes = uniqueStrings(
    input.interestedEventTypes ?? [],
    "interestedEventTypes",
    { caseInsensitive: true, maxItems: 100 },
  );
  const ignoredEventTypes = uniqueStrings(input.ignoredEventTypes ?? [], "ignoredEventTypes", {
    caseInsensitive: true,
    maxItems: 100,
  });
  assertDisjoint(
    interestedEventTypes,
    ignoredEventTypes,
    "CONFLICTING_EVENT_TYPES",
    "interestedEventTypes and ignoredEventTypes must not overlap",
  );

  return Object.freeze({
    companySize: input.companySize,
    companyType: nonEmptyString(input.companyType, "companyType", 300),
    createdAt,
    excludedKeywords,
    id: input.id,
    ignoredEventTypes,
    interestedEventTypes,
    keywords,
    projectValueRange:
      input.projectValueRange === undefined || input.projectValueRange === null
        ? null
        : createProjectValueRange(input.projectValueRange),
    regions: uniqueStrings(input.regions, "regions", {
      caseInsensitive: true,
      maxItems: 100,
      minItems: 1,
    }),
    revision: positiveInteger(input.revision, "revision"),
    servicesAndProducts: uniqueStrings(input.servicesAndProducts, "servicesAndProducts", {
      caseInsensitive: true,
      maxItems: 100,
      minItems: 1,
    }),
    targetClients: uniqueStrings(input.targetClients ?? [], "targetClients", {
      caseInsensitive: true,
      maxItems: 100,
    }),
    updatedAt,
    userId: input.userId,
    verticals,
  });
};
