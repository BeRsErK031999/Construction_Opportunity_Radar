# PostgreSQL backup and restore

## Recovery contract

`db:backup` produces an authenticated AES-256-GCM encrypted PostgreSQL custom dump. `db:verify-backup` decrypts the selected artifact directly into `pg_restore`, validates the restored database, and removes its generated verification database. `db:restore` uses the same path but leaves a new explicitly named recovery database for operator review.

The commands never overwrite the operational database, never restore into `postgres`, `template0` or `template1`, and never write a plaintext dump. The Compose PostgreSQL service must be healthy and the schema-owner credentials must remain available only inside the operator/container boundary.

## Configuration

Inject these values through the operator environment or secret manager:

- `BACKUP_ENCRYPTION_KEY` — required standard-base64 encoding of exactly 32 random bytes;
- `BACKUP_ENVIRONMENT` — environment namespace such as `production`, defaulting to `NODE_ENV` or `development`;
- `BACKUP_DIRECTORY` — protected root, default `backups`;
- `BACKUP_RETENTION_DAYS` — `1..3650`, default `14`.

Never store the encryption key in Git, command arguments, logs, the backup directory or the same off-host object as the backup. Retain old keys until every artifact encrypted with them has expired. Loss of the key is loss of the recovery copy.

For a temporary local verification key without printing it:

```powershell
$backupKeyBytes = [byte[]]::new(32)
[Security.Cryptography.RandomNumberGenerator]::Fill($backupKeyBytes)
$env:BACKUP_ENCRYPTION_KEY = [Convert]::ToBase64String($backupKeyBytes)
$env:BACKUP_ENVIRONMENT = "development"
```

On Ubuntu the command requests `0700` for the environment directory and `0600` for each artifact. Set `BACKUP_DIRECTORY` to a service-owned path on an encrypted/restricted filesystem. On Windows, also apply an explicit NTFS ACL and disk protection; `chmod` alone is not an ACL guarantee.

## Create and verify

```powershell
pnpm db:up
pnpm db:backup
pnpm db:verify-backup
```

Verification selects the newest `.corbak` file in the current environment. Select an artifact explicitly when required:

```powershell
pnpm db:verify-backup -- --file backups/production/radar-production-<timestamp>.corbak
```

Success prints a safe JSON summary with format/environment, migration count, table count and counts for core business records. It prints no key, database URL or decrypted content. A wrong key or modified ciphertext returns `BACKUP_RESTORE_FAILED`; any generated verification database is removed.

After a successful backup, retention removes only regular `.corbak` files older than `BACKUP_RETENTION_DAYS` inside the selected environment directory. Copy the encrypted artifact to access-controlled off-host storage before considering the backup durable. The local directory and Docker volume share a failure domain.

## Recover into a new database

Stop writers or select a recovery point, then restore into a new name:

```powershell
pnpm db:restore -- --file backups/production/radar-production-<timestamp>.corbak --target-database radar_recovered_20260903
```

Cross-environment recovery is refused unless the operator adds `--allow-cross-environment` after reviewing the artifact and target. An existing target, the active `POSTGRES_DB`, or a system database is always refused. A failed restore removes only the database created by that invocation; a successful restore leaves it intact.

Before switching services:

1. Compare the reported counts with the expected recovery point and inspect critical source/raw/recommendation/job records.
2. Run the runtime-role bootstrap against the target cluster and confirm DML without DDL.
3. Point a non-production smoke process at the new database and check API/pipeline reads.
4. Stop active writers, update the approved runtime `DATABASE_URL`, start processes and retain the old database until acceptance.
5. Record artifact name, environment, timestamp, verification result, duration and operator. Never record the key.

There is intentionally no `--replace`, `--clean` or automatic database swap.

## Schedule and evidence

For the target host, schedule one daily `db:backup` and one weekly `db:verify-backup` under the restricted operator account. Alert on non-zero exit, missing daily artifact, retention/off-host-copy failure or restore mismatch. Do not run concurrent backup jobs for the same database and environment.

ART-023 local evidence on 2026-09-03 restored 9 migrations and 21 tables with 10 sources, 200 raw items, 200 normalized items, 110 signals, 110 analyses and 110 recommendations. Both ephemeral verification and named recovery mode succeeded; wrong-key verification failed and left zero generated verification databases. The ephemeral test key and its three ignored artifacts were removed after the check; they were never production recovery assets.

Gate G5 still requires observed daily artifacts, protected off-host retention, weekly restore history and reboot recovery on the deployment host.
