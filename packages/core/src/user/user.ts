import { type UserId } from "../shared/identifiers.js";
import {
  assertTimestampOrder,
  isoDateTime,
  nonEmptyString,
  positiveInteger,
  type IsoDateTime,
} from "../shared/primitives.js";

export const USER_STATUSES = ["ACTIVE", "BLOCKED", "DELETED"] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export interface User {
  readonly createdAt: IsoDateTime;
  readonly id: UserId;
  readonly revision: number;
  readonly status: UserStatus;
  readonly telegramUserId: string;
  readonly updatedAt: IsoDateTime;
}

export interface CreateUserInput {
  readonly createdAt: string;
  readonly id: UserId;
  readonly revision: number;
  readonly status: UserStatus;
  readonly telegramUserId: string;
  readonly updatedAt: string;
}

export const createUser = (input: CreateUserInput): User => {
  const createdAt = isoDateTime(input.createdAt, "createdAt");
  const updatedAt = isoDateTime(input.updatedAt, "updatedAt");
  assertTimestampOrder(createdAt, updatedAt, "updatedAt");

  return Object.freeze({
    createdAt,
    id: input.id,
    revision: positiveInteger(input.revision, "revision"),
    status: input.status,
    telegramUserId: nonEmptyString(input.telegramUserId, "telegramUserId", 100),
    updatedAt,
  });
};
