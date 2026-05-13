# 测试说明

## 单元/契约测试

运行：

```bash
corepack pnpm test
```

根脚本会执行各 workspace 的 `test` 脚本。当前约定是 Vitest；没有测试文件的 workspace 使用 `--passWithNoTests`，因此不会因为暂未补测试而失败。

## M0 E2E

运行：

```bash
corepack pnpm test:e2e
```

E2E 使用 Playwright，测试文件位于 `tests/e2e/`。默认情况下，M0 主链路会跳过，避免在 API、Web 或测试数据库尚未准备好时产生假失败。

Playwright API request 不会自动像浏览器页面一样带上来源信息。M0 E2E 会在 `POST` / `PATCH` 等 unsafe methods 上带 `Origin` 与 `Referer`，默认取 `E2E_WEB_URL` 的 origin，用于满足 API 的写请求 Origin 防护。

生产模式 API 会给 session cookie 设置 `Secure`。当验收环境使用 HTTP localhost 时，E2E 会从登录响应的 `Set-Cookie` 中提取 cookie name/value，并在后续请求显式带 `Cookie` header；这只影响测试请求，不改变 API guard 或 cookie 策略。

### 启用条件

执行真实 M0 主链路前需要满足：

- API 已启动并暴露 `GET /api/v1/health`。
- API 连接的是可丢弃的测试数据库，不要使用开发或生产数据。
- 测试数据库已执行 Prisma migration。
- 如需把 Web 可用性作为前置条件，Web 已启动。

示例：

```bash
export DATABASE_URL="postgresql://postgres:postgres@localhost:5432/project_delivery_manager_test"
corepack pnpm --filter @project-delivery/api prisma:migrate
PORT=3001 DATABASE_URL="$DATABASE_URL" corepack pnpm dev:api
```

另开终端执行：

```bash
E2E_M0_ENABLED=1 \
E2E_DB_READY=1 \
E2E_API_URL=http://127.0.0.1:3001/api/v1 \
corepack pnpm test:e2e
```

如果需要检查 Web 前置条件：

```bash
corepack pnpm dev:web

E2E_M0_ENABLED=1 \
E2E_DB_READY=1 \
E2E_REQUIRE_WEB=1 \
E2E_WEB_URL=http://127.0.0.1:3000 \
corepack pnpm test:e2e
```

### Skip 机制

M0 E2E 会在以下情况明确跳过并返回成功：

- 未设置 `E2E_M0_ENABLED=1`。
- 未设置 `E2E_DB_READY=1`。
- API health 不可访问。
- 设置了 `E2E_REQUIRE_WEB=1` 但 Web 不可访问。
- 并行开发中的 M0 API 端点尚未实现或未挂载，返回 `404` 或 `501`。

### 覆盖的 M0 骨架步骤

- 注册新用户：`POST /auth/register`
- 登录并建立 session：`POST /auth/login`
- 读取当前 session：`GET /auth/session`
- 创建组织：`POST /organizations`
- 更新用户偏好：`PATCH /users/me/preferences`
- 登出：`POST /auth/logout`
- 登出后受保护接口拒绝访问：`GET /auth/session` 应返回 `401` 或 `403`

测试请求和响应会使用 `packages/shared/src` 中的契约 schema 做基础校验。
