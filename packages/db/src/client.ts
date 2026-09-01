import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "./generated/prisma/client.js";

export type DatabaseClient = PrismaClient;

export const createDatabaseClient = (databaseUrl: string): DatabaseClient => {
  const connectionString = databaseUrl.trim();
  if (connectionString.length === 0) {
    throw new Error("databaseUrl must not be empty");
  }

  return new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
  });
};
