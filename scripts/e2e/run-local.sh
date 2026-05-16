#!/usr/bin/env bash
#
# scripts/e2e/run-local.sh
#
# Full E2E orchestrator for machines without Docker access. It uses a local
# PostgreSQL cluster under /tmp by default, starts local MinIO from PATH, then
# launches API + Web before delegating to the default Playwright gate.
# Set E2E_WEB_SERVER_MODE=start to serve an existing production build with
# `next start` instead of `next dev`, which is useful when a dev server is
# already running for the same workspace.

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/../.." && pwd -P)"
RUN_DIR="${REPO_ROOT}/.e2e-run"

mkdir -p -- "${RUN_DIR}"

# --- env defaults -----------------------------------------------------------
E2E_LOCAL_PGDATA="${E2E_LOCAL_PGDATA:-/tmp/crm-manager-pg}"
E2E_PG_PORT="${E2E_PG_PORT:-55432}"
E2E_PG_USER="${E2E_PG_USER:-e2e}"
E2E_PG_PASSWORD="${E2E_PG_PASSWORD:-e2e}"
E2E_PG_DB="${E2E_PG_DB:-project_delivery_manager_e2e_local}"
E2E_WAIT_DB_SECS="${E2E_WAIT_DB_SECS:-60}"
E2E_MINIO_DATA_DIR="${E2E_MINIO_DATA_DIR:-/tmp/crm-manager-minio-e2e}"
E2E_MINIO_PORT="${E2E_MINIO_PORT:-59000}"
E2E_MINIO_CONSOLE_PORT="${E2E_MINIO_CONSOLE_PORT:-59001}"
E2E_WAIT_MINIO_SECS="${E2E_WAIT_MINIO_SECS:-60}"
PORT="${PORT:-3001}"
WEB_PORT="${WEB_PORT:-3000}"
E2E_WAIT_API_SECS="${E2E_WAIT_API_SECS:-90}"
E2E_WAIT_WEB_SECS="${E2E_WAIT_WEB_SECS:-120}"
E2E_KEEP_UP="${E2E_KEEP_UP:-0}"
E2E_WEB_SERVER_MODE="${E2E_WEB_SERVER_MODE:-dev}"

DATABASE_URL_WAS_SET=0
if [ -n "${DATABASE_URL:-}" ]; then
  DATABASE_URL_WAS_SET=1
else
  DATABASE_URL="postgresql://${E2E_PG_USER}:${E2E_PG_PASSWORD}@127.0.0.1:${E2E_PG_PORT}/${E2E_PG_DB}"
fi

export DATABASE_URL
export NODE_ENV="${NODE_ENV:-test}"
export PORT
export SESSION_COOKIE_NAME="${SESSION_COOKIE_NAME:-pdm_session}"
export WEB_APP_URL="${WEB_APP_URL:-http://127.0.0.1:${WEB_PORT}}"
export API_PROXY_TARGET="${API_PROXY_TARGET:-http://127.0.0.1:${PORT}}"
export E2E_API_URL="${E2E_API_URL:-http://127.0.0.1:${PORT}/api/v1}"
export E2E_WEB_URL="${E2E_WEB_URL:-http://127.0.0.1:${WEB_PORT}}"
export MINIO_PUBLIC_ENDPOINT="${MINIO_PUBLIC_ENDPOINT:-http://127.0.0.1:${E2E_MINIO_PORT}}"
export MINIO_INTERNAL_ENDPOINT="${MINIO_INTERNAL_ENDPOINT:-${MINIO_PUBLIC_ENDPOINT}}"
export MINIO_BUCKET="${MINIO_BUCKET:-crm-manager-attachments-e2e-local}"
export MINIO_ACCESS_KEY="${MINIO_ACCESS_KEY:-e2e-minio}"
export MINIO_SECRET_KEY="${MINIO_SECRET_KEY:-e2e-minio-secret}"
export MINIO_REGION="${MINIO_REGION:-us-east-1}"
export MINIO_FORCE_PATH_STYLE="${MINIO_FORCE_PATH_STYLE:-true}"
export MINIO_AUTO_CREATE_BUCKET="${MINIO_AUTO_CREATE_BUCKET:-false}"
export E2E_M0_ENABLED="${E2E_M0_ENABLED:-1}"
export E2E_M3_ENABLED="${E2E_M3_ENABLED:-1}"
export E2E_M4_ENABLED="${E2E_M4_ENABLED:-1}"
export E2E_UI_ENABLED="${E2E_UI_ENABLED:-1}"
export E2E_DB_READY="${E2E_DB_READY:-1}"
export E2E_REQUIRE_WEB="${E2E_REQUIRE_WEB:-1}"

