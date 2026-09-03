# ADR-0005: Encrypted logical backup and isolated restore

- Status: accepted
- Date: 2026-09-03
- Owner: Артём

## Context

PostgreSQL is the operational source of truth and now contains permission evidence, immutable raw items, analyses, recommendations, deliveries, feedback and durable jobs. A database volume is not a backup. ART-023 therefore needs a repeatable recovery artifact and proof that the artifact can create a queryable database without putting the active database at risk.

The MVP runs as a single Docker Compose deployment. Adding a remote backup service, physical replication or cluster-level failover would expand the operational surface before the closed pilot.

## Decision

- Create a PostgreSQL custom-format logical dump through the schema-owner account in the private Compose container. Exclude ownership and ACL statements so the target environment can establish its own runtime role.
- Encrypt the dump as it streams to disk with AES-256-GCM, a random 96-bit IV and authenticated version/environment metadata. Require an externally supplied base64 32-byte `BACKUP_ENCRYPTION_KEY`; never print or store the key with the artifact.
- Store `.corbak` files under `<BACKUP_DIRECTORY>/<BACKUP_ENVIRONMENT>`, request directory mode `0700` and file mode `0600`, and prune only regular `.corbak` files older than the configured retention after a successful backup.
- Restore only into a newly created database whose name differs from the operational and PostgreSQL system databases. Never drop, clean or overwrite an existing database.
- Make verification perform the same authenticated decrypt and `pg_restore` into a random temporary database, query migration/schema and business-table counts, and then remove only that generated database. A wrong key, modified artifact, failed restore or invalid schema is a failed verification.
- Keep scheduling and off-host storage as deployment configuration. Production evidence requires daily successful artifacts, a protected off-host copy and a weekly successful verification, not merely the existence of commands.

## Consequences

The backup stream and decrypted dump never need a plaintext file. Restore is deliberately a create-and-switch procedure: the operator validates the new database, reapplies the least-privilege runtime grants, then changes the service connection only during an approved recovery.

Logical backup is sufficient for the current small single-database MVP but does not provide point-in-time recovery. The encryption key is a separate critical recovery asset: losing it makes the backup unusable, while keeping it beside the backup defeats the control. POSIX modes are enforced on Ubuntu; Windows operators must additionally restrict the parent directory with NTFS ACLs and disk protection.

Gate G5 remains open until scheduled daily backup, protected off-host retention, weekly restore history and reboot recovery are observed on the target host.
