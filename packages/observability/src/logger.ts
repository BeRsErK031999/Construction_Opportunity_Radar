import pino, {
  type DestinationStream,
  type Logger,
  type LoggerOptions as PinoLoggerOptions,
} from "pino";

export const REDACTED_LOG_VALUE = "[REDACTED]";

export const REDACTED_LOG_PATHS = [
  "authorization",
  "cookie",
  "password",
  "secret",
  "token",
  "apiKey",
  "databaseUrl",
  "telegramBotToken",
  "req.headers.authorization",
  "req.headers.cookie",
  "headers.authorization",
  "headers.cookie",
  "config.databaseUrl",
  "env.API_AUTH_TOKEN",
  "env.DATABASE_URL",
  "env.TELEGRAM_BOT_TOKEN",
] as const;

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
      err: pino.stdSerializers.err,
    },
    timestamp: pino.stdTimeFunctions.isoTime,
  };

  if (options.destination === undefined) {
    return pino(loggerOptions);
  }

  return pino(loggerOptions, options.destination);
};

export type AppLogger = Logger;
