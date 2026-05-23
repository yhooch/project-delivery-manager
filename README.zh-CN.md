# Project Delivery Manager

[English](README.md) | 简体中文

Project Delivery Manager，简称 PDM，是一个面向小型软件团队的 SaaS Ready
产品交付管理平台。它把需求、事项池、任务、Bug、自定义流程、版本看板、实时刷新
和基于 MCP 的 AI Agent 接入能力放在同一个 TypeScript monorepo 中。

关键词：产品交付管理、项目管理、需求管理、事项跟踪、Bug 跟踪、流程管理、SaaS、
MCP、OAuth、Next.js、NestJS、Prisma、PostgreSQL。

## 解决什么问题

小型产品团队经常把需求、决策、开发任务、测试反馈、Bug 修复、版本范围和交付风险
分散在多个工具或聊天记录里。PDM 的目标是把这些对象连接起来，并保留可追溯的过程
记录，同时避免把团队协作变成沉重的企业流程平台。

核心工作流：

```text
注册/登录 -> 组织 -> 项目空间 -> 版本
  -> 需求 / 事项 -> 任务 / Bug
  -> 流程动作 -> 时间线 -> 工作台 / 看板 / 异常视图
```

## 功能亮点

- SaaS Ready 的组织和项目空间隔离。
- 用户名密码认证，基于数据库 Session 和 HttpOnly Cookie。
- 组织成员、项目空间成员和基于角色的权限控制。
- 用版本管理交付范围、目标和进度。
- 需求文档支持 Tiptap 富文本、Markdown、图片上传、评论、附件和时间线。
- 事项池用于收集工作来源，并将已纳入事项拆解为一个或多个任务。
- `TASK` 和 `BUG` 复用统一工作项模型，同时提供独立用户入口。
- 轻量可配置流程引擎，支持状态、动作、权限、动作表单和流程版本。
- 我的工作台、项目总览、版本看板和异常视图。
- 异常跟踪覆盖延期、阻塞、待确认、待回归和长时间未流转。
- 需求、事项、任务和 Bug 支持标签。
- 用户可读业务编号，例如 `REQ-12`、`INTAKE-8`、`TASK-42`、`BUG-17`。
- 基于 SSE invalidation events 的实时本地刷新。
- 中英文界面，支持浅色、深色和跟随系统主题。
- 面向 AI Agent 的 MCP Server 接入，使用 OAuth 2.1 + PKCE 和 scoped Bearer token 保护。

## MCP 与 AI Agent 接入

PDM 通过 Model Context Protocol 暴露一组受控的产品交付能力。第一阶段 MCP 能力包括
上下文读取、业务编号定位、工作台、空间总览、版本看板、异常视图、需求、事项、任务、
Bug、评论、标签和时间线。

当前工具名使用 `pdm.*` 命名空间，例如：

- `pdm.context.get`
- `pdm.object.lookup_code`
- `pdm.requirement.create`
- `pdm.work_item.execute_action`
- `pdm.bug.create`
- `pdm.tag.replace_assignments`

MCP 请求不复用 Web Session Cookie。调用方必须使用绑定到 MCP resource 的 OAuth
access token；业务权限仍由现有组织、项目空间、对象、角色和流程规则最终裁决。

## 技术栈

| 范围 | 技术 |
| --- | --- |
| Monorepo | pnpm workspaces |
| Web | Next.js、React、TypeScript |
| API | NestJS、TypeScript |
| 数据库 | PostgreSQL、Prisma |
| 共享契约 | `packages/shared` 中的 Zod schemas |
| UI | Tailwind CSS、Radix UI primitives、lucide-react |
| 编辑器 | Tiptap + Markdown 模式 |
| 文件存储 | MinIO / S3-compatible presigned URLs |
| 实时能力 | Server-Sent Events |
| E2E | Playwright |
| 单元测试 | Vitest |

## 仓库结构

```text
apps/
  api/        NestJS API 应用
  web/        Next.js Web 应用
packages/
  shared/     Zod schemas、DTO、枚举、错误码和 OpenAPI helper
prisma/       Prisma schema 和 migrations
tests/e2e/    Playwright API 和 UI E2E 测试
deploy/       nginx 生产入口配置
docs/         部署和实施说明
```

## 环境要求

- Node.js 22 或更高版本。
- Corepack 与 pnpm 11.1.1。
- PostgreSQL，作为 API 数据库。
- MinIO 或其他 S3-compatible 服务，用于附件链路。

完整本地 E2E 前置条件见 [tests/e2e/README.md](tests/e2e/README.md)。

## 本地开发

启用固定包管理器版本：

```bash
corepack enable
corepack prepare pnpm@11.1.1 --activate
```

安装依赖：

```bash
corepack pnpm install
```

准备环境变量：

```bash
cp .env.example .env
```

按需生成 Prisma Client 并执行迁移：

```bash
corepack pnpm --filter @project-delivery/api prisma:generate
corepack pnpm --filter @project-delivery/api prisma:migrate
```

同时启动 Web 和 API：

```bash
corepack pnpm dev
```

也可以分别启动：

```bash
corepack pnpm dev:api
corepack pnpm dev:web
```

## 验证

运行标准本地门禁：

```bash
corepack pnpm verify
```

`verify` 会依次运行 lint、typecheck、unit tests 和 build。

运行本地 E2E 门禁：

```bash
corepack pnpm verify:e2e:local
```

运行 Docker-backed E2E：

```bash
corepack pnpm test:e2e:full
```

常用定向命令：

```bash
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
corepack pnpm test:e2e:list
```

## 部署

仓库内包含基于 Docker Compose 的单机 HTTP 部署方案：

- [docker-compose.prod.yml](docker-compose.prod.yml)
- [docker-compose.prod.registry.yml](docker-compose.prod.registry.yml)
- [Dockerfile.api](Dockerfile.api)
- [Dockerfile.web](Dockerfile.web)
- [deploy/nginx.conf](deploy/nginx.conf)
- [.env.prod.example](.env.prod.example)
- [docs/production-private-registry.md](docs/production-private-registry.md)

HTTP 部署时，`SESSION_COOKIE_SECURE=false` 必须和实际访问 origin 匹配。切换到 HTTPS
后，应恢复 secure cookie 口径。

## 当前状态

MVP 主产品链路、标签、用户可读业务编号、实时刷新和主要 MCP 实现已经存在于代码库中。
发布相关的剩余检查包括：在完整 PostgreSQL + MinIO + API + Web 环境中运行完整 API/UI
E2E，以及使用 MCP Inspector 或等价客户端完成 OAuth/MCP 端到端验证。

## 建议 GitHub Topics

如果将本仓库发布到 GitHub，建议添加这些 topics 以提升可发现性：

```text
project-management
product-management
product-delivery
requirements-management
issue-tracker
bug-tracker
workflow-engine
saas
mcp
oauth2
nextjs
nestjs
prisma
postgresql
typescript
```

## License

本项目使用 [MIT License](LICENSE) 开源许可。
