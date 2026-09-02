import {
  createFeedback,
  createSource,
  createUserProfile,
  DomainInvariantError,
  type CompanySize,
  type CorrelationId,
  type Feedback,
  type FeedbackAction,
  type FeedbackId,
  type ParserKind,
  type ProfileVertical,
  type ProjectValueRange,
  type Recommendation,
  type RecommendationId,
  type RightsStatus,
  type Signal,
  type SignalId,
  type SignalStatus,
  type Source,
  type SourceId,
  type SourceType,
  type SuccessfulAnalysis,
  type User,
  type UserId,
  type UserProfile,
  type Vertical,
} from "@radar/core";

export type ApplicationApiErrorCode = "CONFLICT" | "FORBIDDEN" | "INVALID_INPUT" | "NOT_FOUND";

export class ApplicationApiError extends Error {
  readonly code: ApplicationApiErrorCode;

  constructor(code: ApplicationApiErrorCode, message: string) {
    super(message);
    this.name = "ApplicationApiError";
    this.code = code;
  }
}

export class FeedbackWriteConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FeedbackWriteConflictError";
  }
}

const validateInput = <Value>(factory: () => Value): Value => {
  try {
    return factory();
  } catch (error) {
    if (error instanceof DomainInvariantError) {
      throw new ApplicationApiError("INVALID_INPUT", error.message);
    }
    throw error;
  }
};

export interface Page<Value> {
  readonly items: readonly Value[];
  readonly nextCursor: string | null;
}

export interface SourceListFilter {
  readonly after?: SourceId;
  readonly aiProcessingAllowed?: boolean;
  readonly enabled?: boolean;
  readonly limit: number;
  readonly rightsStatus?: RightsStatus;
  readonly vertical?: Vertical;
}

export interface SourceRegistryRepository {
  findById(id: SourceId): Promise<Source | null>;
  listPage(filter: SourceListFilter): Promise<Page<Source>>;
  save(source: Source): Promise<Source>;
}

export interface SourceWritableFields {
  readonly aiProcessingAllowed: boolean;
  readonly collectionPolicy: {
    readonly parserKind: ParserKind;
    readonly pollIntervalMinutes: number | null;
  };
  readonly country: string;
  readonly enabled: boolean;
  readonly name: string;
  readonly ownerContact: string | null;
  readonly regions: readonly string[];
  readonly reliabilityScore: number;
  readonly rightsBasis: string | null;
  readonly rightsStatus: RightsStatus;
  readonly signalQualityNotes: string | null;
  readonly type: SourceType;
  readonly url: string;
  readonly verticals: readonly Vertical[];
}

export type SourcePatch = Partial<SourceWritableFields>;

export const listSources = (
  repository: SourceRegistryRepository,
  filter: SourceListFilter,
): Promise<Page<Source>> => repository.listPage(filter);

export const createSourceEntry = async (input: {
  readonly fields: SourceWritableFields;
  readonly id: SourceId;
  readonly now: string;
  readonly repository: SourceRegistryRepository;
}): Promise<Source> => {
  if ((await input.repository.findById(input.id)) !== null) {
    throw new ApplicationApiError("CONFLICT", "Source identifier is already in use");
  }
  return input.repository.save(
    validateInput(() =>
      createSource({
        ...input.fields,
        createdAt: input.now,
        id: input.id,
        updatedAt: input.now,
      }),
    ),
  );
};

const patched = <Value>(candidate: Value | undefined, current: Value): Value => {
  if (candidate === undefined) {
    return current;
  }
  return candidate;
};

