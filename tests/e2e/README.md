# tests/e2e

End-to-end suites driven by Playwright. The folder mixes two flavours:

| Flavour             | Files                                                                                                                                                                | Default behaviour                                                                                                     |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| API E2E (HTTP only) | `m0-main-flow.api.spec.ts`, `m3-main-flow.api.spec.ts`, `m4-mvp-main-flow.api.spec.ts`                                                                               | skipped unless the matching `E2E_M{0,3,4}_ENABLED=1` and `E2E_DB_READY=1` are exported and the API/Web probes succeed |
| UI E2E (browser)    | `ui-smoke.spec.ts`, `ui-command-palette.spec.ts`, `ui-org-switcher.spec.ts`, `ui-requirements-create.spec.ts`, `ui-tasks-create.spec.ts`, `ui-task-comments.spec.ts` | skipped unless `E2E_UI_ENABLED=1` AND `E2E_DB_READY=1` AND both probes succeed (see `support/ui-env.ts`)              |

Running the UI suite for real requires a fully wired stack: Postgres + migrated
schema + API on `:3001` + Web on `:3000`. The orchestrator script below
provisions all of that against a disposable database so it cannot pollute your
dev DB.

## One-command UI E2E

Prerequisites on the host machine:

- Docker (with the `docker compose` v2 plugin)
- Node 22+, `corepack` enabled (`corepack enable`)
- `curl`
- `node_modules` already installed (`corepack pnpm install` once after clone)
- A free port for Postgres (default `55432`), API (`3001`) and Web (`3000`)

Then, from the repo root:

```bash
corepack pnpm test:e2e:full
```

That single command does, in order:

1. `docker compose -f docker-compose.e2e.yml up -d postgres-e2e` — starts a
   throwaway Postgres 16 with `tmpfs`-backed storage.
2. Waits for the container's healthcheck to flip to `healthy`, then runs
   `prisma migrate deploy` against it.
3. Launches the API (`@project-delivery/api dev`) in the background and waits
   for `GET /api/v1/health` to return 200.
4. Launches the Web app (`@project-delivery/web dev --port 3000`) in the
   background and waits for `GET /` to return 2xx/3xx.
5. Runs `corepack pnpm test:e2e` with `E2E_M0_ENABLED=1`,
   `E2E_M3_ENABLED=1`, `E2E_M4_ENABLED=1`, `E2E_UI_ENABLED=1` and
   `E2E_DB_READY=1` exported so API and UI specs actually execute (any extra
   args are forwarded, e.g.
   `corepack pnpm test:e2e:full tests/e2e/ui-smoke.spec.ts`).
6. On exit (success, failure, Ctrl-C) — a `trap` runs
   `scripts/e2e/down.sh`, which kills the API/Web process groups and
   `docker compose down -v` the Postgres container.

Logs and PID files live in `.e2e-run/` (gitignored via `.env.*`/`*.log`
patterns and the directory itself is treated as scratch). Inspect
`.e2e-run/api.log` / `.e2e-run/web.log` if a step times out.

## Manual control

| Command                                     | What it does                                      |
| ------------------------------------------- | ------------------------------------------------- |
| `corepack pnpm e2e:up`                      | Just step 1 + 2 (Postgres + migrations)           |
| `corepack pnpm e2e:down`                    | Tear everything down (containers + recorded PIDs) |
| `E2E_KEEP_UP=1 corepack pnpm test:e2e:full` | Skip teardown so you can poke the running stack   |

## Honoured environment variables

See `.env.e2e.example` at the repo root for the full list and defaults. The
most useful overrides:

- `E2E_PG_PORT` / `E2E_PG_USER` / `E2E_PG_PASSWORD` / `E2E_PG_DB`
- `PORT` (API) / `WEB_PORT`
- `API_PROXY_TARGET` (Web rewrite target, default `http://127.0.0.1:$PORT`)
- `E2E_WAIT_API_SECS` (default 90), `E2E_WAIT_WEB_SECS` (default 120),
  `E2E_WAIT_DB_SECS` (default 60)
- `DATABASE_URL` (overrides the value otherwise derived from the four PG vars)

## Design notes

- The disposable Postgres uses `tmpfs` for `/var/lib/postgresql/data`, so
  start-up is fast and `docker compose down -v` reliably wipes state.
- API and Web are started with `setsid` so the cleanup script can SIGTERM the
  whole process group (tsx-watch and `next dev` spawn child workers).
- The orchestrator never touches the developer's `.env` file or the dev
  database. Everything is driven by env vars passed directly to the child
  processes.
- The UI specs themselves are **not modified** by this orchestrator; they
  continue to self-skip unless their preconditions are satisfied. The
  orchestrator's job is purely to satisfy those preconditions in one go.
