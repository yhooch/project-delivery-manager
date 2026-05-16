# tests/e2e

End-to-end suites driven by Playwright. The release gate must run against a
real stack: PostgreSQL + MinIO + API + Web.

| Command | Purpose |
| --- | --- |
| `corepack pnpm test:e2e` | Default release gate. Fails fast unless all E2E flags are enabled and API/Web probes pass. |
| `corepack pnpm test:e2e:full` | Docker orchestration: Postgres + MinIO + migrations + API + Web + Playwright. |
| `corepack pnpm test:e2e:local` | No-Docker orchestration: local `/tmp` Postgres + local MinIO + migrations + API + Web + Playwright. |
| `corepack pnpm test:e2e:list` | List discovered tests only. This does not run the gate and must not be treated as a pass. |
| `corepack pnpm test:e2e:gate-check` | Minimal regression check that the default gate fails when E2E flags are absent. |

## Why `test:e2e` Fails By Default

The specs still contain internal `test.skip(...)` guards so direct Playwright
debugging can avoid destructive calls when the stack is missing. That is not
acceptable for the package-level gate: a green run with every test skipped is a
false release signal.

`corepack pnpm test:e2e` now refuses to delegate to Playwright unless these are
true:

- `E2E_M0_ENABLED=1`
- `E2E_M3_ENABLED=1`
- `E2E_M4_ENABLED=1`
- `E2E_UI_ENABLED=1`
- `E2E_DB_READY=1`
- `GET $E2E_API_URL/health` returns 2xx/3xx
- `GET $E2E_WEB_URL/` returns 2xx/3xx

Use `corepack pnpm test:e2e:list` when you only need discovery output.
`corepack pnpm test:e2e --list` intentionally fails without a real E2E stack.

## Docker Path

Prerequisites:

- Docker with the `docker compose` v2 plugin
- Node 22+, `corepack` enabled
- `curl`
- `node_modules` already installed
- Free ports: Postgres `55432`, MinIO S3 `59000`, MinIO console `59001`, API
  `3001`, Web `3000`

Run:

```bash
corepack pnpm test:e2e:full
```

This command:

1. Starts throwaway Postgres and MinIO from `docker-compose.e2e.yml`.
2. Waits for readiness, creates the E2E bucket/CORS, and runs Prisma
   migrations.
3. Starts API and Web in the background.
4. Exports all `E2E_*_ENABLED=1` flags plus `E2E_DB_READY=1`.
5. Runs `corepack pnpm test:e2e` so the default gate validates the stack before
   Playwright executes.
6. Tears down containers and recorded API/Web process groups on exit.

Extra Playwright args are forwarded:

```bash
corepack pnpm test:e2e:full tests/e2e/ui-smoke.spec.ts
```

## No-Docker Local Path

Prerequisites:

- PostgreSQL server/client binaries on `PATH`: `initdb`, `pg_ctl`, `psql`,
  `createdb`
- MinIO server/client binaries on `PATH`: `minio`, `mc`
- Node 22+, `corepack` enabled
- `curl`
- `node_modules` already installed
- Free ports: Postgres `55432`, MinIO S3 `59000`, MinIO console `59001`, API
  `3001`, Web `3000`

Run:

```bash
corepack pnpm test:e2e:local
```

Default local isolation:

- PostgreSQL data directory: `/tmp/crm-manager-pg`
- Database: `project_delivery_manager_e2e_local`
- MinIO data directory: `/tmp/crm-manager-minio-e2e`
- Bucket: `crm-manager-attachments-e2e-local`

If `DATABASE_URL` is already set, `run-local.sh` reuses it instead of starting
`/tmp/crm-manager-pg`, but it refuses database names that do not contain
`e2e` or `test`. To override that guard for a manually verified disposable
database:

```bash
E2E_ALLOW_NON_E2E_DATABASE=1 DATABASE_URL=postgresql://... corepack pnpm test:e2e:local
```

If `minio` or `mc` is missing, the script exits before starting API/Web and
prints install/download hints. Typical installs:

```bash
brew install minio/stable/minio minio/stable/mc
```

On Linux, download `minio` and `mc` from `https://dl.min.io/`, `chmod +x` both
binaries, and put them on `PATH`.

## Manual Control

| Command | What it does |
| --- | --- |
| `corepack pnpm e2e:up` | Docker only: start Postgres + MinIO, create bucket/CORS, run migrations. |
| `corepack pnpm e2e:down` | Stop recorded API/Web, local MinIO/Postgres left by `run-local.sh`, and Docker E2E containers if Docker is available. |
| `E2E_KEEP_UP=1 corepack pnpm test:e2e:full` | Keep the Docker stack running after Playwright exits. |
| `E2E_KEEP_UP=1 corepack pnpm test:e2e:local` | Keep the local stack running after Playwright exits. |

Logs and PID files live in `.e2e-run/`. Inspect `.e2e-run/api.log`,
`.e2e-run/web.log`, `.e2e-run/postgres.log`, or `.e2e-run/minio.log` when a
step times out.

## Environment Variables

See `.env.e2e.example` at the repo root for defaults. Common overrides:

- `E2E_PG_PORT`, `E2E_PG_USER`, `E2E_PG_PASSWORD`, `E2E_PG_DB`
- `E2E_LOCAL_PGDATA` for the no-Docker path
- `DATABASE_URL`
- `E2E_MINIO_PORT`, `E2E_MINIO_CONSOLE_PORT`, `E2E_MINIO_DATA_DIR`
- `MINIO_INTERNAL_ENDPOINT`, `MINIO_PUBLIC_ENDPOINT`, `MINIO_BUCKET`
- `MINIO_ACCESS_KEY`, `MINIO_SECRET_KEY`, `MINIO_REGION`
- `PORT`, `WEB_PORT`, `API_PROXY_TARGET`
- `E2E_WAIT_API_SECS`, `E2E_WAIT_WEB_SECS`, `E2E_WAIT_DB_SECS`,
  `E2E_WAIT_MINIO_SECS`

## Test Flavours

| Flavour | Files | Runtime guard |
| --- | --- | --- |
| API E2E | `m0-main-flow.api.spec.ts`, `m3-main-flow.api.spec.ts`, `m4-mvp-main-flow.api.spec.ts` | Matching `E2E_M{0,3,4}_ENABLED=1`, `E2E_DB_READY=1`, API probe, and optional Web probe. |
| UI E2E | `ui-*.spec.ts` | `E2E_UI_ENABLED=1`, `E2E_DB_READY=1`, API probe, and Web probe. |

UI specs must import `test`/`expect` from `support/ui-test.ts`, not directly
from `@playwright/test`. The shared fixture fails on unexpected HTTP `4xx/5xx`,
`requestfailed`, `console.error`, `console.warning`, and `pageerror` events,
with only browser metadata/source-map noise and the initial unauthenticated
`GET /api/v1/auth/session` 401 before the first successful auth response
whitelisted.
