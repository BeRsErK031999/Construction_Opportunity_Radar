import { createDatabaseClient, seedDevelopmentDatabase } from "../src/index.js";

const localDatabaseUrl = "postgresql://radar:radar_local@127.0.0.1:54329/radar";
const migrationDatabaseUrl = process.env.MIGRATION_DATABASE_URL?.trim();
const configuredDatabaseUrl = process.env.DATABASE_URL?.trim();
const databaseUrl =
  migrationDatabaseUrl !== undefined && migrationDatabaseUrl.length > 0
    ? migrationDatabaseUrl
    : configuredDatabaseUrl === undefined || configuredDatabaseUrl.length === 0
      ? localDatabaseUrl
      : configuredDatabaseUrl;

const client = createDatabaseClient(databaseUrl);

try {
  const summary = await seedDevelopmentDatabase(client);
  process.stdout.write(`${JSON.stringify(summary)}\n`);
} finally {
  await client.$disconnect();
}
