import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { loadEnvFile } from "node:process";

const LOCAL_DATABASE_URL = "postgresql://radar:radar_local@127.0.0.1:54329/radar";
const rootEnvironmentFile = resolve(process.cwd(), ".env");

if (existsSync(rootEnvironmentFile)) {
  loadEnvFile(rootEnvironmentFile);
}

export const databaseUrl = (): string => {
  const value = process.env.DATABASE_URL?.trim();
  return value === undefined || value.length === 0 ? LOCAL_DATABASE_URL : value;
};
