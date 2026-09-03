import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { once } from "node:events";
import { chmod, mkdir, open, readdir, rename, rm, stat } from "node:fs/promises";
import { createReadStream, createWriteStream } from "node:fs";
import { basename, join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";

export const BACKUP_FORMAT_VERSION = "cor-postgresql-backup/v1";
export const BACKUP_FILE_EXTENSION = ".corbak";

const BACKUP_MAGIC = Buffer.from("CORADB01", "ascii");
const HEADER_PREFIX_BYTES = BACKUP_MAGIC.length + 4;
const AUTH_TAG_BYTES = 16;
const IV_BYTES = 12;
const MAX_HEADER_BYTES = 4_096;
const MAX_COMMAND_OUTPUT_BYTES = 64 * 1_024;
const DEFAULT_RETENTION_DAYS = 14;
const MAX_RETENTION_DAYS = 3_650;
const DATABASE_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/;
const ENVIRONMENT_NAME_PATTERN = /^[a-z0-9][a-z0-9_-]{0,31}$/;

const DATABASE_SUMMARY_QUERY = `
SELECT json_build_object(
  'migration_count', (SELECT count(*) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL),
  'table_count', (SELECT count(*) FROM pg_tables WHERE schemaname = 'public'),
  'source_count', (SELECT count(*) FROM sources),
  'raw_item_count', (SELECT count(*) FROM raw_items),
  'normalized_item_count', (SELECT count(*) FROM normalized_items),
  'signal_count', (SELECT count(*) FROM signals),
  'analysis_count', (SELECT count(*) FROM analyses),
  'recommendation_count', (SELECT count(*) FROM recommendations),
  'feedback_count', (SELECT count(*) FROM feedback),
  'processing_job_count', (SELECT count(*) FROM processing_jobs)
)::text;
`;

export type BackupErrorCode =
  | "BACKUP_CONFIGURATION_INVALID"
  | "BACKUP_CREATE_FAILED"
  | "BACKUP_FILE_INVALID"
  | "BACKUP_NOT_FOUND"
  | "BACKUP_RESTORE_FAILED"
  | "BACKUP_TARGET_INVALID"
  | "BACKUP_VERIFICATION_FAILED";

export class BackupOperationError extends Error {
  readonly code: BackupErrorCode;

  constructor(code: BackupErrorCode, message: string) {
    super(message);
    this.name = "BackupOperationError";
    this.code = code;
  }
}

export interface BackupConfiguration {
  readonly composeFile: string;
  readonly cwd: string;
  readonly encryptionKey: Buffer;
  readonly environment: string;
  readonly environmentDirectory: string;
  readonly retentionDays: number;
}

export interface BackupHeaderV1 {
  readonly algorithm: "aes-256-gcm";
  readonly createdAt: string;
  readonly databaseFormat: "postgresql-custom";
  readonly environment: string;
  readonly iv: string;
  readonly version: typeof BACKUP_FORMAT_VERSION;
}

export interface BackupCreateResult {
  readonly backupFile: string;
  readonly createdAt: string;
  readonly environment: string;
  readonly prunedFiles: number;
  readonly version: typeof BACKUP_FORMAT_VERSION;
}

export interface RestoredDatabaseSummary {
  readonly analysis_count: number;
  readonly feedback_count: number;
  readonly migration_count: number;
  readonly normalized_item_count: number;
  readonly processing_job_count: number;
  readonly raw_item_count: number;
  readonly recommendation_count: number;
  readonly signal_count: number;
  readonly source_count: number;
  readonly table_count: number;
}

export interface RestoreArguments {
  readonly allowCrossEnvironment: boolean;
  readonly file: string | null;
  readonly mode: "restore" | "verify";
  readonly targetDatabase: string | null;
}

interface BackupFileEnvelope {
  readonly authenticationTag: Buffer;
  readonly ciphertextEnd: number;
  readonly ciphertextStart: number;
  readonly header: BackupHeaderV1;
  readonly headerBytes: Buffer;
}

interface ChildResult {
  readonly code: number | null;
  readonly stderr: string;
}

const requiredEnvironmentValue = (environment: NodeJS.ProcessEnv, name: string): string | null => {
  const value = environment[name]?.trim();
  return value === undefined || value.length === 0 ? null : value;
};

export const decodeEncryptionKey = (value: string | undefined): Buffer => {
  const normalized = value?.trim() ?? "";
  if (!/^[A-Za-z0-9+/]{43}=$/.test(normalized)) {
    throw new BackupOperationError(
      "BACKUP_CONFIGURATION_INVALID",
      "BACKUP_ENCRYPTION_KEY must be a base64-encoded 32-byte key",
    );
  }
  const key = Buffer.from(normalized, "base64");
  if (key.length !== 32 || key.toString("base64") !== normalized) {
    throw new BackupOperationError(
      "BACKUP_CONFIGURATION_INVALID",
      "BACKUP_ENCRYPTION_KEY must be a base64-encoded 32-byte key",
    );
  }
  return key;
};

export const loadBackupConfiguration = (
  environment: NodeJS.ProcessEnv = process.env,
  cwd = process.cwd(),
): BackupConfiguration => {
  const environmentName = (
    requiredEnvironmentValue(environment, "BACKUP_ENVIRONMENT") ??
    requiredEnvironmentValue(environment, "NODE_ENV") ??
    "development"
  ).toLowerCase();
  if (!ENVIRONMENT_NAME_PATTERN.test(environmentName)) {
    throw new BackupOperationError(
      "BACKUP_CONFIGURATION_INVALID",
      "BACKUP_ENVIRONMENT must be a lowercase environment identifier",
    );
  }

  const retentionText =
    requiredEnvironmentValue(environment, "BACKUP_RETENTION_DAYS") ??
    String(DEFAULT_RETENTION_DAYS);
  const retentionDays = Number(retentionText);
  if (!Number.isInteger(retentionDays) || retentionDays < 1 || retentionDays > MAX_RETENTION_DAYS) {
    throw new BackupOperationError(
      "BACKUP_CONFIGURATION_INVALID",
      `BACKUP_RETENTION_DAYS must be between 1 and ${String(MAX_RETENTION_DAYS)}`,
    );
  }

  const backupRoot = resolve(
    cwd,
    requiredEnvironmentValue(environment, "BACKUP_DIRECTORY") ?? "backups",
  );
  return Object.freeze({
    composeFile: resolve(cwd, "infra/docker/docker-compose.yml"),
    cwd,
    encryptionKey: decodeEncryptionKey(environment.BACKUP_ENCRYPTION_KEY),
    environment: environmentName,
    environmentDirectory: join(backupRoot, environmentName),
    retentionDays,
  });
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const integerCounter = (record: Record<string, unknown>, name: string): number => {
  const value = record[name];
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new BackupOperationError(
      "BACKUP_VERIFICATION_FAILED",
      "Restored database validation output is invalid",
    );
  }
  return value;
};

const parseBackupHeader = (value: unknown): BackupHeaderV1 => {
  if (!isRecord(value)) {
    throw new BackupOperationError("BACKUP_FILE_INVALID", "Backup header is invalid");
  }
  const keys = Object.keys(value).sort();
  const expectedKeys = [
    "algorithm",
    "createdAt",
    "databaseFormat",
    "environment",
    "iv",
    "version",
  ].sort();
  if (keys.join("|") !== expectedKeys.join("|")) {
    throw new BackupOperationError("BACKUP_FILE_INVALID", "Backup header is invalid");
  }
  if (
    value.version !== BACKUP_FORMAT_VERSION ||
    value.algorithm !== "aes-256-gcm" ||
    value.databaseFormat !== "postgresql-custom" ||
    typeof value.createdAt !== "string" ||
    !Number.isFinite(Date.parse(value.createdAt)) ||
    typeof value.environment !== "string" ||
    !ENVIRONMENT_NAME_PATTERN.test(value.environment) ||
    typeof value.iv !== "string"
  ) {
    throw new BackupOperationError("BACKUP_FILE_INVALID", "Backup header is invalid");
  }
  const iv = Buffer.from(value.iv, "base64");
  if (iv.length !== IV_BYTES || iv.toString("base64") !== value.iv) {
    throw new BackupOperationError("BACKUP_FILE_INVALID", "Backup header is invalid");
  }
  return Object.freeze({
    algorithm: value.algorithm,
    createdAt: value.createdAt,
    databaseFormat: value.databaseFormat,
    environment: value.environment,
    iv: value.iv,
    version: value.version,
  });
};

export const encodeBackupHeader = (header: BackupHeaderV1): Buffer => {
  const headerBytes = Buffer.from(JSON.stringify(header), "utf8");
  if (headerBytes.length > MAX_HEADER_BYTES) {
    throw new BackupOperationError("BACKUP_FILE_INVALID", "Backup header is too large");
  }
  const prefix = Buffer.alloc(HEADER_PREFIX_BYTES);
  BACKUP_MAGIC.copy(prefix, 0);
  prefix.writeUInt32BE(headerBytes.length, BACKUP_MAGIC.length);
  return Buffer.concat([prefix, headerBytes]);
};

const readBackupEnvelope = async (backupFile: string): Promise<BackupFileEnvelope> => {
  const handle = await open(backupFile, "r").catch(() => {
    throw new BackupOperationError("BACKUP_NOT_FOUND", "Backup file was not found");
  });
  try {
    const fileStats = await handle.stat();
    if (!fileStats.isFile() || fileStats.size <= HEADER_PREFIX_BYTES + AUTH_TAG_BYTES) {
      throw new BackupOperationError("BACKUP_FILE_INVALID", "Backup file is invalid");
    }
    const prefix = Buffer.alloc(HEADER_PREFIX_BYTES);
    const prefixRead = await handle.read(prefix, 0, prefix.length, 0);
    if (prefixRead.bytesRead !== prefix.length || !prefix.subarray(0, 8).equals(BACKUP_MAGIC)) {
      throw new BackupOperationError("BACKUP_FILE_INVALID", "Backup file is invalid");
    }
    const headerLength = prefix.readUInt32BE(BACKUP_MAGIC.length);
    if (headerLength < 2 || headerLength > MAX_HEADER_BYTES) {
      throw new BackupOperationError("BACKUP_FILE_INVALID", "Backup header is invalid");
    }
    const ciphertextStart = HEADER_PREFIX_BYTES + headerLength;
    const ciphertextEnd = fileStats.size - AUTH_TAG_BYTES - 1;
    if (ciphertextStart > ciphertextEnd) {
      throw new BackupOperationError("BACKUP_FILE_INVALID", "Backup payload is empty");
    }
    const headerBytes = Buffer.alloc(headerLength);
    const headerRead = await handle.read(headerBytes, 0, headerLength, HEADER_PREFIX_BYTES);
    if (headerRead.bytesRead !== headerLength) {
      throw new BackupOperationError("BACKUP_FILE_INVALID", "Backup header is incomplete");
    }
    const authenticationTag = Buffer.alloc(AUTH_TAG_BYTES);
    const tagRead = await handle.read(
      authenticationTag,
      0,
      AUTH_TAG_BYTES,
      fileStats.size - AUTH_TAG_BYTES,
    );
    if (tagRead.bytesRead !== AUTH_TAG_BYTES) {
      throw new BackupOperationError("BACKUP_FILE_INVALID", "Backup authentication tag is missing");
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(headerBytes.toString("utf8"));
    } catch {
      throw new BackupOperationError("BACKUP_FILE_INVALID", "Backup header is invalid");
    }
    return {
      authenticationTag,
      ciphertextEnd,
      ciphertextStart,
      header: parseBackupHeader(parsed),
      headerBytes,
    };
  } finally {
    await handle.close();
  }
};

const dockerCommand = (
  configuration: BackupConfiguration,
  command: readonly string[],
): ChildProcessWithoutNullStreams =>
  spawn(
    "docker",
    ["compose", "-f", configuration.composeFile, "exec", "-T", "postgres", ...command],
    {
      cwd: configuration.cwd,
      stdio: "pipe",
      windowsHide: true,
    },
  );

const observeChild = (child: ChildProcessWithoutNullStreams): Promise<ChildResult> => {
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    if (stderr.length < MAX_COMMAND_OUTPUT_BYTES) {
      stderr += chunk.slice(0, MAX_COMMAND_OUTPUT_BYTES - stderr.length);
    }
  });
  return new Promise((resolvePromise, rejectPromise) => {
    child.once("error", () => {
      rejectPromise(
        new BackupOperationError(
          "BACKUP_CONFIGURATION_INVALID",
          "Docker Compose could not be started",
        ),
      );
    });
    child.once("close", (code) => {
      resolvePromise({ code, stderr });
    });
  });
};

