#!/usr/bin/env bash
#
# scripts/e2e/run.sh
#
# Full UI-E2E orchestrator. Performs, in order:
#   1. up.sh          -> docker compose up postgres/minio + migrate + bucket/CORS
#   2. start API      -> background, wait for /api/v1/health to return 200
#   3. start Web      -> background, wait for / to return 2xx/3xx
#   4. playwright     -> E2E_M0/M3/M4/UI_ENABLED=1 E2E_DB_READY=1 corepack pnpm test:e2e
#   5. down.sh        -> trap on EXIT, always tears everything down
#
# Any extra args are forwarded to `pnpm test:e2e` (e.g. -g "smoke",
# `tests/e2e/ui-smoke.spec.ts`).
#
# Honoured env vars (all optional):
#   E2E_PG_PORT / E2E_PG_USER / E2E_PG_PASSWORD / E2E_PG_DB
#   E2E_MINIO_PORT / E2E_MINIO_CONSOLE_PORT
#   MINIO_INTERNAL_ENDPOINT / MINIO_BUCKET
#   MINIO_ACCESS_KEY / MINIO_SECRET_KEY / MINIO_REGION
#   MINIO_FORCE_PATH_STYLE / MINIO_AUTO_CREATE_BUCKET
#   PORT                  API listen port (default 3001)
#   WEB_PORT              Web listen port (default 3000)
#   API_PROXY_TARGET      Web rewrite target (default http://127.0.0.1:$PORT)
#   E2E_WAIT_API_SECS     max seconds to wait for API health (default 90)
#   E2E_WAIT_WEB_SECS     max seconds to wait for Web         (default 120)
#   E2E_KEEP_UP=1         skip teardown so you can poke the stack manually

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/../.." && pwd -P)"
RUN_DIR="${REPO_ROOT}/.e2e-run"

mkdir -p -- "${RUN_DIR}"

# --- env defaults -----------------------------------------------------------
E2E_PG_PORT="${E2E_PG_PORT:-55432}"
E2E_PG_USER="${E2E_PG_USER:-e2e}"
E2E_PG_PASSWORD="${E2E_PG_PASSWORD:-e2e}"
E2E_PG_DB="${E2E_PG_DB:-project_delivery_manager_e2e}"
E2E_MINIO_PORT="${E2E_MINIO_PORT:-59000}"
E2E_MINIO_CONSOLE_PORT="${E2E_MINIO_CONSOLE_PORT:-59001}"
PORT="${PORT:-3001}"
WEB_PORT="${WEB_PORT:-3000}"
E2E_WAIT_API_SECS="${E2E_WAIT_API_SECS:-90}"
E2E_WAIT_WEB_SECS="${E2E_WAIT_WEB_SECS:-120}"
E2E_KEEP_UP="${E2E_KEEP_UP:-0}"

DATABASE_URL_DEFAULT="postgresql://${E2E_PG_USER}:${E2E_PG_PASSWORD}@127.0.0.1:${E2E_PG_PORT}/${E2E_PG_DB}"
export DATABASE_URL="${DATABASE_URL:-${DATABASE_URL_DEFAULT}}"
export NODE_ENV="${NODE_ENV:-test}"
export PORT
export SESSION_COOKIE_NAME="${SESSION_COOKIE_NAME:-pdm_session}"
export WEB_APP_URL="${WEB_APP_URL:-http://127.0.0.1:${WEB_PORT}}"
export API_PROXY_TARGET="${API_PROXY_TARGET:-http://127.0.0.1:${PORT}}"
export E2E_API_URL="${E2E_API_URL:-http://127.0.0.1:${PORT}/api/v1}"
export E2E_WEB_URL="${E2E_WEB_URL:-http://127.0.0.1:${WEB_PORT}}"
export MINIO_INTERNAL_ENDPOINT="${MINIO_INTERNAL_ENDPOINT:-http://127.0.0.1:${E2E_MINIO_PORT}}"
export MINIO_BUCKET="${MINIO_BUCKET:-crm-manager-attachments-e2e}"
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

# --- logging ----------------------------------------------------------------
log() {
  printf '[e2e/run] %s\n' "$*" >&2
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

# --- cleanup trap -----------------------------------------------------------
cleanup() {
  local exit_code=$?
  if [ "${E2E_KEEP_UP}" = "1" ]; then
    log "E2E_KEEP_UP=1 set; leaving stack running. Run scripts/e2e/down.sh manually."
    exit "${exit_code}"
  fi
  log "Tearing down (exit code ${exit_code})..."
  # Suppress non-zero teardown failures so the original exit code is preserved.
  bash -- "${SCRIPT_DIR}/down.sh" >&2 || true
  exit "${exit_code}"
}
trap cleanup EXIT INT TERM

# --- 1. database ------------------------------------------------------------
log "Step 1/4: bringing up Postgres and applying migrations."
E2E_PG_PORT="${E2E_PG_PORT}" \
E2E_PG_USER="${E2E_PG_USER}" \
E2E_PG_PASSWORD="${E2E_PG_PASSWORD}" \
E2E_PG_DB="${E2E_PG_DB}" \
E2E_MINIO_PORT="${E2E_MINIO_PORT}" \
E2E_MINIO_CONSOLE_PORT="${E2E_MINIO_CONSOLE_PORT}" \
MINIO_BUCKET="${MINIO_BUCKET}" \
MINIO_ACCESS_KEY="${MINIO_ACCESS_KEY}" \
MINIO_SECRET_KEY="${MINIO_SECRET_KEY}" \
MINIO_REGION="${MINIO_REGION}" \
WEB_PORT="${WEB_PORT}" \
DATABASE_URL="${DATABASE_URL}" \
  bash -- "${SCRIPT_DIR}/up.sh"

# --- helpers for backgrounded servers ---------------------------------------
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
  # `setsid` puts the child in its own process group so down.sh can SIGTERM
  # the whole tree (tsx-watch / next dev spawn helpers).
  setsid "$@" >"${log_file}" 2>&1 &
  local pid=$!
  echo "${pid}" >"${pid_file}"
  log "${label} pid=${pid} log=${log_file}"
}

