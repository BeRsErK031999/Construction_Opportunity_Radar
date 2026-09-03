#!/bin/sh
set -eu

runtime_user="${POSTGRES_RUNTIME_USER:-radar_runtime}"
runtime_password="${POSTGRES_RUNTIME_PASSWORD:-radar_runtime_local}"

case "$runtime_user" in
  ''|*[!A-Za-z0-9_]* )
    echo "POSTGRES_RUNTIME_USER must contain only letters, numbers, and underscores" >&2
    exit 1
    ;;
esac

if [ "${#runtime_password}" -lt 16 ]; then
  echo "POSTGRES_RUNTIME_PASSWORD must contain at least 16 characters" >&2
  exit 1
fi

psql \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" \
  --set=ON_ERROR_STOP=1 \
  --set=runtime_user="$runtime_user" \
  --set=runtime_password="$runtime_password" <<'SQL'
SELECT format(
  'CREATE ROLE %I LOGIN NOSUPERUSER INHERIT NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS',
  :'runtime_user'
)
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'runtime_user')
\gexec

SELECT format(
  'ALTER ROLE %I WITH LOGIN PASSWORD %L NOSUPERUSER INHERIT NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 20',
  :'runtime_user',
  :'runtime_password'
)
\gexec

REVOKE ALL ON SCHEMA public FROM PUBLIC;
SELECT format('REVOKE CONNECT, TEMPORARY ON DATABASE %I FROM PUBLIC', current_database())
\gexec
SELECT format('GRANT CONNECT ON DATABASE %I TO %I', current_database(), :'runtime_user')
\gexec
SELECT format('GRANT USAGE ON SCHEMA public TO %I', :'runtime_user')
\gexec
SELECT format(
  'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO %I',
  :'runtime_user'
)
\gexec
SELECT format('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO %I', :'runtime_user')
\gexec
SELECT format(
  'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO %I',
  :'runtime_user'
)
\gexec
SELECT format(
  'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO %I',
  :'runtime_user'
)
\gexec
SELECT format('ALTER ROLE %I SET statement_timeout = %L', :'runtime_user', '30s')
\gexec
SELECT format('ALTER ROLE %I SET lock_timeout = %L', :'runtime_user', '5s')
\gexec
SELECT format(
  'ALTER ROLE %I SET idle_in_transaction_session_timeout = %L',
  :'runtime_user',
  '30s'
)
\gexec
SQL