POSTGRES_STARTED=0
MINIO_STARTED=0
CORS_FILE=""
POSTGRES_MARKER="${RUN_DIR}/local-postgres.pgdata"
MINIO_PID_FILE="${RUN_DIR}/local-minio.pid"

# --- logging ----------------------------------------------------------------
log() {
  printf '[e2e/local] %s\n' "$*" >&2
}

is_true() {
  case "${1:-}" in
    1 | true | TRUE | yes | YES | on | ON)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    log "ERROR: required command '$1' not found in PATH."
    exit 1
  fi
}

require_minio_cmds() {
  local missing=()

  command -v minio >/dev/null 2>&1 || missing+=("minio")
  command -v mc >/dev/null 2>&1 || missing+=("mc")

  if [ "${#missing[@]}" -eq 0 ]; then
    return 0
  fi

  log "ERROR: missing MinIO command(s): ${missing[*]}."
  log "Install them first, then rerun corepack pnpm test:e2e:local."
  log "  macOS: brew install minio/stable/minio minio/stable/mc"
  log "  Linux: download minio and mc from https://dl.min.io/, chmod +x, and put both on PATH."
  exit 1
}

database_name_from_url() {
  node -e '
const url = new URL(process.argv[1]);
const name = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
if (!name) {
  process.exit(2);
}
console.log(name);
' "$1"
}

assert_safe_database_url() {
  local db_name

  if ! db_name="$(database_name_from_url "${DATABASE_URL}" 2>/dev/null)"; then
    log "ERROR: DATABASE_URL is not a valid PostgreSQL URL with a database name."
    exit 1
  fi

  case "${db_name}" in
    *e2e* | *test*)
      return 0
      ;;
  esac

  if is_true "${E2E_ALLOW_NON_E2E_DATABASE:-}"; then
    log "WARNING: DATABASE_URL database '${db_name}' does not look E2E-only; proceeding because E2E_ALLOW_NON_E2E_DATABASE=1."
    return 0
  fi

  log "ERROR: refusing to run E2E against database '${db_name}'."
  log "Use an E2E-only database name containing 'e2e' or 'test', or set E2E_ALLOW_NON_E2E_DATABASE=1 after verifying it is disposable."
  exit 1
}

http_status() {
  curl -fsS -o /dev/null -w '%{http_code}' --max-time 3 "$1" 2>/dev/null || true
}

wait_for_http() {
  local label="$1"
  local url="$2"
  local timeout_secs="$3"
  local log_file="${4:-}"

  log "Waiting for ${label} at ${url} (timeout ${timeout_secs}s)..."
  local deadline=$(( $(date +%s) + timeout_secs ))
  local code

  while :; do
    code="$(http_status "${url}")"
    if [[ "${code}" =~ ^[23][0-9][0-9]$ ]]; then
      log "${label} responded ${code}."
      return 0
    fi

    if [ "$(date +%s)" -ge "${deadline}" ]; then
      log "ERROR: ${label} did not respond within ${timeout_secs}s (last status: ${code:-none})."
      if [ -n "${log_file}" ] && [ -f "${log_file}" ]; then
        log "---- ${label} log tail ----"
        tail -n 80 -- "${log_file}" >&2 || true
        log "---- end ${label} log tail ----"
      fi
      return 1
    fi

    sleep 1
  done
}

wait_for_psql() {
  local url="$1"
  local timeout_secs="$2"
  local label="$3"

  log "Waiting for ${label} (timeout ${timeout_secs}s)..."
  local deadline=$(( $(date +%s) + timeout_secs ))
  while :; do
    if PGPASSWORD="${E2E_PG_PASSWORD}" psql "${url}" -v ON_ERROR_STOP=1 -Atqc 'select 1' >/dev/null 2>&1; then
      log "${label} ready."
      return 0
    fi

    if [ "$(date +%s)" -ge "${deadline}" ]; then
      log "ERROR: ${label} did not become ready within ${timeout_secs}s."
      return 1
    fi

    sleep 1
  done
}

