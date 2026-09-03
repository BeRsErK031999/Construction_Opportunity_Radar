const INTEGRATION_DATABASE_NAME = "radar_test";
const INTEGRATION_DATABASE_USER = "radar_test";
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

export const externalIntegrationDatabaseUrl = (
  environment: NodeJS.ProcessEnv = process.env,
): string | null => {
  const value = environment.INTEGRATION_DATABASE_URL?.trim();
  if (value === undefined || value.length === 0) {
    return null;
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("INTEGRATION_DATABASE_URL must be a valid PostgreSQL URL");
  }

  let databaseName: string;
  let username: string;
  try {
    databaseName = decodeURIComponent(url.pathname.replace(/^\//u, ""));
    username = decodeURIComponent(url.username);
  } catch {
    throw new Error("INTEGRATION_DATABASE_URL must be a valid PostgreSQL URL");
  }
  if (
    url.protocol !== "postgresql:" ||
    !LOOPBACK_HOSTS.has(url.hostname.toLowerCase()) ||
    databaseName !== INTEGRATION_DATABASE_NAME ||
    username !== INTEGRATION_DATABASE_USER ||
    url.password.length === 0
  ) {
    throw new Error(
      "INTEGRATION_DATABASE_URL must target loopback radar_test as the radar_test user",
    );
  }

  return value;
};