const runDockerCommand = async (
  configuration: BackupConfiguration,
  command: readonly string[],
  errorCode: BackupErrorCode,
  errorMessage: string,
): Promise<string> => {
  const child = dockerCommand(configuration, command);
  const output: Buffer[] = [];
  let outputBytes = 0;
  child.stdout.on("data", (chunk: Buffer) => {
    if (outputBytes < MAX_COMMAND_OUTPUT_BYTES) {
      const remaining = MAX_COMMAND_OUTPUT_BYTES - outputBytes;
      const captured = chunk.subarray(0, remaining);
      output.push(captured);
      outputBytes += captured.length;
    }
  });
  child.stdin.end();
  const result = await observeChild(child);
  if (result.code !== 0) {
    throw new BackupOperationError(errorCode, errorMessage);
  }
  return Buffer.concat(output).toString("utf8").trim();
};

const removePartialFile = async (path: string): Promise<void> => {
  await rm(path, { force: true }).catch(() => undefined);
};

const closeFailedOutput = async (output: ReturnType<typeof createWriteStream>): Promise<void> => {
  if (!output.closed) {
    output.destroy();
    await once(output, "close").catch(() => undefined);
  }
};

const finishOutput = async (output: ReturnType<typeof createWriteStream>, suffix: Buffer) => {
  output.end(suffix);
  await once(output, "close");
};

