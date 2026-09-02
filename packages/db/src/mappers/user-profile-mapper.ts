import {
  createUser,
  createUserProfile,
  userId,
  userProfileId,
  type User,
  type UserProfile,
} from "@radar/core";

import {
  type CompanyProfileRevision as CompanyProfileRecord,
  type Prisma,
  type User as UserRecord,
} from "../generated/prisma/client.js";

export const userToCreateData = (user: User): Prisma.UserCreateInput => ({
  createdAt: new Date(user.createdAt),
  id: user.id,
  revision: user.revision,
  status: user.status,
  telegramUserId: user.telegramUserId,
  updatedAt: new Date(user.updatedAt),
});

export const userFromRecord = (record: UserRecord): User =>
  createUser({
    createdAt: record.createdAt.toISOString(),
    id: userId(record.id),
    revision: record.revision,
    status: record.status,
    telegramUserId: record.telegramUserId,
    updatedAt: record.updatedAt.toISOString(),
  });

export const userProfileToCreateData = (
  profile: UserProfile,
): Prisma.CompanyProfileRevisionCreateInput => ({
  companySize: profile.companySize,
  companyType: profile.companyType,
  createdAt: new Date(profile.createdAt),
  excludedKeywords: [...profile.excludedKeywords],
  id: profile.id,
  ignoredEventTypes: [...profile.ignoredEventTypes],
  interestedEventTypes: [...profile.interestedEventTypes],
  keywords: [...profile.keywords],
  projectValueCurrency: profile.projectValueRange?.currency ?? null,
  projectValueMaximum: profile.projectValueRange?.maximum ?? null,
  projectValueMinimum: profile.projectValueRange?.minimum ?? null,
  regions: [...profile.regions],
  revision: profile.revision,
  servicesAndProducts: [...profile.servicesAndProducts],
  targetClients: [...profile.targetClients],
  updatedAt: new Date(profile.updatedAt),
  user: { connect: { id: profile.userId } },
  verticals: [...profile.verticals],
});

export const userProfileFromRecord = (record: CompanyProfileRecord): UserProfile =>
  createUserProfile({
    companySize: record.companySize,
    companyType: record.companyType,
    createdAt: record.createdAt.toISOString(),
    excludedKeywords: record.excludedKeywords,
    id: userProfileId(record.id),
    ignoredEventTypes: record.ignoredEventTypes,
    interestedEventTypes: record.interestedEventTypes,
    keywords: record.keywords,
    projectValueRange:
      record.projectValueCurrency === null
        ? null
        : {
            currency: record.projectValueCurrency,
            maximum: record.projectValueMaximum,
            minimum: record.projectValueMinimum,
          },
    regions: record.regions,
    revision: record.revision,
    servicesAndProducts: record.servicesAndProducts,
    targetClients: record.targetClients,
    updatedAt: record.updatedAt.toISOString(),
    userId: userId(record.userId),
    verticals: record.verticals,
  });
