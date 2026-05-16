#!/usr/bin/env bash
#
# Default E2E gate for `corepack pnpm test:e2e`.
#
# The individual specs still contain skip guards for ad-hoc direct Playwright
# use, but the package script must not return success when the real E2E stack is
# absent. This wrapper validates the release-gate contract before delegating to
# Playwright.

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/../.." && pwd -P)"

log() {
  printf '[e2e/gate] %s\n' "$*" >&2
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

print_usage_hint() {
  log "Use one of these explicit entrypoints:"
  log "  corepack pnpm test:e2e:full   # Docker: Postgres + MinIO + API + Web + Playwright"
  log "  corepack pnpm test:e2e:local  # no Docker: local /tmp Postgres + local MinIO + API + Web"
  log "  corepack pnpm test:e2e:list   # list discovered tests only, without claiming a gate pass"
}

allow_help_without_gate() {
  for arg in "$@"; do
    case "${arg}" in
      -h | --help)
        return 0
        ;;
    esac
  done

  return 1
}

require_enabled_gate() {
  local missing=()
  local flag

  for flag in \
    E2E_M0_ENABLED \
    E2E_M3_ENABLED \
    E2E_M4_ENABLED \
    E2E_UI_ENABLED \
    E2E_DB_READY; do
    if ! is_true "${!flag:-}"; then
      missing+=("${flag}=1")
    fi
  done

  if [ "${#missing[@]}" -gt 0 ]; then
    log "ERROR: default E2E gate is not enabled; refusing to run a suite that can be fully skipped."
    log "Missing required env: ${missing[*]}"
    print_usage_hint
    exit 1
  fi
}

wait_probe() {
  local label="$1"
  local url="$2"
  local code

  code="$(curl -fsS -o /dev/null -w '%{http_code}' --max-time 5 "${url}" 2>/dev/null || true)"
  if [[ "${code}" =~ ^[23][0-9][0-9]$ ]]; then
    log "${label} probe passed (${code}) at ${url}."
    return 0
  fi

  log "ERROR: ${label} probe failed at ${url} (status: ${code:-none})."
  print_usage_hint
  exit 1
}

if allow_help_without_gate "$@"; then
  cd -- "${REPO_ROOT}"
  exec playwright test "$@"
fi

require_cmd curl
require_enabled_gate

E2E_API_URL="${E2E_API_URL:-http://127.0.0.1:3001/api/v1}"
E2E_WEB_URL="${E2E_WEB_URL:-http://127.0.0.1:3000}"

wait_probe "API health" "${E2E_API_URL%/}/health"
wait_probe "Web app" "${E2E_WEB_URL%/}/"

cd -- "${REPO_ROOT}"
exec playwright test "$@"