export const pruneExpiredBackups = async (
  configuration: BackupConfiguration,
  now: Date,
): Promise<number> => {
  const cutoff = now.getTime() - configuration.retentionDays * 24 * 60 * 60 * 1_000;
  const entries = await readdir(configuration.environmentDirectory, { withFileTypes: true });
  let pruned = 0;
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(BACKUP_FILE_EXTENSION)) {
      continue;
    }
    const path = join(configuration.environmentDirectory, entry.name);
    const fileStats = await stat(path);
    if (fileStats.mtimeMs < cutoff) {
      await rm(path);
      pruned += 1;
    }
  }
  return pruned;
};

export const createEncryptedPostgresBackup = async (
  configuration: BackupConfiguration,
  now = new Date(),
): Promise<BackupCreateResult> => {
  await mkdir(configuration.environmentDirectory, { mode: 0o700, recursive: true });
  await chmod(configuration.environmentDirectory, 0o700);

  const createdAt = now.toISOString();
  const iv = randomBytes(IV_BYTES);
  const header: BackupHeaderV1 = Object.freeze({
    algorithm: "aes-256-gcm",
    createdAt,
    databaseFormat: "postgresql-custom",
    environment: configuration.environment,
    iv: iv.toString("base64"),
    version: BACKUP_FORMAT_VERSION,
  });
  const encodedHeader = encodeBackupHeader(header);
  const headerBytes = encodedHeader.subarray(HEADER_PREFIX_BYTES);
  const filename = `radar-${configuration.environment}-${createdAt.replace(/[:.]/g, "-")}${BACKUP_FILE_EXTENSION}`;
  const backupFile = join(configuration.environmentDirectory, filename);
  const partialFile = `${backupFile}.partial`;
  const output = createWriteStream(partialFile, { flags: "wx", mode: 0o600 });

  try {
    output.write(encodedHeader);
    const cipher = createCipheriv("aes-256-gcm", configuration.encryptionKey, iv);
    cipher.setAAD(headerBytes);
    const dump = dockerCommand(configuration, [
      "sh",
      "-eu",
      "-c",
      'exec pg_dump --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --format=custom --no-owner --no-privileges --lock-wait-timeout=5s',
    ]);
    dump.stdin.end();
    const [dumpResult, streamResult] = await Promise.allSettled([
      observeChild(dump),
      pipeline(dump.stdout, cipher, output, { end: false }),
    ]);
    if (
      dumpResult.status === "rejected" ||
      streamResult.status === "rejected" ||
      dumpResult.value.code !== 0
    ) {
      throw new BackupOperationError("BACKUP_CREATE_FAILED", "PostgreSQL backup creation failed");
    }
    await finishOutput(output, cipher.getAuthTag());
    await rename(partialFile, backupFile);
    await chmod(backupFile, 0o600);
  } catch (error) {
    await closeFailedOutput(output);
    await removePartialFile(partialFile);
    if (error instanceof BackupOperationError) {
      throw error;
    }
    throw new BackupOperationError("BACKUP_CREATE_FAILED", "PostgreSQL backup creation failed");
  }

  const prunedFiles = await pruneExpiredBackups(configuration, now);
  return Object.freeze({
    backupFile,
    createdAt,
    environment: configuration.environment,
    prunedFiles,
    version: BACKUP_FORMAT_VERSION,
  });
};

