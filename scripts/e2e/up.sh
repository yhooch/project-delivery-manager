#!/usr/bin/env bash
#
# scripts/e2e/up.sh
#
# Brings up the disposable Postgres and MinIO containers declared in
# docker-compose.e2e.yml, initializes MinIO bucket/CORS, and runs
# `prisma migrate deploy` against Postgres. Idempotent: if services are already
# ready, it just re-applies migrations and MinIO bucket/CORS configuration.
#
# Honoured env vars (all optional, defaults match .env.e2e.example):
#   E2E_PG_PORT             host port for postgres         (default 55432)
#   E2E_PG_USER             postgres user                  (default e2e)
#   E2E_PG_PASSWORD         postgres password              (default e2e)
#   E2E_PG_DB               postgres database name         (default project_delivery_manager_e2e)
#   E2E_WAIT_DB_SECS        max seconds to wait for DB     (default 60)
#   E2E_MINIO_PORT          host port for MinIO S3 API     (default 59000)
#   E2E_MINIO_CONSOLE_PORT  host port for MinIO console    (default 59001)
#   E2E_WAIT_MINIO_SECS     max seconds to wait for MinIO  (default 60)
#   MINIO_BUCKET            attachment bucket              (default crm-manager-attachments-e2e)
#   MINIO_ACCESS_KEY        MinIO root/access key          (default e2e-minio)
#   MINIO_SECRET_KEY        MinIO root/secret key          (default e2e-minio-secret)
#   MINIO_REGION            MinIO region                   (default us-east-1)
#   WEB_PORT                Web port allowed by CORS       (default 3000)

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/../.." && pwd -P)"

E2E_PG_PORT="${E2E_PG_PORT:-55432}"
E2E_PG_USER="${E2E_PG_USER:-e2e}"
E2E_PG_PASSWORD="${E2E_PG_PASSWORD:-e2e}"
E2E_PG_DB="${E2E_PG_DB:-project_delivery_manager_e2e}"
E2E_WAIT_DB_SECS="${E2E_WAIT_DB_SECS:-60}"
E2E_MINIO_PORT="${E2E_MINIO_PORT:-59000}"
E2E_MINIO_CONSOLE_PORT="${E2E_MINIO_CONSOLE_PORT:-59001}"
E2E_WAIT_MINIO_SECS="${E2E_WAIT_MINIO_SECS:-60}"
MINIO_BUCKET="${MINIO_BUCKET:-crm-manager-attachments-e2e}"
MINIO_ACCESS_KEY="${MINIO_ACCESS_KEY:-e2e-minio}"
MINIO_SECRET_KEY="${MINIO_SECRET_KEY:-e2e-minio-secret}"
MINIO_REGION="${MINIO_REGION:-us-east-1}"
WEB_PORT="${WEB_PORT:-3000}"
MINIO_CONTAINER_NAME="crm-manager-e2e-minio"
CORS_FILE=""

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
require_cmd curl

if ! docker compose version >/dev/null 2>&1; then
  log "ERROR: 'docker compose' (v2 plugin) is required."
  exit 1
fi

cd -- "${REPO_ROOT}"

cleanup_tmp() {
  if [ -n "${CORS_FILE}" ]; then
    rm -f -- "${CORS_FILE}"
  fi
}
trap cleanup_tmp EXIT

log "Starting Postgres and MinIO containers (pg ${E2E_PG_PORT}, minio ${E2E_MINIO_PORT}/${E2E_MINIO_CONSOLE_PORT})..."
E2E_PG_PORT="${E2E_PG_PORT}" \
E2E_PG_USER="${E2E_PG_USER}" \
E2E_PG_PASSWORD="${E2E_PG_PASSWORD}" \
E2E_PG_DB="${E2E_PG_DB}" \
E2E_MINIO_PORT="${E2E_MINIO_PORT}" \
E2E_MINIO_CONSOLE_PORT="${E2E_MINIO_CONSOLE_PORT}" \
MINIO_ACCESS_KEY="${MINIO_ACCESS_KEY}" \
MINIO_SECRET_KEY="${MINIO_SECRET_KEY}" \
MINIO_REGION="${MINIO_REGION}" \
  docker compose -f docker-compose.e2e.yml up -d postgres-e2e minio-e2e

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

