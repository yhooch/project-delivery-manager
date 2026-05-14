#!/usr/bin/env bash
#
# scripts/e2e/down.sh
#
# Tears down everything scripts/e2e/up.sh / run.sh started:
#   - Kills lingering API / Web Node processes whose PIDs we recorded.
#   - Stops and removes the disposable Postgres container (volumes too).
#
# Safe to run multiple times; missing artefacts are ignored.

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/../.." && pwd -P)"
RUN_DIR="${REPO_ROOT}/.e2e-run"

log() {
  printf '[e2e/down] %s\n' "$*" >&2
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
    # Kill the entire process group so tsx-watch / next children also die.
    kill -- -"${pid}" 2>/dev/null || kill "${pid}" 2>/dev/null || true
    # Give it a moment, then SIGKILL any survivors.
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

cd -- "${REPO_ROOT}"

kill_pid_file "API server" "${RUN_DIR}/api.pid"
kill_pid_file "Web server" "${RUN_DIR}/web.pid"

if [ -d "${RUN_DIR}" ]; then
  # Keep the log files around for inspection, drop only the pid scratch.
  rm -f -- "${RUN_DIR}"/*.pid 2>/dev/null || true
fi

if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
  log "Stopping Postgres container and removing volumes..."
  docker compose -f docker-compose.e2e.yml down -v --remove-orphans || true
else
  log "docker not available; skipping container teardown."
fi

log "Teardown complete."