const latestBackupFile = async (configuration: BackupConfiguration): Promise<string> => {
  const entries = await readdir(configuration.environmentDirectory, { withFileTypes: true }).catch(
    () => {
      throw new BackupOperationError("BACKUP_NOT_FOUND", "No backup exists for this environment");
    },
  );
  const candidates = await Promise.all(
    entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(BACKUP_FILE_EXTENSION))
      .map(async (entry) => {
        const path = join(configuration.environmentDirectory, entry.name);
        const fileStats = await stat(path);
        return { modifiedAt: fileStats.mtimeMs, path };
      }),
  );
  const latest = candidates.sort((left, right) => right.modifiedAt - left.modifiedAt)[0];
  if (latest === undefined) {
    throw new BackupOperationError("BACKUP_NOT_FOUND", "No backup exists for this environment");
  }
  return latest.path;
};

export const resolveBackupFile = async (
  configuration: BackupConfiguration,
  file: string | null,
): Promise<string> => {
  if (file === null) {
    return latestBackupFile(configuration);
  }
  const path = resolve(configuration.cwd, file);
  const fileStats = await stat(path).catch(() => {
    throw new BackupOperationError("BACKUP_NOT_FOUND", "Backup file was not found");
  });
  if (!fileStats.isFile() || !basename(path).endsWith(BACKUP_FILE_EXTENSION)) {
    throw new BackupOperationError("BACKUP_FILE_INVALID", "Backup file is invalid");
  }
  return path;
};