export const patchSourceEntry = async (input: {
  readonly id: SourceId;
  readonly now: string;
  readonly patch: SourcePatch;
  readonly repository: SourceRegistryRepository;
}): Promise<Source> => {
  const current = await input.repository.findById(input.id);
  if (current === null) {
    throw new ApplicationApiError("NOT_FOUND", "Source was not found");
  }
  return input.repository.save(
    validateInput(() =>
      createSource({
        aiProcessingAllowed: patched(input.patch.aiProcessingAllowed, current.aiProcessingAllowed),
        collectionPolicy: patched(input.patch.collectionPolicy, current.collectionPolicy),
        country: patched(input.patch.country, current.country),
        createdAt: current.createdAt,
        enabled: patched(input.patch.enabled, current.enabled),
        id: current.id,
        lastErrorAt: current.lastErrorAt,
        lastSuccessAt: current.lastSuccessAt,
        name: patched(input.patch.name, current.name),
        ownerContact: patched(input.patch.ownerContact, current.ownerContact),
        regions: patched(input.patch.regions, current.regions),
        reliabilityScore: patched(input.patch.reliabilityScore, current.reliabilityScore),
        rightsBasis: patched(input.patch.rightsBasis, current.rightsBasis),
        rightsStatus: patched(input.patch.rightsStatus, current.rightsStatus),
        signalQualityNotes: patched(input.patch.signalQualityNotes, current.signalQualityNotes),
        type: patched(input.patch.type, current.type),
        updatedAt: input.now,
        url: patched(input.patch.url, current.url),
        verticals: patched(input.patch.verticals, current.verticals),
      }),
    ),
  );
};

export interface OpportunitySourceLink {
  readonly canonicalUrl: string;
  readonly normalizedItemId: string;
  readonly publishedAt: string | null;
  readonly sourceId: SourceId;
  readonly sourceName: string;
  readonly sourceUrl: string;
}

export interface SignalOpportunity {
  readonly analysis: SuccessfulAnalysis;
  readonly recommendation: Recommendation;
  readonly signal: Signal;
  readonly sources: readonly OpportunitySourceLink[];
}

export interface SignalListFilter {
  readonly after?: RecommendationId;
  readonly category?: string;
  readonly dateFrom?: string;
  readonly dateTo?: string;
  readonly limit: number;
  readonly minimumScore?: number;
  readonly status?: SignalStatus;
  readonly vertical?: Vertical;
}

export interface SignalOpportunityRepository {
  findForUser(userId: UserId, signalId: SignalId): Promise<SignalOpportunity | null>;
  listForUser(userId: UserId, filter: SignalListFilter): Promise<Page<SignalOpportunity>>;
}

export const listSignalOpportunities = (input: {
  readonly callerUserId: UserId;
  readonly filter: SignalListFilter;
  readonly repository: SignalOpportunityRepository;
}): Promise<Page<SignalOpportunity>> =>
  input.repository.listForUser(input.callerUserId, input.filter);

export const getSignalOpportunity = async (input: {
  readonly callerUserId: UserId;
  readonly repository: SignalOpportunityRepository;
  readonly signalId: SignalId;
}): Promise<SignalOpportunity> => {
  const opportunity = await input.repository.findForUser(input.callerUserId, input.signalId);
  if (opportunity === null) {
    throw new ApplicationApiError("NOT_FOUND", "Signal opportunity was not found for this user");
  }
  return opportunity;
};

export interface UserProfileRegistration {
  readonly profile: UserProfile;
  readonly user: User;
}

export interface UserProfileRepository {
  findLatest(userId: UserId): Promise<UserProfileRegistration | null>;
  save(user: User, profile: UserProfile): Promise<unknown>;
}

export interface UserProfilePatch {
  readonly companySize?: CompanySize;
  readonly companyType?: string;
  readonly excludedKeywords?: readonly string[];
  readonly ignoredEventTypes?: readonly string[];
  readonly interestedEventTypes?: readonly string[];
  readonly keywords?: readonly string[];
  readonly projectValueRange?: ProjectValueRange | null;
  readonly regions?: readonly string[];
  readonly servicesAndProducts?: readonly string[];
  readonly targetClients?: readonly string[];
  readonly verticals?: readonly ProfileVertical[];
}

