import { mkdtemp, mkdir, readdir, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  BACKUP_FORMAT_VERSION,
  BackupOperationError,
  decodeEncryptionKey,
  encodeBackupHeader,
  loadBackupConfiguration,
  parseRestoreArguments,
  pruneExpiredBackups,
} from "../src/postgres-backup-support.js";

const ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");

describe("PostgreSQL backup configuration", () => {
  it("creates an environment-isolated configuration with bounded retention", () => {
    const configuration = loadBackupConfiguration(
      {
        BACKUP_DIRECTORY: "private-backups",
        BACKUP_ENCRYPTION_KEY: ENCRYPTION_KEY,
        BACKUP_ENVIRONMENT: "staging",
        BACKUP_RETENTION_DAYS: "30",
      },
      "C:/radar",
    );

    expect(configuration).toMatchObject({
      composeFile: resolve("C:/radar", "infra/docker/docker-compose.yml"),
      environment: "staging",
      environmentDirectory: resolve("C:/radar", "private-backups/staging"),
      retentionDays: 30,
    });
    expect(configuration.encryptionKey).toEqual(Buffer.alloc(32, 7));
  });

  it("rejects missing, malformed, or weak encryption material", () => {
    for (const encryptionKey of [undefined, "not-base64", Buffer.alloc(31).toString("base64")]) {
      expect(() => decodeEncryptionKey(encryptionKey)).toThrow(BackupOperationError);
    }
  });

  it("rejects path-unsafe environments and unbounded retention", () => {
    expect(() =>
      loadBackupConfiguration({
        BACKUP_ENCRYPTION_KEY: ENCRYPTION_KEY,
        BACKUP_ENVIRONMENT: "../production",
      }),
    ).toThrow(/BACKUP_ENVIRONMENT/);
    expect(() =>
      loadBackupConfiguration({
        BACKUP_ENCRYPTION_KEY: ENCRYPTION_KEY,
        BACKUP_RETENTION_DAYS: "0",
      }),
    ).toThrow(/BACKUP_RETENTION_DAYS/);
  });

  it("prunes only expired backup files from the selected environment", async () => {
    const temporaryRoot = await mkdtemp(resolve(tmpdir(), "radar-backup-test-"));
    try {
      const configuration = loadBackupConfiguration(
        {
          BACKUP_DIRECTORY: temporaryRoot,
          BACKUP_ENCRYPTION_KEY: ENCRYPTION_KEY,
          BACKUP_ENVIRONMENT: "test",
          BACKUP_RETENTION_DAYS: "2",
        },
        temporaryRoot,
      );
      await mkdir(configuration.environmentDirectory, { recursive: true });
      const expired = resolve(configuration.environmentDirectory, "expired.corbak");
      const current = resolve(configuration.environmentDirectory, "current.corbak");
      const unrelated = resolve(configuration.environmentDirectory, "keep.txt");
      await Promise.all([
        writeFile(expired, "old"),
        writeFile(current, "new"),
        writeFile(unrelated, "not a backup"),
      ]);
      await utimes(expired, new Date("2026-08-01T00:00:00Z"), new Date("2026-08-01T00:00:00Z"));

      await expect(
        pruneExpiredBackups(configuration, new Date("2026-09-03T00:00:00Z")),
      ).resolves.toBe(1);
      expect((await readdir(configuration.environmentDirectory)).sort()).toEqual([
        "current.corbak",
        "keep.txt",
      ]);
    } finally {
      await rm(temporaryRoot, { force: true, recursive: true });
    }
  });
});

describe("PostgreSQL backup envelope and restore arguments", () => {
  it("encodes a versioned authenticated-encryption header", () => {
    const encoded = encodeBackupHeader({
      algorithm: "aes-256-gcm",
      createdAt: "2026-09-03T00:00:00.000Z",
      databaseFormat: "postgresql-custom",
      environment: "test",
      iv: Buffer.alloc(12, 3).toString("base64"),
      version: BACKUP_FORMAT_VERSION,
    });
    const headerLength = encoded.readUInt32BE(8);
    const header = JSON.parse(encoded.subarray(12, 12 + headerLength).toString("utf8")) as unknown;

    expect(encoded.subarray(0, 8).toString("ascii")).toBe("CORADB01");
    expect(header).toMatchObject({
      algorithm: "aes-256-gcm",
      databaseFormat: "postgresql-custom",
      version: BACKUP_FORMAT_VERSION,
    });
  });

  it("parses isolated verification and explicit non-destructive restore modes", () => {
    expect(parseRestoreArguments(["--verify", "--file", "backups/test/latest.corbak"])).toEqual({
      allowCrossEnvironment: false,
      file: "backups/test/latest.corbak",
      mode: "verify",
      targetDatabase: null,
    });
    expect(
      parseRestoreArguments([
        "--",
        "--file",
        "offsite/production.corbak",
        "--target-database",
        "radar_recovered",
        "--allow-cross-environment",
      ]),
    ).toEqual({
      allowCrossEnvironment: true,
      file: "offsite/production.corbak",
      mode: "restore",
      targetDatabase: "radar_recovered",
    });
  });

  it("refuses restore without a new valid target database", () => {
    expect(() => parseRestoreArguments([])).toThrow(/target-database/);
    expect(() => parseRestoreArguments(["--target-database", "radar;drop database radar"])).toThrow(
      /invalid/,
    );
    expect(() => parseRestoreArguments(["--verify", "--target-database", "unexpected"])).toThrow(
      /isolated/,
    );
  });
});