export const parseRestoreArguments = (arguments_: readonly string[]): RestoreArguments => {
  let allowCrossEnvironment = false;
  let file: string | null = null;
  let mode: "restore" | "verify" = "restore";
  let targetDatabase: string | null = null;
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === "--") {
      continue;
    }
    if (argument === "--verify") {
      mode = "verify";
      continue;
    }
    if (argument === "--allow-cross-environment") {
      allowCrossEnvironment = true;
      continue;
    }
    if (argument === "--file" || argument === "--target-database") {
      const value = arguments_[index + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new BackupOperationError("BACKUP_TARGET_INVALID", `${argument} requires a value`);
      }
      if (argument === "--file") {
        file = value;
      } else {
        targetDatabase = value;
      }
      index += 1;
      continue;
    }
    throw new BackupOperationError("BACKUP_TARGET_INVALID", "Unknown restore argument");
  }
  if (mode === "verify" && targetDatabase !== null) {
    throw new BackupOperationError(
      "BACKUP_TARGET_INVALID",
      "Verification uses an isolated generated database",
    );
  }
  if (mode === "restore" && targetDatabase === null) {
    throw new BackupOperationError("BACKUP_TARGET_INVALID", "Restore requires --target-database");
  }
  if (targetDatabase !== null && !DATABASE_NAME_PATTERN.test(targetDatabase)) {
    throw new BackupOperationError("BACKUP_TARGET_INVALID", "Target database name is invalid");
  }
  return Object.freeze({ allowCrossEnvironment, file, mode, targetDatabase });
};

