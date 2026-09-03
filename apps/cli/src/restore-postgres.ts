import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { loadEnvFile } from "node:process";

import {
  BackupOperationError,
  loadBackupConfiguration,
  parseRestoreArguments,
  resolveBackupFile,
  restoreEncryptedPostgresBackup,
  verificationDatabaseName,
} from "./postgres-backup-support.js";

const rootEnvironmentFile = resolve(process.cwd(), ".env");
if (existsSync(rootEnvironmentFile)) {
  loadEnvFile(rootEnvironmentFile);
}

try {
  const configuration = loadBackupConfiguration();
  const arguments_ = parseRestoreArguments(process.argv.slice(2));
  const backupFile = await resolveBackupFile(configuration, arguments_.file);
  const targetDatabase = arguments_.targetDatabase ?? verificationDatabaseName();
  const result = await restoreEncryptedPostgresBackup({
    allowCrossEnvironment: arguments_.allowCrossEnvironment,
    backupFile,
    configuration,
    removeAfterVerification: arguments_.mode === "verify",
    targetDatabase,
  });
  process.stdout.write(
    `${JSON.stringify({ ...result, targetDatabase: arguments_.mode === "verify" ? null : targetDatabase })}\n`,
  );
} catch (error) {
  const operationalError =
    error instanceof BackupOperationError
      ? error
      : new BackupOperationError("BACKUP_RESTORE_FAILED", "PostgreSQL restore failed");
  process.stderr.write(
    `${JSON.stringify({ error: { code: operationalError.code, message: operationalError.message } })}\n`,
  );
  process.exitCode = 1;
}
