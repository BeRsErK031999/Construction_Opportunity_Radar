import {
  type ProfileRegistrationRepository,
  type ProfileRegistrationSaveResult,
  type TelegramUserRepository,
  type UserProfileRepository as UserProfileApiRepository,
  type UserProfileRegistration,
} from "@radar/application";
import { type User, type UserProfile } from "@radar/core";

import { type DatabaseClient } from "../client.js";
import { PersistenceError, ProfileIdentityConflictError } from "../errors.js";
import { Prisma } from "../generated/prisma/client.js";
import {
  userFromRecord,
  userProfileFromRecord,
  userProfileToCreateData,
  userToCreateData,
} from "../mappers/user-profile-mapper.js";

const same = (left: unknown, right: unknown): boolean =>
  JSON.stringify(left) === JSON.stringify(right);

export class PrismaProfileRegistrationRepository
  implements ProfileRegistrationRepository, TelegramUserRepository, UserProfileApiRepository
{
  readonly #client: DatabaseClient;

  constructor(client: DatabaseClient) {
    this.#client = client;
  }

  countProfiles(): Promise<number> {
    return this.#client.companyProfileRevision.count();
  }

  async findByTelegramUserId(telegramUserId: string): Promise<User | null> {
    const record = await this.#client.user.findUnique({ where: { telegramUserId } });
    return record === null ? null : userFromRecord(record);
  }

  async findLatest(userId: User["id"]): Promise<UserProfileRegistration | null> {
    const userRecord = await this.#client.user.findUnique({ where: { id: userId } });
    if (userRecord === null) {
      return null;
    }
    const profileRecord = await this.#client.companyProfileRevision.findFirst({
      orderBy: [{ revision: "desc" }, { id: "asc" }],
      where: { userId },
    });
    return profileRecord === null
      ? null
      : Object.freeze({
          profile: userProfileFromRecord(profileRecord),
          user: userFromRecord(userRecord),
        });
  }

  async save(user: User, profile: UserProfile): Promise<ProfileRegistrationSaveResult> {
    if (profile.userId !== user.id) {
      throw new ProfileIdentityConflictError("Profile must belong to the registered user");
    }
    const currentUser = await this.#client.user.findUnique({ where: { id: user.id } });
    const currentProfile = await this.#client.companyProfileRevision.findUnique({
      where: { id_revision: { id: profile.id, revision: profile.revision } },
    });
    if (currentUser !== null && !same(userFromRecord(currentUser), user)) {
      throw new ProfileIdentityConflictError(`User ${user.id} already has different data`);
    }
    if (currentProfile !== null && !same(userProfileFromRecord(currentProfile), profile)) {
      throw new ProfileIdentityConflictError(
        `Profile ${profile.id}/${String(profile.revision)} already has different data`,
      );
    }
    if (currentUser !== null && currentProfile !== null) {
      return Object.freeze({
        createdProfile: false,
        createdUser: false,
        profile: userProfileFromRecord(currentProfile),
        user: userFromRecord(currentUser),
      });
    }

    try {
      const result = await this.#client.$transaction(async (transaction) => {
        const userRecord =
          currentUser ?? (await transaction.user.create({ data: userToCreateData(user) }));
        const profileRecord =
          currentProfile ??
          (await transaction.companyProfileRevision.create({
            data: userProfileToCreateData(profile),
          }));
        return { profileRecord, userRecord };
      });
      return Object.freeze({
        createdProfile: currentProfile === null,
        createdUser: currentUser === null,
        profile: userProfileFromRecord(result.profileRecord),
        user: userFromRecord(result.userRecord),
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const racedUser = await this.#client.user.findUnique({ where: { id: user.id } });
        const racedProfile = await this.#client.companyProfileRevision.findUnique({
          where: { id_revision: { id: profile.id, revision: profile.revision } },
        });
        if (
          racedUser !== null &&
          racedProfile !== null &&
          same(userFromRecord(racedUser), user) &&
          same(userProfileFromRecord(racedProfile), profile)
        ) {
          return Object.freeze({
            createdProfile: false,
            createdUser: false,
            profile: userProfileFromRecord(racedProfile),
            user: userFromRecord(racedUser),
          });
        }
        throw new ProfileIdentityConflictError("Concurrent profile registration wrote other data");
      }
      if (error instanceof ProfileIdentityConflictError) {
        throw error;
      }
      throw new PersistenceError(
        "PROFILE_REGISTRATION_SAVE_FAILED",
        "Unable to persist user profile registration",
        error,
      );
    }
  }
}
