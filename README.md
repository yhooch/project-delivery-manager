# Project Delivery Manager

SaaS Ready lightweight product delivery management tool.

## Workspace

- `apps/web`: Next.js web application.
- `apps/api`: NestJS API application.
- `packages/shared`: shared Zod schemas, DTOs, enums, and errors.
- `packages/config`: shared engineering configuration package.

## Local Setup

```bash
corepack enable
corepack prepare pnpm@11.1.1 --activate
pnpm install
pnpm lint
pnpm typecheck
```

## Development

```bash
pnpm dev:web
pnpm dev:api
```

