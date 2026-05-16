#!/usr/bin/env bash
#
# Minimal regression check: the default E2E entrypoint must fail before
# Playwright can report a green run when the real stack flags are absent.

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/../.." && pwd -P)"
OUTPUT_FILE="$(mktemp)"

cleanup() {
  rm -f -- "${OUTPUT_FILE}"
}
trap cleanup EXIT

cd -- "${REPO_ROOT}"

status=0
env \
  -u E2E_M0_ENABLED \
  -u E2E_M3_ENABLED \
  -u E2E_M4_ENABLED \
  -u E2E_UI_ENABLED \
  -u E2E_DB_READY \
  corepack pnpm test:e2e --list >"${OUTPUT_FILE}" 2>&1 || status=$?

if [ "${status}" -eq 0 ]; then
  printf '[e2e/gate-check] ERROR: default test:e2e succeeded without real E2E flags.\n' >&2
  cat -- "${OUTPUT_FILE}" >&2
  exit 1
fi

if ! grep -q 'default E2E gate is not enabled' "${OUTPUT_FILE}"; then
  printf '[e2e/gate-check] ERROR: test:e2e failed for an unexpected reason.\n' >&2
  cat -- "${OUTPUT_FILE}" >&2
  exit 1
fi

printf '[e2e/gate-check] OK: default test:e2e fails fast when E2E flags are absent.\n'
