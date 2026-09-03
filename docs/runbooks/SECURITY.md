# Security hardening

## Standard verification

Run from the repository root:

```powershell
pnpm install --frozen-lockfile
pnpm security:check
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm build
pnpm db:validate
```

`security:secrets` scans current tracked and non-ignored candidate files plus every unique blob reachable from Git history. Findings print only rule and location, never the suspected value. It covers high-confidence provider tokens/private keys and tracked secret-file names; it does not replace GitHub/provider-side secret scanning or immediate credential revocation.

`security:audit` runs `pnpm audit --prod` against the pinned lockfile. A vulnerability is triaged by affected runtime path, exploitability and patched version; do not suppress it merely to make the command green.

## API credentials and limits

Generate two independent random values of at least 32 characters outside the repository:

- `API_AUTH_TOKEN`: trusted local user-process access to signals, profiles and feedback;
- `API_ADMIN_AUTH_TOKEN`: Source Registry administration only.

Production config rejects missing or identical tokens. Never put a token in a URL, command argument, chat, issue or log. Keep `API_HOST` on loopback. Defaults are 64 KiB per request and 60 requests per 60 seconds per normalized client IP; change `API_BODY_LIMIT_BYTES`, `API_RATE_LIMIT_MAX` or `API_RATE_LIMIT_WINDOW_MS` only with an observed workload reason.

The limiter is local to one API process. Do not interpret it as public/multi-instance DDoS protection. `trustProxy` is deliberately false, so forwarded IP headers do not change the bucket.

## PostgreSQL runtime role

The Compose owner (`POSTGRES_USER`) runs migrations and role administration. Application/CLI defaults use the local-only `radar_runtime` account. On a new volume the role is created automatically. For an existing volume run:

```powershell
pnpm db:up
pnpm db:grant-runtime
```

For non-development environments set unique `POSTGRES_RUNTIME_USER` and `POSTGRES_RUNTIME_PASSWORD`, then set service `DATABASE_URL` to that runtime account. Set `MIGRATION_DATABASE_URL` only in the migration/operator environment; do not expose it to API, bot or worker services.

Verify through the owner account that runtime has `USAGE` but not `CREATE` on schema `public`, and table CRUD only. Re-run `db:grant-runtime` after changing the runtime password. The script is idempotent and updates grants/default privileges for tables created later by the migration owner.

## Live-source egress

The fetch transport accepts HTTP(S) without URL credentials and only the protocol's default port. It resolves every hop and rejects loopback, link-local, private, carrier-grade NAT, documentation, benchmark, multicast and reserved ranges. Redirects are manual and bounded to five hops so every destination is checked.

Before enabling a live source, confirm rights, exact hostname and expected redirects. Production egress firewall/DNS policy must additionally restrict the collector to approved public destinations; application DNS checks do not fully prevent DNS rebinding between validation and connection.

## Rotation and incident response

On suspected credential or data exposure:

1. Disable the affected source/process or keep the API loopback-isolated.
2. Revoke and rotate the external credential first; change runtime and admin/user credentials independently.
3. Preserve correlation IDs, job/delivery state and sanitized logs; do not paste raw secrets into an incident note.
4. Run `pnpm security:secrets` and `pnpm security:audit`, then inspect Git history and deployment configuration.
5. If a secret entered Git, treat it as compromised even after removal. Revoke it before any history cleanup and coordinate rewriting/push separately.
6. Record impact, affected IDs/time range, containment and a regression test or control update.

Encrypted backup, key custody and isolated recovery are defined in `docs/runbooks/BACKUP_RESTORE.md`. CI enforcement is handled by ART-024.