const authorizeUser = (callerUserId: UserId, targetUserId: UserId): void => {
  if (callerUserId !== targetUserId) {
    throw new ApplicationApiError("FORBIDDEN", "Caller cannot access another user profile");
  }
};

export const getUserProfile = async (input: {
  readonly callerUserId: UserId;
  readonly repository: UserProfileRepository;
  readonly userId: UserId;
}): Promise<UserProfile> => {
  authorizeUser(input.callerUserId, input.userId);
  const registration = await input.repository.findLatest(input.userId);
  if (registration === null) {
    throw new ApplicationApiError("NOT_FOUND", "User profile was not found");
  }
  return registration.profile;
};

export const patchUserProfile = async (input: {
  readonly callerUserId: UserId;
  readonly now: string;
  readonly patch: UserProfilePatch;
  readonly repository: UserProfileRepository;
  readonly userId: UserId;
}): Promise<UserProfile> => {
  authorizeUser(input.callerUserId, input.userId);
  const registration = await input.repository.findLatest(input.userId);
  if (registration === null) {
    throw new ApplicationApiError("NOT_FOUND", "User profile was not found");
  }
  if (registration.user.status !== "ACTIVE") {
    throw new ApplicationApiError("FORBIDDEN", "Inactive users cannot update profiles");
  }
  const current = registration.profile;
  const profile = validateInput(() =>
    createUserProfile({
      companySize: patched(input.patch.companySize, current.companySize),
      companyType: patched(input.patch.companyType, current.companyType),
      createdAt: input.now,
      excludedKeywords: patched(input.patch.excludedKeywords, current.excludedKeywords),
      id: current.id,
      ignoredEventTypes: patched(input.patch.ignoredEventTypes, current.ignoredEventTypes),
      interestedEventTypes: patched(input.patch.interestedEventTypes, current.interestedEventTypes),
      keywords: patched(input.patch.keywords, current.keywords),
      projectValueRange: patched(input.patch.projectValueRange, current.projectValueRange),
      regions: patched(input.patch.regions, current.regions),
      revision: current.revision + 1,
      servicesAndProducts: patched(input.patch.servicesAndProducts, current.servicesAndProducts),
      targetClients: patched(input.patch.targetClients, current.targetClients),
      updatedAt: input.now,
      userId: current.userId,
      verticals: patched(input.patch.verticals, current.verticals),
    }),
  );
  await input.repository.save(registration.user, profile);
  return profile;
};

export interface RecommendationFeedbackContext {
  readonly correlationId: CorrelationId;
  readonly recommendationId: RecommendationId;
}

export interface FeedbackSaveResult {
  readonly created: boolean;
  readonly feedback: Feedback;
}

export interface FeedbackRepository {
  findRecommendationForUser(
    userId: UserId,
    signalId: SignalId,
  ): Promise<RecommendationFeedbackContext | null>;
  save(feedback: Feedback): Promise<FeedbackSaveResult>;
}

export const submitSignalFeedback = async (input: {
  readonly action: FeedbackAction;
  readonly callerUserId: UserId;
  readonly feedbackId: FeedbackId;
  readonly now: string;
  readonly reason?: string | null;
  readonly repository: FeedbackRepository;
  readonly signalId: SignalId;
}): Promise<FeedbackSaveResult> => {
  const context = await input.repository.findRecommendationForUser(
    input.callerUserId,
    input.signalId,
  );
  if (context === null) {
    throw new ApplicationApiError("NOT_FOUND", "Signal recommendation was not found for this user");
  }
  try {
    return await input.repository.save(
      validateInput(() =>
        createFeedback({
          action: input.action,
          correlationId: context.correlationId,
          id: input.feedbackId,
          ...(input.reason === undefined ? {} : { reason: input.reason }),
          recommendationId: context.recommendationId,
          userId: input.callerUserId,
          createdAt: input.now,
        }),
      ),
    );
  } catch (error) {
    if (error instanceof FeedbackWriteConflictError) {
      throw new ApplicationApiError("CONFLICT", error.message);
    }
    throw error;
  }
};