const createTargetDatabase = async (
  configuration: BackupConfiguration,
  targetDatabase: string,
): Promise<void> => {
  await runDockerCommand(
    configuration,
    [
      "sh",
      "-eu",
      "-c",
      'case "$1" in postgres|template0|template1) exit 64;; esac; test "$1" != "$POSTGRES_DB"; exec createdb --username "$POSTGRES_USER" --template=template0 "$1"',
      "sh",
      targetDatabase,
    ],
    "BACKUP_TARGET_INVALID",
    "Target database must be new and differ from the operational database",
  );
};

const dropTargetDatabase = async (
  configuration: BackupConfiguration,
  targetDatabase: string,
): Promise<void> => {
  await runDockerCommand(
    configuration,
    [
      "sh",
      "-eu",
      "-c",
      'exec dropdb --username "$POSTGRES_USER" --if-exists --force "$1"',
      "sh",
      targetDatabase,
    ],
    "BACKUP_RESTORE_FAILED",
    "Temporary restore database cleanup failed",
  );
};

const restoreEncryptedPayload = async (
  configuration: BackupConfiguration,
  backupFile: string,
  envelope: BackupFileEnvelope,
  targetDatabase: string,
): Promise<void> => {
  const restore = dockerCommand(configuration, [
    "sh",
    "-eu",
    "-c",
    'exec pg_restore --username "$POSTGRES_USER" --dbname "$1" --exit-on-error --no-owner --no-privileges',
    "sh",
    targetDatabase,
  ]);
  const decipher = createDecipheriv(
    "aes-256-gcm",
    configuration.encryptionKey,
    Buffer.from(envelope.header.iv, "base64"),
  );
  decipher.setAAD(envelope.headerBytes);
  decipher.setAuthTag(envelope.authenticationTag);
  const input = createReadStream(backupFile, {
    end: envelope.ciphertextEnd,
    start: envelope.ciphertextStart,
  });
  const [restoreResult, streamResult] = await Promise.allSettled([
    observeChild(restore),
    pipeline(input, decipher, restore.stdin),
  ]);
  if (
    restoreResult.status === "rejected" ||
    streamResult.status === "rejected" ||
    restoreResult.value.code !== 0
  ) {
    throw new BackupOperationError(
      "BACKUP_RESTORE_FAILED",
      "Encrypted PostgreSQL restore failed integrity or pg_restore validation",
    );
  }
};