wait_for_http() {
  # Args: <label> <url> <timeout-secs> <log-file>
  local label="$1"
  local url="$2"
  local timeout_secs="$3"
  local log_file="$4"

  log "Waiting for ${label} at ${url} (timeout ${timeout_secs}s)..."
  local deadline=$(( $(date +%s) + timeout_secs ))
  while :; do
    # `curl -o /dev/null -s -w '%{http_code}'` returns the status code, or 000
    # if the connection failed; we accept 2xx and 3xx as "alive".
    local code
    code="$(curl -fsS -o /dev/null -w '%{http_code}' --max-time 3 "${url}" 2>/dev/null || true)"
    if [[ "${code}" =~ ^[23][0-9][0-9]$ ]]; then
      log "${label} responded ${code}."
      return 0
    fi
    if [ "$(date +%s)" -ge "${deadline}" ]; then
      log "ERROR: ${label} did not respond within ${timeout_secs}s (last status: ${code:-none})."
      log "---- ${label} log tail ----"
      tail -n 80 -- "${log_file}" >&2 || true
      log "---- end ${label} log tail ----"
      return 1
    fi
    sleep 1
  done
}

# --- 2. API -----------------------------------------------------------------
log "Step 2/4: starting API server."
API_PID_FILE="${RUN_DIR}/api.pid"
API_LOG_FILE="${RUN_DIR}/api.log"
: >"${API_LOG_FILE}"

# Use dev (tsx watch) so we don't depend on a pre-existing dist/ build.
start_background "API server" "${API_PID_FILE}" "${API_LOG_FILE}" -- \
  env \
    DATABASE_URL="${DATABASE_URL}" \
    NODE_ENV="${NODE_ENV}" \
    PORT="${PORT}" \
    SESSION_COOKIE_NAME="${SESSION_COOKIE_NAME}" \
    WEB_APP_URL="${WEB_APP_URL}" \
    MINIO_INTERNAL_ENDPOINT="${MINIO_INTERNAL_ENDPOINT}" \
    MINIO_BUCKET="${MINIO_BUCKET}" \
    MINIO_ACCESS_KEY="${MINIO_ACCESS_KEY}" \
    MINIO_SECRET_KEY="${MINIO_SECRET_KEY}" \
    MINIO_REGION="${MINIO_REGION}" \
    MINIO_FORCE_PATH_STYLE="${MINIO_FORCE_PATH_STYLE}" \
    MINIO_AUTO_CREATE_BUCKET="${MINIO_AUTO_CREATE_BUCKET}" \
  corepack pnpm --dir "${REPO_ROOT}" --filter @project-delivery/api dev

wait_for_http "API health" "${E2E_API_URL}/health" "${E2E_WAIT_API_SECS}" "${API_LOG_FILE}"

# --- 3. Web -----------------------------------------------------------------
log "Step 3/4: starting Web server."
WEB_PID_FILE="${RUN_DIR}/web.pid"
WEB_LOG_FILE="${RUN_DIR}/web.log"
: >"${WEB_LOG_FILE}"

# next dev so we don't need a prior build; it serves on $PORT (we override via
# the Next CLI port flag indirectly by setting PORT for the child).
start_background "Web server" "${WEB_PID_FILE}" "${WEB_LOG_FILE}" -- \
  env \
    PORT="${WEB_PORT}" \
    NODE_ENV=development \
    API_PROXY_TARGET="${API_PROXY_TARGET}" \
  corepack pnpm --dir "${REPO_ROOT}" --filter @project-delivery/web dev --port "${WEB_PORT}"

wait_for_http "Web app" "${E2E_WEB_URL}/" "${E2E_WAIT_WEB_SECS}" "${WEB_LOG_FILE}"

# --- 4. Playwright ----------------------------------------------------------
log "Step 4/4: running Playwright E2E suite."
log "  E2E_M0_ENABLED=${E2E_M0_ENABLED} E2E_M3_ENABLED=${E2E_M3_ENABLED} E2E_M4_ENABLED=${E2E_M4_ENABLED}"
log "  E2E_UI_ENABLED=${E2E_UI_ENABLED} E2E_DB_READY=${E2E_DB_READY}"
log "  E2E_API_URL=${E2E_API_URL} E2E_WEB_URL=${E2E_WEB_URL}"
log "  MINIO_INTERNAL_ENDPOINT=${MINIO_INTERNAL_ENDPOINT} MINIO_BUCKET=${MINIO_BUCKET}"

cd -- "${REPO_ROOT}"
# Forward any extra positional args (spec paths, -g pattern, --headed, ...).
corepack pnpm test:e2e "$@"

log "Playwright suite completed successfully."
# trap cleanup runs next.