start_background() {
  # Args: <label> <pid-file> <log-file> -- <command...>
  local label="$1"
  local pid_file="$2"
  local log_file="$3"
  shift 3
  if [ "$1" != "--" ]; then
    log "ERROR: start_background called without -- separator."
    exit 1
  fi
  shift

  log "Launching ${label}: $*"
  if command -v setsid >/dev/null 2>&1; then
    setsid "$@" >"${log_file}" 2>&1 &
  else
    "$@" >"${log_file}" 2>&1 &
  fi
  local pid=$!
  echo "${pid}" >"${pid_file}"
  log "${label} pid=${pid} log=${log_file}"
}

kill_pid_file() {
  local label="$1"
  local pid_file="$2"

  if [ ! -f "${pid_file}" ]; then
    return 0
  fi

  local pid
  pid="$(cat -- "${pid_file}" 2>/dev/null || true)"
  if [ -z "${pid}" ] || ! [[ "${pid}" =~ ^[0-9]+$ ]]; then
    rm -f -- "${pid_file}"
    return 0
  fi

  if kill -0 "${pid}" 2>/dev/null; then
    log "Stopping ${label} (pid ${pid})..."
    kill -- -"${pid}" 2>/dev/null || kill "${pid}" 2>/dev/null || true
    for _ in 1 2 3 4 5; do
      if ! kill -0 "${pid}" 2>/dev/null; then
        break
      fi
      sleep 1
    done
    if kill -0 "${pid}" 2>/dev/null; then
      log "${label} did not exit on SIGTERM, sending SIGKILL."
      kill -9 -- -"${pid}" 2>/dev/null || kill -9 "${pid}" 2>/dev/null || true
    fi
  fi

  rm -f -- "${pid_file}"
}

ensure_pid_file_alive() {
  local label="$1"
  local pid_file="$2"
  local log_file="$3"

  local pid
  pid="$(cat -- "${pid_file}" 2>/dev/null || true)"
  if [ -n "${pid}" ] && [[ "${pid}" =~ ^[0-9]+$ ]] && kill -0 "${pid}" 2>/dev/null; then
    return 0
  fi

  log "ERROR: ${label} process exited before its health check could be trusted."
  if [ -f "${log_file}" ]; then
    log "---- ${label} log tail ----"
    tail -n 80 -- "${log_file}" >&2 || true
    log "---- end ${label} log tail ----"
  fi
  return 1
}

stop_local_postgres() {
  if [ "${POSTGRES_STARTED}" != "1" ]; then
    return 0
  fi

  log "Stopping local Postgres (${E2E_LOCAL_PGDATA})..."
  pg_ctl -D "${E2E_LOCAL_PGDATA}" stop -m fast >/dev/null 2>&1 || true
  rm -f -- "${POSTGRES_MARKER}"
}

cleanup() {
  local exit_code=$?
  trap - EXIT INT TERM

  if [ "${E2E_KEEP_UP}" = "1" ]; then
    log "E2E_KEEP_UP=1 set; leaving local stack running. Run corepack pnpm e2e:down when done."
    exit "${exit_code}"
  fi

  log "Tearing down local stack (exit code ${exit_code})..."
  kill_pid_file "API server" "${RUN_DIR}/api.pid"
  kill_pid_file "Web server" "${RUN_DIR}/web.pid"
  if [ "${MINIO_STARTED}" = "1" ]; then
    kill_pid_file "local MinIO" "${MINIO_PID_FILE}"
  fi
  stop_local_postgres
  rm -f -- "${CORS_FILE:-}"
  exit "${exit_code}"
}
trap cleanup EXIT INT TERM

