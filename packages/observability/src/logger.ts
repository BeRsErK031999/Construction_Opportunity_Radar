import pino, {
  type DestinationStream,
  type Logger,
  type LoggerOptions as PinoLoggerOptions,
} from "pino";

export const REDACTED_LOG_VALUE = "[REDACTED]";

export const REDACTED_LOG_PATHS = [
  "accessToken",
  "access_token",
  "adminAuthToken",
  "admin_auth_token",
  "authorization",
  "backupEncryptionKey",
  "backup_encryption_key",
  "botToken",
  "bot_token",
  "clientSecret",
  "client_secret",
  "cookie",
  "credentials",
  "password",
  "privateKey",
  "private_key",
  "refreshToken",
  "refresh_token",
  "secret",
  "token",
  "apiKey",
  "api_key",
  "apiAuthToken",
  "api_auth_token",
  "databaseUrl",
  "database_url",
  "telegramBotToken",
  "telegram_bot_token",
  "req.headers.authorization",
  "req.headers.cookie",
  "headers.authorization",
  "headers.cookie",
  "headers.x-api-key",
  "request.headers.authorization",
  "request.headers.cookie",
  "request.headers.x-api-key",
  "config.adminAuthToken",
  "config.admin_auth_token",
  "config.apiAuthToken",
  "config.api_auth_token",
  "config.databaseUrl",
  "config.database_url",
  "env.API_AUTH_TOKEN",
  "env.API_ADMIN_AUTH_TOKEN",
  "env.DATABASE_URL",
  "env.BACKUP_ENCRYPTION_KEY",
  "env.MIGRATION_DATABASE_URL",
  "env.POSTGRES_PASSWORD",
  "env.POSTGRES_RUNTIME_PASSWORD",
  "env.TELEGRAM_BOT_TOKEN",
] as const;

const SENSITIVE_KEY =
  /^(?:access_?token|admin_?auth_?token|api_?auth_?token|api_?key|authorization|backup_?encryption_?key|bot_?token|client_?secret|cookie|credentials|database_?url|migration_?database_?url|password|private_?key|refresh_?token|secret|telegram_?bot_?token|token)$/i;

const sanitizeSensitiveText = (value: string): string =>
  value
    .replace(
      /([a-z][a-z0-9+.-]*:\/\/)[^\s:/]+:[^\s@/]+@/gi,
      `$1${REDACTED_LOG_VALUE}:${REDACTED_LOG_VALUE}@`,
    )
    .replace(/\bBearer\s+[!-~]+/gi, `Bearer ${REDACTED_LOG_VALUE}`)
    .replace(/\b\d{6,12}:[A-Za-z0-9_-]{32,64}\b/g, REDACTED_LOG_VALUE)
    .replace(
      /\b(API_ADMIN_AUTH_TOKEN|API_AUTH_TOKEN|BACKUP_ENCRYPTION_KEY|DATABASE_URL|MIGRATION_DATABASE_URL|POSTGRES_PASSWORD|POSTGRES_RUNTIME_PASSWORD|TELEGRAM_BOT_TOKEN)=([^\s;]+)/gi,
      `$1=${REDACTED_LOG_VALUE}`,
    );

const sanitizeSerializedValue = (value: unknown): unknown => {
  if (typeof value === "string") {
    return sanitizeSensitiveText(value);
  }
  if (Array.isArray(value)) {
    return value.map(sanitizeSerializedValue);
  }
  if (typeof value !== "object" || value === null) {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, nested]) => [
      key,
      SENSITIVE_KEY.test(key) ? REDACTED_LOG_VALUE : sanitizeSerializedValue(nested),
    ]),
  );
};

export type LogLevel = "fatal" | "error" | "warn" | "info" | "debug" | "trace" | "silent";

export interface CreateLoggerOptions {
  readonly destination?: DestinationStream;
  readonly environment?: string;
  readonly level: LogLevel;
  readonly service: string;
}

export const createLogger = (options: CreateLoggerOptions): Logger => {
  const base: Record<string, string> = { service: options.service };

  if (options.environment !== undefined) {
    base.environment = options.environment;
  }

  const loggerOptions: PinoLoggerOptions = {
    base,
    level: options.level,
    redact: {
      censor: REDACTED_LOG_VALUE,
      paths: [...REDACTED_LOG_PATHS],
    },
    serializers: {
      err: (error: Error) => sanitizeSerializedValue(pino.stdSerializers.err(error)),
    },
    timestamp: pino.stdTimeFunctions.isoTime,
  };

  if (options.destination === undefined) {
    return pino(loggerOptions);
  }

  return pino(loggerOptions, options.destination);
};

export type AppLogger = Logger;
