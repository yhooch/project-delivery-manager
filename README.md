# Project Delivery Manager

SaaS Ready lightweight product delivery management tool.

## Workspace

- `apps/web`: Next.js web application.
- `apps/api`: NestJS API application.
- `packages/shared`: shared Zod schemas, DTOs, enums, and errors.

## Local Setup

```bash
corepack enable
corepack prepare pnpm@11.1.1 --activate
pnpm install
pnpm lint
pnpm typecheck
```

## Verification

```bash
corepack pnpm verify
```

`verify` runs lint, typecheck, unit tests, and build in sequence. Real E2E is a
separate stack-level gate:

```bash
corepack pnpm verify:e2e:local
```

That local E2E entry first checks the Playwright gate/listing, then runs the
no-Docker `/tmp` Postgres + MinIO flow. Use `corepack pnpm test:e2e:full` for
the Docker-backed flow. See `tests/e2e/README.md` for prerequisites and
environment defaults.

## Development

```bash
pnpm dev:web
pnpm dev:api
```