ensure_postgres() {
  require_cmd node
  require_cmd psql
  assert_safe_database_url

  if [ "${DATABASE_URL_WAS_SET}" = "1" ]; then
    log "Using DATABASE_URL from environment after E2E safety check."
    wait_for_psql "${DATABASE_URL}" "${E2E_WAIT_DB_SECS}" "external PostgreSQL database"
    return 0
  fi

  require_cmd initdb
  require_cmd pg_ctl
  require_cmd createdb

  if [ ! -s "${E2E_LOCAL_PGDATA}/PG_VERSION" ]; then
    log "Initializing local Postgres data directory at ${E2E_LOCAL_PGDATA}."
    mkdir -p -- "${E2E_LOCAL_PGDATA}"
    initdb -D "${E2E_LOCAL_PGDATA}" --username="${E2E_PG_USER}" --auth=trust >/dev/null
  fi

  if pg_ctl -D "${E2E_LOCAL_PGDATA}" status >/dev/null 2>&1; then
    log "Reusing running local Postgres at ${E2E_LOCAL_PGDATA}."
  else
    local pg_log="${RUN_DIR}/postgres.log"
    : >"${pg_log}"
    log "Starting local Postgres on 127.0.0.1:${E2E_PG_PORT}."
    pg_ctl \
      -D "${E2E_LOCAL_PGDATA}" \
      -l "${pg_log}" \
      -o "-h 127.0.0.1 -p ${E2E_PG_PORT} -k /tmp" \
      start >/dev/null
    POSTGRES_STARTED=1
    printf '%s\n' "${E2E_LOCAL_PGDATA}" >"${POSTGRES_MARKER}"
  fi

  local maintenance_url="postgresql://${E2E_PG_USER}:${E2E_PG_PASSWORD}@127.0.0.1:${E2E_PG_PORT}/postgres"
  wait_for_psql "${maintenance_url}" "${E2E_WAIT_DB_SECS}" "local PostgreSQL server"

  if PGPASSWORD="${E2E_PG_PASSWORD}" psql "${DATABASE_URL}" -v ON_ERROR_STOP=1 -Atqc 'select 1' >/dev/null 2>&1; then
    log "Reusing E2E database '${E2E_PG_DB}'."
  else
    log "Creating E2E database '${E2E_PG_DB}'."
    PGPASSWORD="${E2E_PG_PASSWORD}" createdb \
      -h 127.0.0.1 \
      -p "${E2E_PG_PORT}" \
      -U "${E2E_PG_USER}" \
      "${E2E_PG_DB}"
  fi

  wait_for_psql "${DATABASE_URL}" "${E2E_WAIT_DB_SECS}" "local E2E database"
}

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

ensure_minio() {
  require_minio_cmds

  local minio_health="${MINIO_PUBLIC_ENDPOINT%/}/minio/health/ready"
  local code
  code="$(http_status "${minio_health}")"
  if [ "${code}" = "200" ]; then
    log "Reusing ready MinIO at ${MINIO_PUBLIC_ENDPOINT}."
  else
    local minio_log="${RUN_DIR}/minio.log"
    : >"${minio_log}"
    mkdir -p -- "${E2E_MINIO_DATA_DIR}"
    log "Starting local MinIO on ${MINIO_PUBLIC_ENDPOINT} (console :${E2E_MINIO_CONSOLE_PORT})."
    start_background "local MinIO" "${MINIO_PID_FILE}" "${minio_log}" -- \
      env \
        MINIO_ROOT_USER="${MINIO_ACCESS_KEY}" \
        MINIO_ROOT_PASSWORD="${MINIO_SECRET_KEY}" \
        MINIO_REGION_NAME="${MINIO_REGION}" \
      minio server "${E2E_MINIO_DATA_DIR}" \
        --address ":${E2E_MINIO_PORT}" \
        --console-address ":${E2E_MINIO_CONSOLE_PORT}"
    MINIO_STARTED=1
  fi

  wait_for_http "MinIO health" "${minio_health}" "${E2E_WAIT_MINIO_SECS}" "${RUN_DIR}/minio.log"

  local mc_config_dir="${RUN_DIR}/mc"
  mkdir -p -- "${mc_config_dir}"
  create_cors_file
  log "Initializing MinIO bucket '${MINIO_BUCKET}' and CORS."
  MC_CONFIG_DIR="${mc_config_dir}" mc alias set e2e-local \
    "${MINIO_PUBLIC_ENDPOINT}" \
    "${MINIO_ACCESS_KEY}" \
    "${MINIO_SECRET_KEY}" >/dev/null
  MC_CONFIG_DIR="${mc_config_dir}" mc mb --ignore-existing "e2e-local/${MINIO_BUCKET}" >/dev/null
  if ! MC_CONFIG_DIR="${mc_config_dir}" mc cors set "e2e-local/${MINIO_BUCKET}" "${CORS_FILE}" >/dev/null; then
    if is_true "${E2E_STRICT_MINIO_CORS:-}"; then
      log "ERROR: failed to configure MinIO CORS and E2E_STRICT_MINIO_CORS is enabled."
      exit 1
    fi
    log "WARNING: failed to configure MinIO CORS; continuing because the current E2E suite uploads through API/request clients."
  fi
}