log "Waiting for MinIO health ready (timeout ${E2E_WAIT_MINIO_SECS}s)..."
deadline=$(( $(date +%s) + E2E_WAIT_MINIO_SECS ))
while :; do
  code="$(curl -fsS -o /dev/null -w '%{http_code}' --max-time 3 "http://127.0.0.1:${E2E_MINIO_PORT}/minio/health/ready" 2>/dev/null || true)"
  if [ "${code}" = "200" ]; then
    log "MinIO ready."
    break
  fi
  if [ "$(date +%s)" -ge "${deadline}" ]; then
    log "ERROR: MinIO did not become ready within ${E2E_WAIT_MINIO_SECS}s (last status: ${code:-none})."
    docker compose -f docker-compose.e2e.yml logs --tail=80 minio-e2e >&2 || true
    exit 1
  fi
  sleep 1
done

create_cors_file() {
  CORS_FILE="$(mktemp)"
  cat >"${CORS_FILE}" <<EOF
<CORSConfiguration>
  <CORSRule>
    <AllowedOrigin>http://127.0.0.1:${WEB_PORT}</AllowedOrigin>
    <AllowedOrigin>http://localhost:${WEB_PORT}</AllowedOrigin>
    <AllowedMethod>GET</AllowedMethod>
    <AllowedMethod>PUT</AllowedMethod>
    <AllowedMethod>POST</AllowedMethod>
    <AllowedMethod>DELETE</AllowedMethod>
    <AllowedMethod>HEAD</AllowedMethod>
    <AllowedHeader>*</AllowedHeader>
    <ExposeHeader>ETag</ExposeHeader>
    <MaxAgeSeconds>3000</MaxAgeSeconds>
  </CORSRule>
</CORSConfiguration>
EOF
}

minio_network_name() {
  docker inspect -f '{{range $name, $_ := .NetworkSettings.Networks}}{{println $name}}{{end}}' "${MINIO_CONTAINER_NAME}" 2>/dev/null | sed -n '1p'
}

init_minio_with_server_mc() {
  docker cp "${CORS_FILE}" "${MINIO_CONTAINER_NAME}:/tmp/e2e-cors.xml" >/dev/null
  docker compose -f docker-compose.e2e.yml exec -T \
    -e "MINIO_ACCESS_KEY=${MINIO_ACCESS_KEY}" \
    -e "MINIO_SECRET_KEY=${MINIO_SECRET_KEY}" \
    -e "MINIO_BUCKET=${MINIO_BUCKET}" \
    minio-e2e sh -se <<'MINIO_INIT'
mc alias set e2e http://127.0.0.1:9000 "${MINIO_ACCESS_KEY}" "${MINIO_SECRET_KEY}" >/dev/null
mc mb --ignore-existing "e2e/${MINIO_BUCKET}" >/dev/null
mc cors set "e2e/${MINIO_BUCKET}" /tmp/e2e-cors.xml >/dev/null
MINIO_INIT
}

init_minio_with_client_container() {
  local network
  network="$(minio_network_name)"
  if [ -z "${network}" ]; then
    log "ERROR: could not determine Docker network for ${MINIO_CONTAINER_NAME}."
    exit 1
  fi

  docker run --rm \
    --network "${network}" \
    --entrypoint /bin/sh \
    -e "MINIO_ACCESS_KEY=${MINIO_ACCESS_KEY}" \
    -e "MINIO_SECRET_KEY=${MINIO_SECRET_KEY}" \
    -e "MINIO_BUCKET=${MINIO_BUCKET}" \
    -v "${CORS_FILE}:/tmp/e2e-cors.xml:ro" \
    minio/mc -se <<'MINIO_INIT'
mc alias set e2e http://minio-e2e:9000 "${MINIO_ACCESS_KEY}" "${MINIO_SECRET_KEY}" >/dev/null
mc mb --ignore-existing "e2e/${MINIO_BUCKET}" >/dev/null
mc cors set "e2e/${MINIO_BUCKET}" /tmp/e2e-cors.xml >/dev/null
MINIO_INIT
}

log "Initializing MinIO bucket '${MINIO_BUCKET}' and CORS..."
create_cors_file
if docker compose -f docker-compose.e2e.yml exec -T minio-e2e sh -c 'command -v mc >/dev/null 2>&1'; then
  init_minio_with_server_mc
else
  init_minio_with_client_container
fi
log "MinIO bucket ready."

log "Running prisma migrate deploy against ${DATABASE_URL_DEFAULT/${E2E_PG_PASSWORD}/********}"
DATABASE_URL="${DATABASE_URL}" \
  corepack pnpm --filter @project-delivery/api exec prisma migrate deploy --config ../../prisma.config.ts

log "E2E services ready."