const restoredDatabaseSummary = async (
  configuration: BackupConfiguration,
  targetDatabase: string,
): Promise<RestoredDatabaseSummary> => {
  const result = await runDockerCommand(
    configuration,
    [
      "sh",
      "-eu",
      "-c",
      'exec psql --username "$POSTGRES_USER" --dbname "$1" --no-align --tuples-only --set=ON_ERROR_STOP=1 --command "$2"',
      "sh",
      targetDatabase,
      DATABASE_SUMMARY_QUERY,
    ],
    "BACKUP_VERIFICATION_FAILED",
    "Restored database validation query failed",
  );
  let parsed: unknown;
  try {
    parsed = JSON.parse(result);
  } catch {
    throw new BackupOperationError(
      "BACKUP_VERIFICATION_FAILED",
      "Restored database validation output is invalid",
    );
  }
  if (!isRecord(parsed)) {
    throw new BackupOperationError(
      "BACKUP_VERIFICATION_FAILED",
      "Restored database validation output is invalid",
    );
  }
  const summary: RestoredDatabaseSummary = {
    analysis_count: integerCounter(parsed, "analysis_count"),
    feedback_count: integerCounter(parsed, "feedback_count"),
    migration_count: integerCounter(parsed, "migration_count"),
    normalized_item_count: integerCounter(parsed, "normalized_item_count"),
    processing_job_count: integerCounter(parsed, "processing_job_count"),
    raw_item_count: integerCounter(parsed, "raw_item_count"),
    recommendation_count: integerCounter(parsed, "recommendation_count"),
    signal_count: integerCounter(parsed, "signal_count"),
    source_count: integerCounter(parsed, "source_count"),
    table_count: integerCounter(parsed, "table_count"),
  };
  if (summary.migration_count < 1 || summary.table_count < 1) {
    throw new BackupOperationError(
      "BACKUP_VERIFICATION_FAILED",
      "Restored database does not contain the expected schema",
    );
  }
  return Object.freeze(summary);
};

export interface RestoreResult {
  readonly backupFile: string;
  readonly backupVersion: typeof BACKUP_FORMAT_VERSION;
  readonly environment: string;
  readonly summary: RestoredDatabaseSummary;
  readonly targetDatabase: string;
  readonly verified: boolean;
}

export const restoreEncryptedPostgresBackup = async (options: {
  readonly allowCrossEnvironment: boolean;
  readonly backupFile: string;
  readonly configuration: BackupConfiguration;
  readonly removeAfterVerification: boolean;
  readonly targetDatabase: string;
}): Promise<RestoreResult> => {
  if (!DATABASE_NAME_PATTERN.test(options.targetDatabase)) {
    throw new BackupOperationError("BACKUP_TARGET_INVALID", "Target database name is invalid");
  }
  const envelope = await readBackupEnvelope(options.backupFile);
  if (
    !options.allowCrossEnvironment &&
    envelope.header.environment !== options.configuration.environment
  ) {
    throw new BackupOperationError(
      "BACKUP_TARGET_INVALID",
      "Backup environment differs; use --allow-cross-environment only after review",
    );
  }

  let databaseCreated = false;
  try {
    await createTargetDatabase(options.configuration, options.targetDatabase);
    databaseCreated = true;
    await restoreEncryptedPayload(
      options.configuration,
      options.backupFile,
      envelope,
      options.targetDatabase,
    );
    const summary = await restoredDatabaseSummary(options.configuration, options.targetDatabase);
    const result: RestoreResult = Object.freeze({
      backupFile: options.backupFile,
      backupVersion: envelope.header.version,
      environment: envelope.header.environment,
      summary,
      targetDatabase: options.targetDatabase,
      verified: true,
    });
    if (options.removeAfterVerification) {
      await dropTargetDatabase(options.configuration, options.targetDatabase);
      databaseCreated = false;
    }
    return result;
  } catch (error) {
    if (databaseCreated) {
      await dropTargetDatabase(options.configuration, options.targetDatabase).catch(
        () => undefined,
      );
    }
    if (error instanceof BackupOperationError) {
      throw error;
    }
    throw new BackupOperationError("BACKUP_RESTORE_FAILED", "PostgreSQL restore failed");
  }
};

export const verificationDatabaseName = (): string =>
  `radar_verify_${randomBytes(8).toString("hex")}`;