run_migrations() {
  local db_name
  db_name="$(database_name_from_url "${DATABASE_URL}")"

  log "Running prisma migrate deploy against '${db_name}'."
  DATABASE_URL="${DATABASE_URL}" \
    corepack pnpm --filter @project-delivery/api exec prisma migrate deploy --config ../../prisma.config.ts
}

start_api() {
  log "Starting API server."
  local api_log="${RUN_DIR}/api.log"
  : >"${api_log}"

  start_background "API server" "${RUN_DIR}/api.pid" "${api_log}" -- \
    env \
      DATABASE_URL="${DATABASE_URL}" \
      NODE_ENV="${NODE_ENV}" \
      PORT="${PORT}" \
      SESSION_COOKIE_NAME="${SESSION_COOKIE_NAME}" \
      WEB_APP_URL="${WEB_APP_URL}" \
      MINIO_INTERNAL_ENDPOINT="${MINIO_INTERNAL_ENDPOINT}" \
      MINIO_PUBLIC_ENDPOINT="${MINIO_PUBLIC_ENDPOINT}" \
      MINIO_BUCKET="${MINIO_BUCKET}" \
      MINIO_ACCESS_KEY="${MINIO_ACCESS_KEY}" \
      MINIO_SECRET_KEY="${MINIO_SECRET_KEY}" \
      MINIO_REGION="${MINIO_REGION}" \
      MINIO_FORCE_PATH_STYLE="${MINIO_FORCE_PATH_STYLE}" \
      MINIO_AUTO_CREATE_BUCKET="${MINIO_AUTO_CREATE_BUCKET}" \
    corepack pnpm --dir "${REPO_ROOT}" --filter @project-delivery/api dev

  wait_for_http "API health" "${E2E_API_URL%/}/health" "${E2E_WAIT_API_SECS}" "${api_log}"
  ensure_pid_file_alive "API server" "${RUN_DIR}/api.pid" "${api_log}"
}

start_web() {
  log "Starting Web server."
  local web_log="${RUN_DIR}/web.log"
  : >"${web_log}"

  if [ "${E2E_WEB_SERVER_MODE}" = "start" ]; then
    log "Building Web production assets for API proxy ${API_PROXY_TARGET}."
    env \
      NODE_ENV=production \
      API_PROXY_TARGET="${API_PROXY_TARGET}" \
      corepack pnpm --dir "${REPO_ROOT}" --filter @project-delivery/web build

    start_background "Web server" "${RUN_DIR}/web.pid" "${web_log}" -- \
      env \
        PORT="${WEB_PORT}" \
        NODE_ENV=production \
        API_PROXY_TARGET="${API_PROXY_TARGET}" \
      corepack pnpm --dir "${REPO_ROOT}" --filter @project-delivery/web start --port "${WEB_PORT}"
  else
    start_background "Web server" "${RUN_DIR}/web.pid" "${web_log}" -- \
      env \
        PORT="${WEB_PORT}" \
        NODE_ENV=development \
        API_PROXY_TARGET="${API_PROXY_TARGET}" \
      corepack pnpm --dir "${REPO_ROOT}" --filter @project-delivery/web dev --port "${WEB_PORT}"
  fi

  wait_for_http "Web app" "${E2E_WEB_URL%/}/" "${E2E_WAIT_WEB_SECS}" "${web_log}"
  ensure_pid_file_alive "Web server" "${RUN_DIR}/web.pid" "${web_log}"
}

cd -- "${REPO_ROOT}"

require_cmd corepack
require_cmd curl
require_minio_cmds

log "Step 1/5: preparing local PostgreSQL."
ensure_postgres

log "Step 2/5: preparing local MinIO."
ensure_minio

log "Step 3/5: applying database migrations."
run_migrations

log "Step 4/5: launching API and Web."
start_api
start_web

log "Step 5/5: running Playwright E2E suite."
log "  E2E_API_URL=${E2E_API_URL} E2E_WEB_URL=${E2E_WEB_URL}"
log "  DATABASE_URL database=$(database_name_from_url "${DATABASE_URL}")"
log "  MINIO_PUBLIC_ENDPOINT=${MINIO_PUBLIC_ENDPOINT} MINIO_BUCKET=${MINIO_BUCKET}"

corepack pnpm test:e2e "$@"

log "Playwright suite completed successfully."
