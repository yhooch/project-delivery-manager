#!/usr/bin/env bash
#
# scripts/e2e/up.sh
#
# Brings up the disposable Postgres container declared in docker-compose.e2e.yml
# and runs `prisma migrate deploy` against it. Idempotent: if the container is
# already healthy, it just re-applies migrations.
#
# Honoured env vars (all optional, defaults match .env.e2e.example):
#   E2E_PG_PORT       host port for postgres        (default 55432)
#   E2E_PG_USER       postgres user                 (default e2e)
#   E2E_PG_PASSWORD   postgres password             (default e2e)
#   E2E_PG_DB         postgres database name        (default project_delivery_manager_e2e)
#   E2E_WAIT_DB_SECS  max seconds to wait for ready (default 60)

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/../.." && pwd -P)"

E2E_PG_PORT="${E2E_PG_PORT:-55432}"
E2E_PG_USER="${E2E_PG_USER:-e2e}"
E2E_PG_PASSWORD="${E2E_PG_PASSWORD:-e2e}"
E2E_PG_DB="${E2E_PG_DB:-project_delivery_manager_e2e}"
E2E_WAIT_DB_SECS="${E2E_WAIT_DB_SECS:-60}"

DATABASE_URL_DEFAULT="postgresql://${E2E_PG_USER}:${E2E_PG_PASSWORD}@127.0.0.1:${E2E_PG_PORT}/${E2E_PG_DB}"
DATABASE_URL="${DATABASE_URL:-${DATABASE_URL_DEFAULT}}"

log() {
  printf '[e2e/up] %s\n' "$*" >&2
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    log "ERROR: required command '$1' not found in PATH."
    exit 1
  fi
}

require_cmd docker
require_cmd corepack

if ! docker compose version >/dev/null 2>&1; then
  log "ERROR: 'docker compose' (v2 plugin) is required."
  exit 1
fi

cd -- "${REPO_ROOT}"

log "Starting Postgres container (port ${E2E_PG_PORT}, db ${E2E_PG_DB})..."
E2E_PG_PORT="${E2E_PG_PORT}" \
E2E_PG_USER="${E2E_PG_USER}" \
E2E_PG_PASSWORD="${E2E_PG_PASSWORD}" \
E2E_PG_DB="${E2E_PG_DB}" \
  docker compose -f docker-compose.e2e.yml up -d postgres-e2e

log "Waiting for Postgres to report healthy (timeout ${E2E_WAIT_DB_SECS}s)..."
deadline=$(( $(date +%s) + E2E_WAIT_DB_SECS ))
while :; do
  status="$(docker inspect -f '{{.State.Health.Status}}' crm-manager-e2e-postgres 2>/dev/null || echo 'missing')"
  if [ "${status}" = "healthy" ]; then
    log "Postgres healthy."
    break
  fi
  if [ "$(date +%s)" -ge "${deadline}" ]; then
    log "ERROR: Postgres did not become healthy within ${E2E_WAIT_DB_SECS}s (last status: ${status})."
    docker compose -f docker-compose.e2e.yml logs --tail=80 postgres-e2e >&2 || true
    exit 1
  fi
  sleep 1
done

log "Running prisma migrate deploy against ${DATABASE_URL_DEFAULT/${E2E_PG_PASSWORD}/********}"
DATABASE_URL="${DATABASE_URL}" \
  corepack pnpm --filter @project-delivery/api exec prisma migrate deploy --config ../../prisma.config.ts

log "Database ready."
