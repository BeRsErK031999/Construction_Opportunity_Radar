import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { loadEnvFile } from "node:process";

import {
  BackupOperationError,
  createEncryptedPostgresBackup,
  loadBackupConfiguration,
} from "./postgres-backup-support.js";

const rootEnvironmentFile = resolve(process.cwd(), ".env");
if (existsSync(rootEnvironmentFile)) {
  loadEnvFile(rootEnvironmentFile);
}

try {
  const result = await createEncryptedPostgresBackup(loadBackupConfiguration());
  process.stdout.write(`${JSON.stringify(result)}\n`);
} catch (error) {
  const operationalError =
    error instanceof BackupOperationError
      ? error
      : new BackupOperationError("BACKUP_CREATE_FAILED", "PostgreSQL backup creation failed");
  process.stderr.write(
    `${JSON.stringify({ error: { code: operationalError.code, message: operationalError.message } })}\n`,
  );
  process.exitCode = 1;
}
