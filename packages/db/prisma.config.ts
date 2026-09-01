import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { loadEnvFile } from "node:process";

import { defineConfig } from "prisma/config";

const rootEnvironmentFile = resolve(import.meta.dirname, "../../.env");
if (existsSync(rootEnvironmentFile)) {
  loadEnvFile(rootEnvironmentFile);
}

const localDatabaseUrl = "postgresql://radar:radar_local@127.0.0.1:54329/radar";
const configuredDatabaseUrl = process.env.DATABASE_URL?.trim();
const databaseUrl =
  configuredDatabaseUrl === undefined || configuredDatabaseUrl.length === 0
    ? localDatabaseUrl
    : configuredDatabaseUrl;

export default defineConfig({
  datasource: {
    url: databaseUrl,
  },
  migrations: {
    path: "prisma/migrations",
    seed: "node --env-file-if-exists=../../.env --import tsx prisma/seed.ts",
  },
  schema: "prisma/schema.prisma",
});
